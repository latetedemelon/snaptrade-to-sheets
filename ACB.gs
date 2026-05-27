/**
 * Adjusted Cost Base (ACB) and realized capital-gains calculator.
 *
 * Builds two sheets from the full SnapTrade activity history:
 *   - "ACB Ledger": one row per buy / sell / return-of-capital, grouped by symbol and
 *     ordered by trade date, with a running ACB and per-sale realized gain/loss.
 *   - "Capital Gains": per-symbol current ACB plus realized gains by tax year.
 *
 * ACB is tracked in CAD (the basis the CRA requires). Each transaction is converted at
 * the GOOGLEFINANCE rate on its own trade date, written as a live cell formula so the
 * numbers stay auditable and recalculate automatically. Apps Script cannot call
 * GOOGLEFINANCE directly, so all currency and running-total math lives in cell formulas;
 * this code only orders the data and lays out the formulas.
 *
 * Pooling follows the CRA identical-property rule: a symbol is pooled across all accounts.
 */

const ACB_LEDGER_SHEET = 'ACB Ledger';
const ACB_SUMMARY_SHEET = 'Capital Gains';
// Optional, user-maintained sheet for seeding cost base that predates the available
// activity window. Columns: Symbol | As-of Date | Units | Total ACB (CAD).
const ACB_OPENING_SHEET = 'ACB Opening Balances';

// Activity history is requested from this date so ACB is computed from inception.
const ACB_HISTORY_START = '1990-01-01';

// Tolerance (in units) when reconciling the ledger's final share count against the
// current holdings reported by the brokerage.
const ACB_UNIT_TOLERANCE = 1e-4;

/**
 * Keywords (matched case-insensitively as substrings of the activity type) that map a
 * SnapTrade activity to an ACB action. Reinvested distributions (DRIP) are treated as
 * buys; return-of-capital reduces ACB without changing units. A dividend that carries a
 * positive unit count is also treated as a reinvestment buy. Edit these to match your
 * brokerage's activity-type labels.
 */
const ACB_TYPE_KEYWORDS = {
  BUY: ['BUY', 'REINVEST', 'DRIP'],
  SELL: ['SELL'],
  ROC: ['RETURNOFCAPITAL', 'RETURN OF CAPITAL', 'RETURN_OF_CAPITAL', 'ROC'],
};

/**
 * Entry point (wired to the SnapTrade menu). Fetches activity history, computes ACB, and
 * writes the ACB Ledger and Capital Gains sheets.
 */
function refreshACB() {
  try {
    showToast('Fetching activity history…', 'ACB', -1);
    debugLog('refreshACB', 'start');

    const activities = fetchAllActivities();
    debugLog('refreshACB', `retrieved ${activities.length} activities`);

    // Seed cost base that predates the available activity window (optional).
    const openingRecords = readOpeningBalances();
    const records = openingRecords.concat(buildAcbRecords(activities));
    debugLog('refreshACB', `${records.length} records (${openingRecords.length} opening)`);

    if (records.length === 0) {
      clearToast();
      SpreadsheetApp.getUi().alert(
        'No buy, sell, or return-of-capital activity was found to compute ACB. ' +
        'Try refreshing transactions first, or check the activity-type mapping in ACB.gs.'
      );
      return;
    }

    sortAcbRecords(records);

    // Reconcile against what the brokerage currently reports so an incomplete activity
    // window is surfaced rather than silently producing a wrong cost base.
    const positions = fetchCurrentPositionsBySymbol();
    const diagnostics = computeAcbDiagnostics(records, positions);

    const ledgerInfo = writeAcbLedger(records);
    writeCapitalGainsSummary(records, ledgerInfo, diagnostics, positions);

    clearToast();
    const flagged = Object.keys(diagnostics).filter((s) => diagnostics[s].flagged);
    debugLog('refreshACB', `done: ${ledgerInfo.symbolCount} symbol(s), ${flagged.length} flagged`,
      flagged.map((s) => `${s}: ${diagnostics[s].reason}`));
    let message = `Calculated ACB for ${ledgerInfo.symbolCount} symbol(s) across ${records.length} transactions. ` +
      'See the "ACB Ledger" and "Capital Gains" sheets.';
    if (flagged.length > 0) {
      message += `\n\n⚠️ ${flagged.length} symbol(s) may have incomplete history (see the Status column on ` +
        'the Capital Gains sheet). ACB is only correct when activity is available from the original ' +
        'purchase. Seed earlier holdings via an "' + ACB_OPENING_SHEET + '" sheet.';
    }
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    clearToast();
    debugLog('refreshACB', 'error', error.stack || error.message);
    SpreadsheetApp.getUi().alert(`Error calculating ACB: ${error.message}`);
  }
}

/**
 * Fetches the full activity history across all accounts.
 * @returns {Array} Array of activity objects
 */
function fetchAllActivities() {
  const endDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const activities = snapTradeRequest('GET', '/api/v1/activities', {
    startDate: ACB_HISTORY_START,
    endDate: endDate,
  }, null);
  return Array.isArray(activities) ? activities : [];
}

/**
 * Classifies a SnapTrade activity into an ACB action.
 * @param {Object} tx - Activity object
 * @returns {('BUY'|'SELL'|'ROC'|null)}
 */
function classifyAcbActivity(tx) {
  const type = (tx.type || '').toString().toUpperCase();
  const units = Number(tx.units) || 0;

  // Options are out of scope for this calculator.
  if (tx.option_symbol || type.indexOf('OPTION') !== -1) return null;

  const matches = (keywords) => keywords.some((kw) => type.indexOf(kw) !== -1);

  if (matches(ACB_TYPE_KEYWORDS.ROC)) return 'ROC';
  if (matches(ACB_TYPE_KEYWORDS.SELL)) return 'SELL';
  if (matches(ACB_TYPE_KEYWORDS.BUY)) return 'BUY';
  // Reinvested dividend: a dividend that delivered shares is a buy.
  if (type.indexOf('DIVIDEND') !== -1 && units > 0) return 'BUY';
  return null;
}

/**
 * Normalizes classifiable activities into ACB records.
 * @param {Array} activities
 * @returns {Array<Object>} records with {date, symbol, account, action, units, price, fee, amount, currency}
 */
function buildAcbRecords(activities) {
  const records = [];

  activities.forEach((tx) => {
    const action = classifyAcbActivity(tx);
    if (!action) return;

    const dateStr = tx.trade_date || tx.settlement_date;
    const date = dateStr ? new Date(dateStr) : null;
    if (!date || isNaN(date.getTime())) return;

    const symbolInfo = extractSymbolInfo(tx.symbol);
    const symbol = symbolInfo.symbol;
    if (!symbol || symbol === 'N/A') return;

    const units = Math.abs(Number(tx.units) || 0);
    const price = Math.abs(Number(tx.price) || 0);
    const fee = Math.abs(Number(tx.fee) || 0);
    const amount = Math.abs(Number(tx.amount) || 0);
    const currency = (tx.currency && tx.currency.code)
      || (tx.symbol && tx.symbol.currency && tx.symbol.currency.code)
      || 'USD';

    // Buys and sells require a quantity; ROC requires a distribution amount.
    if ((action === 'BUY' || action === 'SELL') && units <= 0) return;
    if (action === 'ROC' && amount <= 0) return;

    records.push({
      date: date,
      symbol: symbol,
      account: (tx.account && (tx.account.name || tx.account.number)) || '',
      action: action,
      units: units,
      price: price,
      fee: fee,
      amount: amount,
      currency: currency,
    });
  });

  return records;
}

/**
 * Reads the optional opening-balances sheet into seed records so that cost base which
 * predates the available activity window can be supplied manually. This is the primary
 * remedy when a brokerage does not return a security's original purchase.
 * Expected columns: Symbol | As-of Date | Units | Total ACB (CAD).
 * @returns {Array<Object>} opening records (action 'OPENING')
 */
function readOpeningBalances() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ACB_OPENING_SHEET);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  const records = [];
  for (let i = 1; i < values.length; i++) { // skip header
    const [symbol, asOf, units, acbCad] = values[i];
    if (!symbol) continue;
    const date = asOf instanceof Date ? asOf : new Date(asOf);
    if (isNaN(date.getTime())) continue;
    records.push({
      date: date,
      symbol: symbol.toString().trim(),
      account: 'Opening balance',
      action: 'OPENING',
      units: Math.abs(Number(units) || 0),
      price: 0,
      fee: 0,
      amount: Math.abs(Number(acbCad) || 0), // already in CAD
      currency: 'CAD',
    });
  }
  return records;
}

/**
 * Returns current positions per symbol, pooled across all accounts, from the holdings
 * endpoint: units, broker-reported book cost (units x average_purchase_price), and native
 * currency. Used to reconcile the ledger against current holdings and the broker's average
 * cost. Returns null if holdings cannot be fetched (reconciliation is then skipped).
 * @returns {Object|null} map of symbol -> {units, costNative, currency}
 */
function fetchCurrentPositionsBySymbol() {
  try {
    const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null) || [];
    const holdingsMap = fetchAccountDataInParallel(accounts, 'holdings');
    const bySymbol = {};

    accounts.forEach((account) => {
      const holdings = holdingsMap[account.id];
      if (!holdings || !holdings.positions) return;
      holdings.positions.forEach((position) => {
        const info = extractSymbolInfo(position.symbol);
        if (!info.symbol || info.symbol === 'N/A') return;
        const units = Number(position.units) || 0;
        const avg = Number(position.average_purchase_price) || 0;
        const currency = (position.currency && position.currency.code) || 'USD';
        if (!bySymbol[info.symbol]) bySymbol[info.symbol] = { units: 0, costNative: 0, currency: currency };
        bySymbol[info.symbol].units += units;
        bySymbol[info.symbol].costNative += units * avg;
      });
    });

    return bySymbol;
  } catch (error) {
    Logger.log(`[fetchCurrentPositionsBySymbol] Reconciliation skipped: ${error.message}`);
    return null;
  }
}

/**
 * Computes per-symbol completeness diagnostics by replaying unit counts numerically.
 * Flags a symbol when the first event is a sale, when running units ever go negative, or
 * when the ledger's final share count disagrees with the brokerage's current holdings —
 * all signs that activity history is missing earlier transactions.
 * @param {Array<Object>} records - Sorted records
 * @param {Object|null} positions - map of symbol -> {units, costNative, currency} (or null)
 * @returns {Object} map of symbol -> {finalUnits, currentUnits, flagged, reason}
 */
function computeAcbDiagnostics(records, positions) {
  const bySymbol = {};

  records.forEach((rec) => {
    if (!bySymbol[rec.symbol]) {
      bySymbol[rec.symbol] = { finalUnits: 0, firstIsSell: false, wentNegative: false, seen: false };
    }
    const d = bySymbol[rec.symbol];
    if (!d.seen) {
      d.firstIsSell = rec.action === 'SELL';
      d.seen = true;
    }
    if (rec.action === 'SELL') d.finalUnits -= rec.units;
    else if (rec.action !== 'ROC') d.finalUnits += rec.units; // BUY / OPENING
    if (d.finalUnits < -ACB_UNIT_TOLERANCE) d.wentNegative = true;
  });

  Object.keys(bySymbol).forEach((symbol) => {
    const d = bySymbol[symbol];
    const cur = positions ? (positions[symbol] ? positions[symbol].units : 0) : null;
    const reasons = [];
    if (d.firstIsSell) reasons.push('first activity is a sale');
    if (d.wentNegative) reasons.push('units went negative');
    if (cur !== null && Math.abs(d.finalUnits - cur) > ACB_UNIT_TOLERANCE) {
      reasons.push(`ledger units ${round4(d.finalUnits)} ≠ holdings ${round4(cur)}`);
    }
    d.currentUnits = cur;
    d.flagged = reasons.length > 0;
    if (reasons.length > 0) d.reason = reasons.join('; ');
    else d.reason = cur === null ? 'OK (holdings not reconciled)' : 'OK';
  });

  return bySymbol;
}

/** Rounds to 4 decimals for display in diagnostic messages. */
function round4(n) {
  return Math.round(n * 10000) / 10000;
}

/**
 * Returns an A1 formula giving the CAD exchange rate for a currency on a given date, using
 * the last available GOOGLEFINANCE close in a short back-window (handles weekends/holidays)
 * and falling back to the current rate then 1.0. Returns 1 when the currency is CAD.
 * @param {string} curRef - A1 reference to the currency-code cell (e.g. "$H5")
 * @param {string} dateRef - A1 reference to the date cell (e.g. "$A5")
 * @returns {string} formula string
 */
function historicalCadFxFormula(curRef, dateRef) {
  return `=IF(${curRef}="CAD",1,IFERROR(LET(t,GOOGLEFINANCE("CURRENCY:"&${curRef}&"CAD","price",${dateRef}-7,${dateRef}),INDEX(t,ROWS(t),2)),IFERROR(GOOGLEFINANCE("CURRENCY:"&${curRef}&"CAD"),1)))`;
}

/**
 * Parses an activity date string ("YYYY-MM-DD" or ISO) into a local-midnight Date so the
 * calendar day — and therefore the tax year — is preserved regardless of timezone. Parsing
 * "YYYY-MM-DD" with `new Date(str)` treats it as UTC midnight, which can roll back a day (and
 * a year, on Jan 1) in negative-offset zones and disagree with the sheet's YEAR() formulas.
 * @param {string} dateStr
 * @returns {Date|null} null if unparseable
 */
function parseActivityDate_(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Sorts records by symbol, then trade date, then action so that on a given day opening
 * balances and buys are applied before return-of-capital and sells (avoids transient
 * negative unit counts).
 * @param {Array<Object>} records
 */
function sortAcbRecords(records) {
  const actionRank = { OPENING: -1, BUY: 0, ROC: 1, SELL: 2 };
  records.sort((a, b) => {
    if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
    if (a.date.getTime() !== b.date.getTime()) return a.date.getTime() - b.date.getTime();
    return actionRank[a.action] - actionRank[b.action];
  });
}

/**
 * Writes the ACB Ledger sheet. Running totals are cell formulas that reference the row
 * directly above within the same symbol group (and reset to 0 at each group's first row).
 * @param {Array<Object>} records - Sorted records
 * @returns {{lastDataRow: number, symbolLastRow: Object, symbolCount: number}}
 */
function writeAcbLedger(records) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ACB_LEDGER_SHEET) || ss.insertSheet(ACB_LEDGER_SHEET);
  sheet.clear();

  const headers = [
    'Date', 'Account', 'Symbol', 'Action', 'Units', 'Unit Price / Amount', 'Fee',
    'Currency', 'FX→CAD', 'Amount (CAD)', 'Δ Units', 'Running Units',
    'Running ACB (CAD)', 'ACB/Unit (CAD)', 'Realized Gain/Loss (CAD)',
  ];
  sheet.appendRow(headers);

  const data = [];
  const symbolLastRow = {};
  let prevSymbol = null;

  records.forEach((rec, i) => {
    const r = i + 2; // sheet row (data starts at row 2)
    const firstOfGroup = rec.symbol !== prevSymbol;
    const prevUnits = firstOfGroup ? '0' : `$L${r - 1}`;
    const prevACB = firstOfGroup ? '0' : `$M${r - 1}`;
    const prevACBUnit = firstOfGroup ? '0' : `$N${r - 1}`;

    // FX→CAD on the trade date (see historicalCadFxFormula).
    const fx = historicalCadFxFormula(`$H${r}`, `$A${r}`);

    let unitsCell, priceCell, feeCell, amountCAD, deltaUnits, runningACB, realized;
    if (rec.action === 'OPENING') {
      // Seeded pre-window cost base; the amount is already a total in CAD.
      unitsCell = rec.units; priceCell = rec.amount; feeCell = '';
      amountCAD = `=$F${r}*$I${r}`;
      deltaUnits = `=$E${r}`;
      runningACB = `=${prevACB}+$J${r}`;
      realized = '';
    } else if (rec.action === 'BUY') {
      unitsCell = rec.units; priceCell = rec.price; feeCell = rec.fee;
      amountCAD = `=($E${r}*$F${r}+$G${r})*$I${r}`;
      deltaUnits = `=$E${r}`;
      runningACB = `=${prevACB}+$J${r}`;
      realized = '';
    } else if (rec.action === 'SELL') {
      unitsCell = rec.units; priceCell = rec.price; feeCell = rec.fee;
      amountCAD = `=($E${r}*$F${r}-$G${r})*$I${r}`;
      deltaUnits = `=-$E${r}`;
      runningACB = `=${prevACB}-(${prevACBUnit}*$E${r})`;
      realized = `=$J${r}-(${prevACBUnit}*$E${r})`;
    } else { // ROC
      unitsCell = ''; priceCell = rec.amount; feeCell = '';
      amountCAD = `=$F${r}*$I${r}`;
      deltaUnits = 0;
      runningACB = `=MAX(0,${prevACB}-$J${r})`;
      realized = '';
    }

    const runningUnits = `=${prevUnits}+$K${r}`;
    const acbPerUnit = `=IF($L${r}=0,0,$M${r}/$L${r})`;

    data.push([
      rec.date, rec.account, rec.symbol, rec.action, unitsCell, priceCell, feeCell,
      rec.currency, fx, amountCAD, deltaUnits, runningUnits, runningACB, acbPerUnit, realized,
    ]);

    symbolLastRow[rec.symbol] = r;
    prevSymbol = rec.symbol;
  });

  sheet.getRange(2, 1, data.length, headers.length).setValues(data);

  const lastDataRow = data.length + 1;
  sheet.getRange(2, 1, data.length, 1).setNumberFormat(CONFIG.SHEETS.DATE_FORMAT); // Date
  sheet.getRange(2, 9, data.length, 1).setNumberFormat('0.0000'); // FX
  [6, 7, 10, 13, 14, 15].forEach((col) => {
    sheet.getRange(2, col, data.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT);
  });

  formatSheetHeader(sheet);
  sheet.setFrozenRows(1);

  return { lastDataRow: lastDataRow, symbolLastRow: symbolLastRow, symbolCount: Object.keys(symbolLastRow).length };
}

/**
 * Writes the Capital Gains summary: per-symbol current ACB plus realized gains by tax year.
 * @param {Array<Object>} records - Sorted records
 * @param {{lastDataRow: number, symbolLastRow: Object}} ledgerInfo
 * @param {Object} diagnostics - map of symbol -> completeness diagnostics
 * @param {Object|null} positions - map of symbol -> {units, costNative, currency}
 */
function writeCapitalGainsSummary(records, ledgerInfo, diagnostics, positions) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ACB_SUMMARY_SHEET) || ss.insertSheet(ACB_SUMMARY_SHEET);
  sheet.clear();

  const ledger = `'${ACB_LEDGER_SHEET}'`;
  const last = ledgerInfo.lastDataRow;
  const cRange = `${ledger}!$C$2:$C$${last}`;
  const dRange = `${ledger}!$D$2:$D$${last}`;
  const aRange = `${ledger}!$A$2:$A$${last}`;
  const oRange = `${ledger}!$O$2:$O$${last}`;

  // Section 1: per-symbol holdings, realized gains, and a completeness Status.
  const symbols = Object.keys(ledgerInfo.symbolLastRow).sort();
  const section1 = [[
    'Symbol', 'Ledger Units', 'Total ACB (CAD)', 'ACB/Unit (CAD)',
    'Realized G/L All-Time (CAD)', 'Realized G/L This Year (CAD)',
    'Holdings Units', 'Status', 'Broker Avg Cost (native)', 'Cost Check',
  ]];

  symbols.forEach((symbol, idx) => {
    const row = idx + 2; // sheet row for this symbol
    const lr = ledgerInfo.symbolLastRow[symbol];
    const q = `"${symbol.replace(/"/g, '""')}"`;
    const diag = diagnostics[symbol] || {};
    const pos = positions ? positions[symbol] : null;
    const brokerAvg = pos && pos.units ? round4(pos.costNative / pos.units) : '';

    // Soft cost reconciliation: compare our CAD ACB/unit (col D) to the broker's average
    // cost (col I). Only comparable when the security trades in CAD; otherwise the broker
    // figure is native and our ACB is CAD, so we don't flag. Never blocks.
    let costCheck;
    if (!pos || !pos.units) {
      costCheck = '';
    } else if (pos.currency === 'CAD') {
      costCheck = `=IF($I${row}="","",IF(ABS($D${row}-$I${row})<=0.01,"OK","⚠ Trust broker "&TEXT($I${row},"0.00")&" (ACB "&TEXT($D${row},"0.00")&") — likely a spreadsheet bug"))`;
    } else {
      costCheck = `n/a (native ${pos.currency} ≠ CAD)`;
    }

    section1.push([
      symbol,
      `=${ledger}!$L${lr}`,
      `=${ledger}!$M${lr}`,
      `=${ledger}!$N${lr}`,
      `=SUMIFS(${oRange},${cRange},${q},${dRange},"SELL")`,
      `=SUMPRODUCT((${cRange}=${q})*(${dRange}="SELL")*(YEAR(${aRange})=YEAR(TODAY()))*${oRange})`,
      diag.currentUnits === null || diag.currentUnits === undefined ? '' : round4(diag.currentUnits),
      diag.reason || 'OK',
      brokerAvg,
      costCheck,
    ]);
  });

  sheet.getRange(1, 1, section1.length, section1[0].length).setValues(section1);
  if (symbols.length > 0) {
    sheet.getRange(2, 2, symbols.length, 1).setNumberFormat('#,##0.####'); // ledger units
    [3, 4, 5, 6].forEach((col) => {
      sheet.getRange(2, col, symbols.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT);
    });
    sheet.getRange(2, 7, symbols.length, 1).setNumberFormat('#,##0.####'); // holdings units
    sheet.getRange(2, 9, symbols.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT); // broker avg cost
  }

  // Explain the completeness caveat directly on the sheet.
  sheet.getRange(1, 8).setNote(
    'ACB is a running total from each security\'s first purchase. It is only correct when ' +
    'the activity history covers the original buys. Activity was requested from ' +
    ACB_HISTORY_START + ' to today; if your brokerage returns a shorter window, seed the ' +
    'earlier cost base in an "' + ACB_OPENING_SHEET + '" sheet ' +
    '(columns: Symbol | As-of Date | Units | Total ACB (CAD)). Flagged rows show where the ' +
    'ledger\'s share count disagrees with current holdings or a sale precedes any buy.'
  );

  // Section 2: realized capital gains by tax year (across all symbols).
  const years = [];
  records.forEach((rec) => {
    if (rec.action !== 'SELL') return;
    const y = rec.date.getFullYear();
    if (years.indexOf(y) === -1) years.push(y);
  });
  years.sort();

  if (years.length > 0) {
    const titleRow = section1.length + 2; // blank spacer row between sections
    sheet.getRange(titleRow, 1).setValue('Realized Capital Gains by Tax Year');

    const section2 = [['Tax Year', 'Realized Gain/Loss (CAD)']];
    years.forEach((year) => {
      section2.push([
        year,
        `=SUMPRODUCT((YEAR(${aRange})=${year})*(${dRange}="SELL")*${oRange})`,
      ]);
    });

    const headerRow = titleRow + 1;
    sheet.getRange(headerRow, 1, section2.length, 2).setValues(section2);
    sheet.getRange(headerRow + 1, 2, years.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT);
  }

  formatSheetHeader(sheet);
  sheet.setFrozenRows(1);
}
