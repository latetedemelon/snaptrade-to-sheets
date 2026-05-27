/**
 * Foreign-exchange capital gains (currency as property).
 *
 * Under CRA rules foreign currency is property: acquiring it (USD from a sale, a dividend,
 * a deposit, a CAD->USD conversion) has a CAD cost at that day's rate, and disposing of it
 * (buying a US stock, a fee, a withdrawal, a USD->CAD conversion) realizes an FX capital
 * gain/loss against the currency's running ACB.
 *
 * Every non-CAD cash movement in the activity feed is treated as an acquisition (amount > 0)
 * or disposition (amount < 0) of that currency. A per-currency ACB is tracked in CAD using
 * historical (trade-date) rates, exactly like the security ACB ledger.
 *
 * This is highly sensitive to complete history: if the feed misses the inflow that first
 * brought a currency into the account, dispositions will look like they exceed the balance.
 * Those cases are soft-flagged (never blocked) and reconciled against current cash.
 */

const FOREX_LEDGER_SHEET = 'Forex Ledger';
const FOREX_SUMMARY_SHEET = 'Forex Gains';

/**
 * Entry point (wired to the SnapTrade menu).
 */
function refreshForex() {
  try {
    showToast('Fetching activity history…', 'Forex', -1);
    debugLog('refreshForex', 'start');
    const activities = fetchAllActivities();
    const records = buildForexRecords(activities);
    debugLog('refreshForex', `built ${records.length} forex movement(s) from ${activities.length} activities`);

    if (records.length === 0) {
      clearToast();
      SpreadsheetApp.getUi().alert('No non-CAD cash activity was found, so there are no foreign-exchange gains to track.');
      return;
    }

    sortForexRecords(records);

    const currentCash = fetchCurrentCashByCurrency();
    const diagnostics = computeForexDiagnostics(records, currentCash);

    const ledgerInfo = writeForexLedger(records, diagnostics);
    writeForexSummary(ledgerInfo, diagnostics);

    clearToast();
    const flagged = Object.keys(diagnostics).filter((c) => diagnostics[c].flagged);
    debugLog('refreshForex', `done: ${ledgerInfo.currencyCount} currency/currencies, ${flagged.length} flagged`,
      flagged.map((c) => `${c}: ${diagnostics[c].reason}`));
    let message = `Tracked ${records.length} foreign-currency movements across ${ledgerInfo.currencyCount} currency/currencies. ` +
      'See the "Forex Ledger" and "Forex Gains" sheets.';
    if (flagged.length > 0) {
      message += `\n\n⚠️ ${flagged.length} currency/currencies may have incomplete history (see the Status column). ` +
        'FX gains are only correct when every inflow and outflow of the currency is present.';
    }
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    clearToast();
    debugLog('refreshForex', 'error', error.stack || error.message);
    SpreadsheetApp.getUi().alert(`Error tracking forex: ${error.message}`);
  }
}

/**
 * Builds per-currency acquisition/disposition records from non-CAD cash activities.
 * @param {Array} activities
 * @returns {Array<Object>} {date, currency, account, direction, amount}
 */
function buildForexRecords(activities) {
  const records = [];
  activities.forEach((tx) => {
    const currency = (tx.currency && tx.currency.code) || '';
    if (!currency || currency === 'CAD') return; // home currency has no FX gain

    const amount = Number(tx.amount) || 0;
    if (amount === 0) return; // non-cash activity

    const date = parseActivityDate_(tx.trade_date || tx.settlement_date);
    if (!date) return;

    records.push({
      date: date,
      currency: currency,
      account: (tx.account && (tx.account.name || tx.account.number)) || '',
      direction: amount > 0 ? 'Acquire' : 'Dispose',
      amount: Math.abs(amount),
    });
  });
  return records;
}

/**
 * Sorts by currency, then date, then direction so same-day acquisitions are applied before
 * dispositions (avoids transient negative balances).
 * @param {Array<Object>} records
 */
function sortForexRecords(records) {
  const rank = { Acquire: 0, Dispose: 1 };
  records.sort((a, b) => {
    if (a.currency !== b.currency) return a.currency < b.currency ? -1 : 1;
    if (a.date.getTime() !== b.date.getTime()) return a.date.getTime() - b.date.getTime();
    return rank[a.direction] - rank[b.direction];
  });
}

/**
 * Current cash balance per currency, pooled across accounts, from the /balances endpoint.
 * The canonical figure used to reconcile the forex ledger. Null if it cannot be fetched.
 * @returns {Object|null} map of currency -> cash
 */
function fetchCurrentCashByCurrency() {
  try {
    const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null) || [];
    const balancesMap = fetchAccountDataInParallel(accounts, 'balances');
    const byCurrency = {};
    accounts.forEach((account) => {
      const b = extractBalancesByCurrency(balancesMap[account.id]);
      Object.keys(b).forEach((c) => { byCurrency[c] = (byCurrency[c] || 0) + b[c].cash; });
    });
    return byCurrency;
  } catch (error) {
    Logger.log(`[fetchCurrentCashByCurrency] Reconciliation skipped: ${error.message}`);
    return null;
  }
}

/**
 * Soft per-currency diagnostics: flags first-event-disposition, negative balances, and a
 * ledger-vs-current-cash mismatch (all signs of missing history). Never blocks.
 * @param {Array<Object>} records - Sorted records
 * @param {Object|null} currentCash - map of currency -> current cash (or null)
 * @returns {Object} map of currency -> {finalUnits, currentCash, flagged, reason}
 */
function computeForexDiagnostics(records, currentCash) {
  const byCurrency = {};
  records.forEach((rec) => {
    if (!byCurrency[rec.currency]) {
      byCurrency[rec.currency] = { finalUnits: 0, firstIsDispose: false, wentNegative: false, seen: false };
    }
    const d = byCurrency[rec.currency];
    if (!d.seen) { d.firstIsDispose = rec.direction === 'Dispose'; d.seen = true; }
    d.finalUnits += rec.direction === 'Acquire' ? rec.amount : -rec.amount;
    // Foreign-currency "units" are dollar amounts, so use a cents-level tolerance, not the
    // share-count tolerance, when judging negative balances and reconciliation drift.
    if (d.finalUnits < -CASH_RECONCILE_TOLERANCE) d.wentNegative = true;
  });

  Object.keys(byCurrency).forEach((currency) => {
    const d = byCurrency[currency];
    const cash = currentCash ? (currentCash[currency] || 0) : null;
    const reasons = [];
    if (d.firstIsDispose) reasons.push('first activity is a disposition (missing prior inflow)');
    if (d.wentNegative) reasons.push('balance went negative');
    if (cash !== null && Math.abs(d.finalUnits - cash) > CASH_RECONCILE_TOLERANCE) {
      reasons.push(`⚠ Trust current cash ${round4(cash)} (ledger ${round4(d.finalUnits)}) — likely incomplete history`);
    }
    d.currentCash = cash;
    d.flagged = reasons.length > 0;
    if (reasons.length > 0) d.reason = reasons.join('; ');
    else d.reason = cash === null ? 'OK (cash not reconciled)' : 'OK';
  });

  return byCurrency;
}

/**
 * Writes the Forex Ledger. Running balance and ACB are cell formulas referencing the row
 * above within the same currency group (reset to 0 at each group's first row). The realized
 * FX gain/loss is suppressed for currencies flagged with incomplete history, because their
 * running ACB is untrustworthy and a confident number would be fabricated (and would feed
 * the by-year totals).
 * @param {Array<Object>} records - Sorted records
 * @param {Object} diagnostics - map of currency -> {flagged, ...}
 * @returns {{lastDataRow: number, currencyLastRow: Object, currencyCount: number}}
 */
function writeForexLedger(records, diagnostics) {
  const isFlagged = (currency) => !!(diagnostics && diagnostics[currency] && diagnostics[currency].flagged);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(FOREX_LEDGER_SHEET) || ss.insertSheet(FOREX_LEDGER_SHEET);
  sheet.clear();

  const headers = [
    'Date', 'Currency', 'Account', 'Direction', 'Foreign Amount', 'FX→CAD', 'CAD Value',
    'Δ Units', 'Running Balance', 'Running ACB (CAD)', 'ACB/Unit (CAD)', 'Realized FX G/L (CAD)',
  ];
  sheet.appendRow(headers);

  const data = [];
  const currencyLastRow = {};
  let prevCurrency = null;

  records.forEach((rec, i) => {
    const r = i + 2;
    const firstOfGroup = rec.currency !== prevCurrency;
    const prevUnits = firstOfGroup ? '0' : `$I${r - 1}`;
    const prevACB = firstOfGroup ? '0' : `$J${r - 1}`;
    const prevACBUnit = firstOfGroup ? '0' : `$K${r - 1}`;

    const fx = historicalCadFxFormula(`$B${r}`, `$A${r}`);
    const cadValue = `=$E${r}*$F${r}`;
    let delta, runningACB, realized;
    if (rec.direction === 'Acquire') {
      delta = `=$E${r}`;
      runningACB = `=${prevACB}+$G${r}`;
      realized = '';
    } else {
      delta = `=-$E${r}`;
      // Floor ACB at 0 so an over-disposition (missing inflows) can't drive the basis
      // negative and fabricate gains on later rows.
      runningACB = `=MAX(0,${prevACB}-(${prevACBUnit}*$E${r}))`;
      // Blank realized for incomplete-history currencies (the Status column explains why);
      // blank cells contribute 0 to the SUMIFS/SUMPRODUCT totals.
      realized = isFlagged(rec.currency) ? '' : `=$G${r}-(${prevACBUnit}*$E${r})`;
    }
    const runningUnits = `=${prevUnits}+$H${r}`;
    const acbPerUnit = `=IF($I${r}=0,0,$J${r}/$I${r})`;

    data.push([
      rec.date, rec.currency, rec.account, rec.direction, rec.amount, fx, cadValue,
      delta, runningUnits, runningACB, acbPerUnit, realized,
    ]);

    currencyLastRow[rec.currency] = r;
    prevCurrency = rec.currency;
  });

  sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  sheet.getRange(2, 1, data.length, 1).setNumberFormat(CONFIG.SHEETS.DATE_FORMAT);
  sheet.getRange(2, 6, data.length, 1).setNumberFormat('0.0000'); // FX
  [7, 10, 12].forEach((col) => {
    sheet.getRange(2, col, data.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT);
  });
  formatSheetHeader(sheet);
  sheet.setFrozenRows(1);

  return {
    lastDataRow: data.length + 1,
    currencyLastRow: currencyLastRow,
    currencyCount: Object.keys(currencyLastRow).length,
  };
}

/**
 * Writes the Forex Gains summary: per-currency ACB and realized FX gains, plus a by-tax-year
 * total. Reconciles each currency's ledger balance against current cash (soft).
 * @param {{lastDataRow: number, currencyLastRow: Object}} ledgerInfo
 * @param {Object} diagnostics
 */
function writeForexSummary(ledgerInfo, diagnostics) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(FOREX_SUMMARY_SHEET) || ss.insertSheet(FOREX_SUMMARY_SHEET);
  sheet.clear();

  const ledger = `'${FOREX_LEDGER_SHEET}'`;
  const last = ledgerInfo.lastDataRow;
  const bRange = `${ledger}!$B$2:$B$${last}`; // currency
  const dRange = `${ledger}!$D$2:$D$${last}`; // direction
  const aRange = `${ledger}!$A$2:$A$${last}`; // date
  const lRange = `${ledger}!$L$2:$L$${last}`; // realized

  const currencies = Object.keys(ledgerInfo.currencyLastRow).sort();
  const section1 = [[
    'Currency', 'Ledger Balance', 'ACB (CAD)', 'ACB/Unit (CAD)', 'Current Cash', 'Status',
    'Realized FX G/L All-Time (CAD)', 'Realized FX G/L This Year (CAD)',
  ]];
  currencies.forEach((currency) => {
    const lr = ledgerInfo.currencyLastRow[currency];
    const q = `"${currency}"`;
    const diag = diagnostics[currency] || {};
    section1.push([
      currency,
      `=${ledger}!$I${lr}`,
      `=${ledger}!$J${lr}`,
      `=${ledger}!$K${lr}`,
      diag.currentCash === null || diag.currentCash === undefined ? '' : round4(diag.currentCash),
      diag.reason || 'OK',
      `=SUMIFS(${lRange},${bRange},${q},${dRange},"Dispose")`,
      `=SUMPRODUCT((${bRange}=${q})*(${dRange}="Dispose")*(YEAR(${aRange})=YEAR(TODAY()))*${lRange})`,
    ]);
  });

  sheet.getRange(1, 1, section1.length, section1[0].length).setValues(section1);
  if (currencies.length > 0) {
    sheet.getRange(2, 2, currencies.length, 1).setNumberFormat('#,##0.00');           // balance
    [3, 4, 7, 8].forEach((col) => sheet.getRange(2, col, currencies.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT));
    sheet.getRange(2, 5, currencies.length, 1).setNumberFormat('#,##0.00');           // current cash
  }
  sheet.getRange(1, 6).setNote(
    'FX capital gains treat foreign currency as property. Accurate only when every inflow ' +
    'and outflow of the currency is in the activity feed. Cross-checks soft-fail: a flagged ' +
    'currency likely has missing history, and the discrepancy may be a bug in this tool.'
  );

  // By-tax-year realized FX gains across all currencies.
  const yearTitleRow = section1.length + 2;
  sheet.getRange(yearTitleRow, 1).setValue('Realized FX Gains by Tax Year (CAD)');
  // Years come from the diagnostics' records indirectly; derive from the ledger via formulas
  // would be circular, so list a fixed recent range is avoided — instead compute from the
  // realized rows using a helper column-free SUMPRODUCT per distinct year.
  const years = forexYears(ledgerInfo);
  if (years.length > 0) {
    const section2 = [['Tax Year', 'Realized FX Gain/Loss (CAD)']];
    years.forEach((year) => {
      section2.push([year, `=SUMPRODUCT((YEAR(${aRange})=${year})*(${dRange}="Dispose")*${lRange})`]);
    });
    const headerRow = yearTitleRow + 1;
    sheet.getRange(headerRow, 1, section2.length, 2).setValues(section2);
    sheet.getRange(headerRow + 1, 2, years.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT);
  }

  formatSheetHeader(sheet);
  sheet.setFrozenRows(1);
}

/**
 * Reads the distinct tax years present in the Forex Ledger date column.
 * @param {{lastDataRow: number}} ledgerInfo
 * @returns {Array<number>} sorted distinct years
 */
function forexYears(ledgerInfo) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FOREX_LEDGER_SHEET);
  if (!sheet || ledgerInfo.lastDataRow < 2) return [];
  const dates = sheet.getRange(2, 1, ledgerInfo.lastDataRow - 1, 1).getValues();
  const years = [];
  dates.forEach(([d]) => {
    if (d instanceof Date) {
      const y = d.getFullYear();
      if (years.indexOf(y) === -1) years.push(y);
    }
  });
  years.sort();
  return years;
}
