/**
 * Fees & commissions tracker.
 *
 * Builds a "Fees" sheet from the full activity history: a chronological ledger of every fee
 * or commission the user has paid, converted to CAD at each event's historical (trade-date)
 * rate, plus a by-tax-year summary (split into Trade vs Account fees) and a by-account total.
 *
 * There are two distinct sources of fees in the activity feed:
 *   - Trade Fee: the per-trade `tx.fee` field carried on a BUY/SELL (or any other) activity.
 *     This is separate from `tx.amount` (the trade proceeds/cost), so counting it never
 *     double-counts the trade itself.
 *   - Account Fee: a standalone fee-type activity (type contains FEE / COMMISSION / CHARGE /
 *     WITHDRAWALFEE, etc.). Its fee is `tx.amount` (or `tx.fee` when present and `tx.amount`
 *     is absent/zero).
 *
 * Dedupe rule: a single activity contributes at most one Account Fee record (from its own
 * amount/fee) PLUS at most one Trade Fee record (from its `tx.fee`). A standalone fee
 * activity's `tx.fee` is NOT also counted as a Trade Fee — once an activity is classified as
 * a standalone fee, its `tx.fee` is treated as belonging to that same Account Fee and is not
 * emitted again. This guarantees no amount is counted twice.
 */

const FEES_SHEET = 'Fees';

/**
 * Keywords (matched case-insensitively as substrings of the activity type) that identify a
 * standalone fee/commission/charge activity. Edit to match your brokerage's activity labels.
 */
const FEE_TYPE_KEYWORDS = ['FEE', 'COMMISSION', 'CHARGE', 'WITHDRAWALFEE'];

const FEE_SOURCES = ['Trade Fee', 'Account Fee'];

/**
 * Entry point (wired to the SnapTrade menu).
 */
function refreshFees() {
  try {
    showToast('Fetching activity history…', 'Fees', -1);
    debugLog('refreshFees', 'start');
    const activities = fetchAllActivities();
    const records = buildFeeRecords(activities);
    debugLog('refreshFees', `built ${records.length} fee record(s) from ${activities.length} activities`);

    if (records.length === 0) {
      clearToast();
      SpreadsheetApp.getUi().alert('No fees or commissions were found in the activity history.');
      return;
    }

    records.sort((a, b) => a.date.getTime() - b.date.getTime());
    writeFeesSheet(records);

    clearToast();
    SpreadsheetApp.getUi().alert(`Tracked ${records.length} fee events. See the "Fees" sheet.`);
  } catch (error) {
    clearToast();
    debugLog('refreshFees', 'error', error.stack || error.message);
    SpreadsheetApp.getUi().alert(`Error tracking fees: ${error.message}`);
  }
}

/**
 * Reports whether an activity is a standalone fee/commission/charge.
 * @param {Object} tx
 * @returns {boolean}
 */
function isStandaloneFeeActivity(tx) {
  const type = (tx.type || '').toString().toUpperCase();
  return FEE_TYPE_KEYWORDS.some((kw) => type.indexOf(kw) !== -1);
}

/**
 * Builds fee records from activities. Pure function (no SpreadsheetApp/UrlFetchApp); native
 * fee amounts only, with CAD conversion handled later by sheet formulas.
 *
 * Each activity may yield up to two records: a standalone Account Fee (from its amount/fee)
 * and a per-trade Trade Fee (from `tx.fee`). The two are mutually exclusive on a given
 * activity — a standalone fee activity's `tx.fee` is folded into its Account Fee and never
 * also emitted as a Trade Fee — so nothing is double-counted (see file header).
 *
 * @param {Array} activities
 * @returns {Array<Object>} {date, account, symbol, source, feeNative, currency}
 */
function buildFeeRecords(activities) {
  const records = [];

  activities.forEach((tx) => {
    const date = parseActivityDate_(tx.trade_date || tx.settlement_date);
    if (!date) return;

    const symbolInfo = extractSymbolInfo(tx.symbol);
    const symbol = symbolInfo.symbol === 'N/A' ? '' : symbolInfo.symbol;
    const account = (tx.account && (tx.account.name || tx.account.number)) || '';
    // Leave currency blank when untagged rather than assuming USD, so a missing currency
    // resolves to rate 1 (no conversion) and is visibly empty instead of silently mis-converted.
    const currency = (tx.currency && tx.currency.code)
      || (tx.symbol && tx.symbol.currency && tx.symbol.currency.code)
      || '';

    const txFee = Math.abs(Number(tx.fee) || 0);
    const txAmount = Math.abs(Number(tx.amount) || 0);

    if (isStandaloneFeeActivity(tx)) {
      // The fee charged is the activity's amount; fall back to its fee field when no amount.
      const feeNative = txAmount || txFee;
      if (feeNative > 0) {
        records.push({ date: date, account: account, symbol: symbol, source: 'Account Fee', feeNative: feeNative, currency: currency });
      }
      // Do NOT also emit a Trade Fee from this activity's tx.fee — it belongs to the same
      // standalone fee and would double-count.
      return;
    }

    // Any other activity (BUY/SELL/etc.) may carry a per-trade fee separate from its amount.
    if (txFee > 0) {
      records.push({ date: date, account: account, symbol: symbol, source: 'Trade Fee', feeNative: txFee, currency: currency });
    }
  });

  return records;
}

/**
 * Writes the Fees sheet: a CAD-converted ledger, a by-tax-year summary (Trade vs Account),
 * and a by-account total.
 * @param {Array<Object>} records - Sorted fee records
 */
function writeFeesSheet(records) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(FEES_SHEET) || ss.insertSheet(FEES_SHEET);
  sheet.clear();

  const headers = ['Date', 'Account', 'Symbol', 'Source', 'Fee (native)', 'Currency', 'FX→CAD', 'Fee (CAD)'];
  sheet.appendRow(headers);

  const data = records.map((rec, i) => {
    const r = i + 2;
    return [
      rec.date, rec.account, rec.symbol, rec.source, rec.feeNative, rec.currency,
      historicalCadFxFormula(`$F${r}`, `$A${r}`), // FX on the event date
      `=$E${r}*$G${r}`,                            // Fee (CAD) = Fee x FX
    ];
  });

  sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  const lastRow = data.length + 1;
  sheet.getRange(2, 1, data.length, 1).setNumberFormat(CONFIG.SHEETS.DATE_FORMAT);
  sheet.getRange(2, 5, data.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT); // Fee (native)
  sheet.getRange(2, 7, data.length, 1).setNumberFormat('0.0000');                       // FX
  sheet.getRange(2, 8, data.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT); // Fee (CAD)
  formatSheetHeader(sheet);
  sheet.setFrozenRows(1);

  const dRange = `$D$2:$D$${lastRow}`; // Source
  const aRange = `$A$2:$A$${lastRow}`; // Date
  const bRange = `$B$2:$B$${lastRow}`; // Account
  const hRange = `$H$2:$H$${lastRow}`; // Fee (CAD)

  // By-tax-year summary, split into Trade vs Account fee columns.
  const years = [];
  records.forEach((rec) => {
    const y = rec.date.getFullYear();
    if (years.indexOf(y) === -1) years.push(y);
  });
  years.sort();

  const yearTitleRow = lastRow + 2;
  sheet.getRange(yearTitleRow, 1).setValue('Fees by Tax Year (CAD)');

  const yearSummary = [['Tax Year'].concat(FEE_SOURCES).concat(['Total'])];
  years.forEach((year) => {
    const row = [year];
    FEE_SOURCES.forEach((src) => {
      row.push(`=SUMPRODUCT((YEAR(${aRange})=${year})*(${dRange}="${src}")*${hRange})`);
    });
    row.push(`=SUMPRODUCT((YEAR(${aRange})=${year})*${hRange})`); // Total
    yearSummary.push(row);
  });

  const yearHeaderRow = yearTitleRow + 1;
  sheet.getRange(yearHeaderRow, 1, yearSummary.length, yearSummary[0].length).setValues(yearSummary);
  sheet.getRange(yearHeaderRow + 1, 2, years.length, FEE_SOURCES.length + 1)
    .setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT);

  // By-account total (CAD) across all years.
  const accounts = [];
  records.forEach((rec) => {
    if (accounts.indexOf(rec.account) === -1) accounts.push(rec.account);
  });
  accounts.sort();

  const acctTitleRow = yearHeaderRow + yearSummary.length + 1;
  sheet.getRange(acctTitleRow, 1).setValue('Total Fees by Account (CAD)');

  const acctSummary = [['Account', 'Total Fees (CAD)']];
  accounts.forEach((account) => {
    const q = `"${account.replace(/"/g, '""')}"`;
    acctSummary.push([account, `=SUMPRODUCT((${bRange}=${q})*${hRange})`]);
  });

  const acctHeaderRow = acctTitleRow + 1;
  sheet.getRange(acctHeaderRow, 1, acctSummary.length, 2).setValues(acctSummary);
  sheet.getRange(acctHeaderRow + 1, 2, accounts.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT);
}
