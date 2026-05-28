/**
 * Realized round-trip trades (equities and options).
 *
 * Builds a "Realized Trades" ledger of closed (disposed) positions from the full activity
 * history, so a profit/loss can be seen per realized trade — including OPTION ROLLS, where
 * closing the old contract emits a realized row and opening the replacement does not. The
 * Options sheet only snapshots open positions / unrealized P/L; this is the gap it leaves.
 *
 * Cost base is tracked with the average-cost method (consistent with the Canadian ACB
 * calculator), per instrument, in CAD using historical (trade-date) GOOGLEFINANCE rates.
 * Apps Script cannot call GOOGLEFINANCE, so the running cost and realized P/L live in cell
 * formulas; this code only orders the legs and lays out the formulas.
 *
 * This sheet is INFORMATIONAL. Option tax treatment differs from the security ACB used by
 * the Capital Gains sheet (e.g. an option can be on income or capital account, premium on a
 * written option assigned to the underlying is handled differently), so the numbers here are
 * NOT the same figures reported on the Capital Gains sheet.
 */

const REALIZED_LEDGER_SHEET = 'Realized Trades';
const REALIZED_DEFAULT_OPTION_MULTIPLIER = 100;

/**
 * Keywords (matched case-insensitively as substrings of the activity type) that classify an
 * activity leg as OPEN (acquisition) or CLOSE (disposition). Expiration and assignment of a
 * held option are dispositions. Edit to match your brokerage's activity-type labels.
 */
const REALIZED_OPEN_KEYWORDS = ['BUYTOOPEN', 'BUY_TO_OPEN', 'BUY TO OPEN', 'BUY'];
const REALIZED_CLOSE_KEYWORDS = [
  'SELLTOCLOSE', 'SELL_TO_CLOSE', 'SELL TO CLOSE', 'SELL',
  'EXPIR', 'ASSIGN', 'EXERCISE',
];

/**
 * Entry point (wired to the SnapTrade menu). Fetches activity history, builds the realized
 * legs, and writes the Realized Trades sheet.
 */
function refreshRealizedTrades() {
  try {
    showToast('Fetching activity history…', 'Realized Trades', -1);
    debugLog('refreshRealizedTrades', 'start');

    const activities = fetchAllActivities();
    const legs = buildRealizedLegs(activities);
    debugLog('refreshRealizedTrades', `built ${legs.length} leg(s) from ${activities.length} activities`);

    const closes = legs.filter((leg) => leg.action === 'CLOSE').length;
    if (closes === 0) {
      clearToast();
      SpreadsheetApp.getUi().alert(
        'No closed (sold / expired / assigned) equity or option trades were found, so there ' +
        'are no realized trades to report.'
      );
      return;
    }

    const ledgerInfo = writeRealizedLedger(legs);

    clearToast();
    debugLog('refreshRealizedTrades', `done: ${ledgerInfo.instrumentCount} instrument(s), ${closes} close(s)`);
    SpreadsheetApp.getUi().alert(
      `Built ${closes} realized trade(s) across ${ledgerInfo.instrumentCount} instrument(s). ` +
      'See the "Realized Trades" sheet.\n\nThis is informational: option tax treatment differs ' +
      'from the security ACB, so these figures are NOT the same as the Capital Gains sheet.'
    );
  } catch (error) {
    clearToast();
    debugLog('refreshRealizedTrades', 'error', error.stack || error.message);
    SpreadsheetApp.getUi().alert(`Error building realized trades: ${error.message}`);
  }
}

/**
 * Classifies an activity leg as OPEN, CLOSE, or null (not a tradable open/close).
 * Falls back to the units sign when the type is ambiguous (positive units open, negative
 * units close), which covers feeds that report a bare "TRADE" type.
 * @param {Object} tx - Activity object
 * @returns {('OPEN'|'CLOSE'|null)}
 */
function classifyRealizedLeg(tx) {
  const type = (tx.type || '').toString().toUpperCase().replace(/[^A-Z_ ]/g, '');
  const units = Number(tx.units) || 0;

  const matches = (keywords) => keywords.some((kw) => type.indexOf(kw) !== -1);

  // Explicit open/close tokens win first, so SELL_TO_OPEN (opening a short) and BUY_TO_CLOSE
  // (closing a short) are classified by intent rather than by the BUY/SELL side — a short is
  // opened with a sell and closed with a buy, which the bare BUY/SELL rules get backwards.
  if (type.indexOf('OPEN') !== -1) return 'OPEN';
  if (type.indexOf('CLOSE') !== -1) return 'CLOSE';
  // Then expiry/assignment (a held option disposed) and the plain BUY/SELL convention.
  if (matches(REALIZED_CLOSE_KEYWORDS)) return 'CLOSE';
  if (matches(REALIZED_OPEN_KEYWORDS)) return 'OPEN';
  // Ambiguous type: lean on the units sign.
  if (units > 0) return 'OPEN';
  if (units < 0) return 'CLOSE';
  return null;
}

/**
 * Builds grouped, chronologically ordered realized legs from the activity feed. Pure: takes
 * no spreadsheet/network/properties dependency, so it is unit-testable. Equities are keyed by
 * symbol; options are keyed by their OCC option ticker. Activities that are neither (cash,
 * dividends, interest) are skipped.
 *
 * Legs are grouped by instrument, then ordered by date with opens before closes on the same
 * day (so a same-day open feeds the average cost before a same-day close consumes it).
 * @param {Array} activities
 * @returns {Array<Object>} legs with {date, instrumentType, symbol, multiplier, action,
 *   units, proceeds, currency, account}
 */
function buildRealizedLegs(activities) {
  const legs = [];

  activities.forEach((tx) => {
    const action = classifyRealizedLeg(tx);
    if (!action) return;

    const date = parseActivityDate_(tx.trade_date || tx.settlement_date);
    if (!date) return;

    const typeStr = (tx.type || '').toString().toUpperCase();
    const optionInfo = extractOptionInfo(tx);
    const isOption = !!tx.option_symbol || typeStr.indexOf('OPTION') !== -1 || !!optionInfo.ticker;

    let symbol, instrumentType, multiplier;
    if (isOption) {
      symbol = optionInfo.ticker;
      if (!symbol) return; // option leg we cannot key on
      instrumentType = 'Option';
      multiplier = Number(tx.multiplier) || Number(optionInfo.multiplier) || REALIZED_DEFAULT_OPTION_MULTIPLIER;
    } else {
      const symbolInfo = extractSymbolInfo(tx.symbol);
      symbol = symbolInfo.symbol;
      if (!symbol || symbol === 'N/A') return;
      instrumentType = 'Equity';
      multiplier = 1;
    }

    const units = Math.abs(Number(tx.units) || 0);
    if (units <= 0) return; // an open/close with no quantity carries no cost or proceeds

    // Proceeds/cost are native, per unit excluding the multiplier (the formula re-applies it).
    // Expiry/assignment of a long option usually has no amount: treat it as a worthless
    // disposition at 0 proceeds unless the feed supplies a figure.
    const amount = Math.abs(Number(tx.amount) || 0);
    const price = Math.abs(Number(tx.price) || 0);
    let proceeds;
    // The ledger formula re-applies units and multiplier, so proceeds must be the native
    // price per single share/contract. `amount` is the total trade value, so divide it by
    // both units and multiplier; `price` is already per single unit.
    if (amount > 0) proceeds = amount / (units * multiplier);
    else proceeds = price; // per-share/contract price; 0 for a worthless expiry

    const currency = (tx.currency && tx.currency.code)
      || (tx.symbol && tx.symbol.currency && tx.symbol.currency.code)
      || 'USD';

    // Position sign follows the BUY/SELL side, not open/close: a buy adds contracts (+), a sell
    // removes them (−). This is what makes a sell-to-open a short (−) and a buy-to-close a cover
    // (+). Fall back to the raw units sign, then to the action for typeless expiry/assignment.
    let side;
    if (typeStr.indexOf('BUY') !== -1) side = 1;
    else if (typeStr.indexOf('SELL') !== -1) side = -1;
    else {
      const rawUnits = Number(tx.units) || 0;
      side = rawUnits > 0 ? 1 : (rawUnits < 0 ? -1 : (action === 'OPEN' ? 1 : -1));
    }

    legs.push({
      date: date,
      instrumentType: instrumentType,
      symbol: symbol,
      multiplier: multiplier,
      action: action,
      side: side,
      units: units,
      proceeds: proceeds,
      currency: currency,
      account: (tx.account && (tx.account.name || tx.account.number)) || '',
    });
  });

  sortRealizedLegs(legs);
  return legs;
}

/**
 * Sorts legs by symbol, then date, then action so that on a given day opens are applied
 * before closes (avoids a close consuming cost that a same-day open has not yet added).
 * @param {Array<Object>} legs
 */
function sortRealizedLegs(legs) {
  const rank = { OPEN: 0, CLOSE: 1 };
  legs.sort((a, b) => {
    if (a.symbol !== b.symbol) return a.symbol < b.symbol ? -1 : 1;
    if (a.date.getTime() !== b.date.getTime()) return a.date.getTime() - b.date.getTime();
    return rank[a.action] - rank[b.action];
  });
}

/**
 * Pure native-currency (FX=1) simulation of the signed running-cost / realized-P/L model the
 * ledger encodes in cell formulas. Used to unit-test the math (the spreadsheet formulas can't
 * run under Node). Handles long and short round trips symmetrically.
 * @param {Array<Object>} legs - Output of buildRealizedLegs (must include .side)
 * @returns {Array<{symbol: string, deltaUnits: number, runningUnits: number, realized: ?number}>}
 */
function computeRealizedRows(legs) {
  const rows = [];
  let prevSymbol = null;
  let units = 0;   // signed running contracts
  let basis = 0;   // signed running cost basis (native)
  legs.forEach((leg) => {
    if (leg.symbol !== prevSymbol) { units = 0; basis = 0; }
    const G = leg.multiplier;
    const F = leg.units;
    const delta = leg.side * F;
    const prevUnits = units;
    const prevBasis = basis;
    const prevPerUnit = prevUnits === 0 ? 0 : prevBasis / (prevUnits * G);
    const value = F * leg.proceeds * G; // gross trade value (FX=1)
    const opening = prevUnits === 0 || Math.sign(delta) === Math.sign(prevUnits);
    let realized = null;
    if (opening) {
      basis = prevBasis + Math.sign(delta) * value;
    } else {
      realized = Math.sign(prevUnits) * (value - prevPerUnit * F * G);
      basis = prevBasis + prevPerUnit * delta * G;
    }
    units = prevUnits + delta;
    rows.push({ symbol: leg.symbol, deltaUnits: delta, runningUnits: units, realized: realized });
    prevSymbol = leg.symbol;
  });
  return rows;
}

/**
 * Writes the Realized Trades sheet: a per-close ledger with running average cost and realized
 * P/L (cell formulas grouped per instrument, like the ACB / Forex ledgers), then a by-tax-year
 * summary splitting Equity vs Option realized P/L via SUMPRODUCT.
 *
 * Running ACB is floored at MAX(0,…) so an over-disposition from incomplete history cannot
 * drive the basis negative and fabricate gains on later rows (same guard as the Forex ledger).
 * @param {Array<Object>} legs - Grouped, ordered legs
 * @returns {{lastDataRow: number, instrumentCount: number}}
 */
function writeRealizedLedger(legs) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(REALIZED_LEDGER_SHEET) || ss.insertSheet(REALIZED_LEDGER_SHEET);
  sheet.clear();

  const headers = [
    'Date', 'Account', 'Instrument Type', 'Symbol', 'Action', 'Units/Contracts', 'Multiplier',
    'Proceeds (native)', 'Currency', 'FX→CAD', 'Proceeds (CAD)', 'Δ Units', 'Running Units',
    'Running ACB (CAD)', 'ACB/Unit (CAD)', 'Realized P/L (CAD)',
  ];
  sheet.appendRow(headers);

  const data = [];
  const instruments = {};
  let prevSymbol = null;

  legs.forEach((leg, i) => {
    const r = i + 2; // sheet row (data starts at row 2)
    const firstOfGroup = leg.symbol !== prevSymbol;
    const prevUnits = firstOfGroup ? '0' : `$M${r - 1}`;   // signed running contracts
    const prevACB = firstOfGroup ? '0' : `$N${r - 1}`;     // signed running cost basis (CAD)
    const prevACBUnit = firstOfGroup ? '0' : `$O${r - 1}`; // CAD basis per single unit

    // FX→CAD on the trade date (see historicalCadFxFormula); col I currency, col A date.
    const fx = historicalCadFxFormula(`$I${r}`, `$A${r}`);
    // CAD trade value (gross magnitude) = price/unit x units x multiplier x FX.
    const proceedsCAD = `=$F${r}*$H${r}*$G${r}*$J${r}`;

    // Signed position delta: + for a buy, − for a sell (so a sell-to-open goes short).
    const delta = leg.side > 0 ? `=$F${r}` : `=-$F${r}`;
    const runningUnits = `=${prevUnits}+$L${r}`;

    // A leg "opens" (adds exposure) when the position is flat or the trade is the same sign as
    // the current position; otherwise it "closes" (reduces) and realizes P/L. This handles both
    // long (buy-to-open / sell-to-close) and short (sell-to-open / buy-to-close) round trips.
    const isOpening = `OR(${prevUnits}=0,SIGN($L${r})=SIGN(${prevUnits}))`;
    // Opening: basis moves by the signed cash (buy adds cost +, sell adds credit −). Closing:
    // basis unwinds proportionally at the prior per-unit basis.
    const runningACB = `=IF(${isOpening},${prevACB}+SIGN($L${r})*$K${r},${prevACB}+${prevACBUnit}*$L${r}*$G${r})`;
    // Basis per single unit = signed basis / signed units (so it stays a positive price).
    const acbPerUnit = `=IF($M${r}=0,0,$N${r}/($M${r}*$G${r}))`;
    // Realized only on a closing leg: gain = side of the position × (trade value − basis of the
    // units closed). Long: proceeds − cost. Short: premium − buyback.
    const realized = `=IF(${isOpening},"",SIGN(${prevUnits})*($K${r}-${prevACBUnit}*$F${r}*$G${r}))`;

    data.push([
      leg.date, leg.account, leg.instrumentType, leg.symbol, leg.action, leg.units,
      leg.multiplier, leg.proceeds, leg.currency, fx, proceedsCAD, delta, runningUnits,
      runningACB, acbPerUnit, realized,
    ]);

    instruments[leg.symbol] = true;
    prevSymbol = leg.symbol;
  });

  sheet.getRange(2, 1, data.length, headers.length).setValues(data);

  const lastDataRow = data.length + 1;
  sheet.getRange(2, 1, data.length, 1).setNumberFormat(CONFIG.SHEETS.DATE_FORMAT); // Date
  sheet.getRange(2, 10, data.length, 1).setNumberFormat('0.0000');                  // FX
  [8, 11, 14, 15, 16].forEach((col) => {
    sheet.getRange(2, col, data.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT);
  });

  formatSheetHeader(sheet);
  sheet.setFrozenRows(1);

  writeRealizedSummary(sheet, lastDataRow);

  return { lastDataRow: lastDataRow, instrumentCount: Object.keys(instruments).length };
}

/**
 * Appends a by-tax-year realized P/L summary (Equity vs Option columns) below the ledger,
 * mirroring the Forex Gains summary. Totals sum the realized column over CLOSE rows of each
 * type with SUMPRODUCT, and a Status note flags this as informational.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The Realized Trades sheet
 * @param {number} lastDataRow - Last row of ledger data (header is row 1)
 */
function writeRealizedSummary(sheet, lastDataRow) {
  const aRange = `$A$2:$A$${lastDataRow}`; // date
  const cRange = `$C$2:$C$${lastDataRow}`; // instrument type
  const eRange = `$E$2:$E$${lastDataRow}`; // action
  const pRange = `$P$2:$P$${lastDataRow}`; // realized P/L

  // Distinct close years, read from the data already written to the sheet.
  const years = [];
  if (lastDataRow >= 2) {
    const rows = sheet.getRange(2, 1, lastDataRow - 1, 5).getValues(); // Date..Action
    rows.forEach((row) => {
      if (row[4] !== 'CLOSE') return; // only closes realize P/L
      const d = row[0];
      if (d instanceof Date) {
        const y = d.getFullYear();
        if (years.indexOf(y) === -1) years.push(y);
      }
    });
  }
  years.sort();

  const titleRow = lastDataRow + 2; // blank spacer row between sections
  sheet.getRange(titleRow, 1).setValue('Realized P/L by Tax Year (CAD)');
  sheet.getRange(titleRow, 1).setNote(
    'Informational only. Option tax treatment differs from the security ACB (an option may be ' +
    'on income or capital account, and assigned premium is handled differently), so these ' +
    'figures are NOT the same as the Capital Gains sheet. Average-cost basis, floored at 0 to ' +
    'avoid fabricating gains when earlier activity is missing.'
  );

  const summary = [['Tax Year', 'Equity P/L (CAD)', 'Option P/L (CAD)', 'Total (CAD)']];
  years.forEach((year) => {
    summary.push([
      year,
      `=SUMPRODUCT((YEAR(${aRange})=${year})*(${eRange}="CLOSE")*(${cRange}="Equity")*${pRange})`,
      `=SUMPRODUCT((YEAR(${aRange})=${year})*(${eRange}="CLOSE")*(${cRange}="Option")*${pRange})`,
      `=SUMPRODUCT((YEAR(${aRange})=${year})*(${eRange}="CLOSE")*${pRange})`,
    ]);
  });

  const headerRow = titleRow + 1;
  sheet.getRange(headerRow, 1, summary.length, summary[0].length).setValues(summary);
  if (years.length > 0) {
    sheet.getRange(headerRow + 1, 2, years.length, 3).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT);
  }
}
