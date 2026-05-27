/**
 * Options holdings.
 *
 * Equity positions stay on the Holdings sheet; options get their own sheet because they
 * need contract-level fields (underlying, type, strike, expiry) and a contract multiplier
 * (typically 100) applied to market value and cost basis.
 */

const OPTIONS_SHEET = 'Options';
const DEFAULT_OPTION_MULTIPLIER = 100;

/**
 * Entry point (wired to the SnapTrade menu).
 */
function refreshOptions() {
  try {
    showToast('Fetching accounts…', 'Options', -1);
    const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null) || [];
    const holdingsMap = fetchAccountDataInParallel(accounts, 'holdings');

    const rows = [];
    accounts.forEach((account) => {
      const holdings = holdingsMap[account.id];
      const optionPositions = holdings && holdings.option_positions;
      if (!Array.isArray(optionPositions)) return;

      optionPositions.forEach((pos) => {
        const info = extractOptionInfo(pos);
        const contracts = Number(pos.units) || 0;
        const price = Number(pos.price) || 0;
        const avg = Number(pos.average_purchase_price) || 0;
        const multiplier = Number(pos.multiplier) || info.multiplier || DEFAULT_OPTION_MULTIPLIER;
        const currency = (pos.currency && pos.currency.code) || 'USD';
        const marketValue = contracts * price * multiplier;
        const costBasis = contracts * avg * multiplier;

        rows.push([
          account.name || account.number,
          info.underlying,
          info.ticker,
          info.type,
          info.strike,
          info.expiry,
          contracts,
          price,
          multiplier,
          currency,
          marketValue,
          costBasis,
          marketValue - costBasis,
          '', '', '', // CAD columns (formulas)
        ]);
      });
    });

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(OPTIONS_SHEET) || ss.insertSheet(OPTIONS_SHEET);
    sheet.clear();
    sheet.appendRow([
      'Account', 'Underlying', 'Option Symbol', 'Type', 'Strike', 'Expiry', 'Contracts',
      'Price', 'Multiplier', 'Currency', 'Market Value', 'Cost Basis', 'Gain/Loss',
      'Market Value (CAD)', 'Cost Basis (CAD)', 'Gain/Loss (CAD)',
    ]);

    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);

      // Currency is col 10; CAD columns reference it plus their native-value column.
      const mvCAD = getCADConversionFormula(-4, -3);   // col 14 <- Currency(10), Market Value(11)
      const costCAD = getCADConversionFormula(-5, -3); // col 15 <- Currency(10), Cost Basis(12)
      const glCAD = getCADConversionFormula(-6, -3);   // col 16 <- Currency(10), Gain/Loss(13)
      const mv = [], cost = [], gl = [];
      for (let i = 0; i < rows.length; i++) { mv.push([mvCAD]); cost.push([costCAD]); gl.push([glCAD]); }
      sheet.getRange(2, 14, rows.length, 1).setFormulasR1C1(mv);
      sheet.getRange(2, 15, rows.length, 1).setFormulasR1C1(cost);
      sheet.getRange(2, 16, rows.length, 1).setFormulasR1C1(gl);

      const cur = CONFIG.SHEETS.CURRENCY_FORMAT;
      [5, 8, 11, 12, 13, 14, 15, 16].forEach((col) => {
        sheet.getRange(2, col, rows.length, 1).setNumberFormat(cur);
      });
    }

    formatSheetHeader(sheet);
    sheet.setFrozenRows(1);

    clearToast();
    SpreadsheetApp.getUi().alert(`Refreshed ${rows.length} option position(s) from ${accounts.length} accounts.`);
  } catch (error) {
    clearToast();
    Logger.log(`[refreshOptions] ${error.message}`);
    SpreadsheetApp.getUi().alert(`Error refreshing options: ${error.message}`);
  }
}

/**
 * Extracts contract details from an option position, tolerating the nesting variations seen
 * across brokerages (option_symbol under position.symbol, directly on the position, or the
 * position.symbol itself carrying the option fields).
 * @param {Object} pos - An option position object
 * @returns {{ticker: string, type: string, strike: (number|string), expiry: string, underlying: string, multiplier: (number|undefined)}}
 */
function extractOptionInfo(pos) {
  let opt = null;
  if (pos.symbol && pos.symbol.option_symbol) opt = pos.symbol.option_symbol;
  else if (pos.option_symbol) opt = pos.option_symbol;
  else if (pos.symbol && (pos.symbol.strike_price != null || pos.symbol.option_type)) opt = pos.symbol;
  opt = opt || {};

  const ticker = opt.ticker || opt.symbol || '';
  const type = (opt.option_type || opt.type || '').toString().toUpperCase();
  const strike = opt.strike_price != null ? opt.strike_price : '';
  const expiry = opt.expiration_date || opt.expiry || '';

  let underlying = '';
  const us = opt.underlying_symbol;
  if (us) underlying = (typeof us === 'string') ? us : (us.symbol || us.raw_symbol || '');
  if (!underlying && ticker) {
    const m = ticker.match(/^[A-Za-z.]+/); // leading letters of an OCC ticker
    underlying = m ? m[0] : '';
  }

  return { ticker, type, strike, expiry, underlying, multiplier: opt.multiplier };
}
