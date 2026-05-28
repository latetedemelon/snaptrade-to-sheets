/**
 * Wheel / triple-income per-underlying roll-up.
 *
 * The "wheel" sells cash-secured puts, takes assignment into shares, sells covered calls, and
 * collects dividends along the way — "triple income" = put premiums + call premiums + dividends.
 * Rather than trying to *detect* the strategy, this aggregates everything per underlying: net
 * option premium (puts and calls, including rolls), dividends, and the current equity position's
 * cost basis. Subtracting all the income from the stock cost gives an effective cost basis and
 * break-even — the wheel trader's "what's my real cost after everything I've collected" view.
 *
 * This is a trade-management view. The Capital Gains, Income, and Realized Trades sheets remain
 * the tax sources of truth (premiums are capital, dividends are income; here they all reduce the
 * effective cost so you can see your break-even).
 */

const WHEEL_SHEET = 'Wheel';

/**
 * Entry point (wired to the SnapTrade menu).
 */
function refreshWheel() {
  try {
    showToast('Fetching activity & holdings…', 'Wheel', -1);
    debugLog('refreshWheel', 'start');
    const activities = fetchAllActivities();
    const positions = fetchCurrentPositionsBySymbol(); // symbol -> {units, costNative, currency}
    const rows = buildWheelByUnderlying(activities, positions);
    debugLog('refreshWheel', `built ${rows.length} underlying roll-up(s) from ${activities.length} activities`);

    if (rows.length === 0) {
      clearToast();
      SpreadsheetApp.getUi().alert('No option-premium or dividend activity was found to build the Wheel view.');
      return;
    }

    writeWheelSheet(rows);
    clearToast();
    SpreadsheetApp.getUi().alert(
      `Built the Wheel / triple-income roll-up for ${rows.length} underlying(s). See the "Wheel" sheet.`
    );
  } catch (error) {
    clearToast();
    debugLog('refreshWheel', 'error', error.stack || error.message);
    SpreadsheetApp.getUi().alert(`Error building Wheel view: ${error.message}`);
  }
}

/**
 * Aggregates option premiums (puts/calls), dividends, and the equity cost basis per underlying.
 * Pure function (no spreadsheet/network) for unit-testing. Income reduces the effective cost
 * basis. Only underlyings with option premium or dividends are included (plain holdings are
 * skipped). Single-currency per underlying is assumed.
 *
 * @param {Array} activities
 * @param {Object} positions - map symbol -> {units, costNative, currency} (current holdings)
 * @returns {Array<Object>} per-underlying rows
 */
function buildWheelByUnderlying(activities, positions) {
  const r2 = (n) => Math.round(n * 100) / 100;
  const r4 = (n) => Math.round(n * 10000) / 10000;
  const byU = {};
  const ensure = (u, currency) => {
    if (!byU[u]) byU[u] = { netPut: 0, netCall: 0, dividends: 0, currency: currency || '' };
    if (!byU[u].currency && currency) byU[u].currency = currency;
    return byU[u];
  };

  (activities || []).forEach((tx) => {
    const optInfo = extractOptionInfo(tx);
    const typeStr = (tx.type || '').toString().toUpperCase();
    const isOption = !!tx.option_symbol || typeStr.indexOf('OPTION') !== -1 || !!optInfo.ticker;
    const currency = (tx.currency && tx.currency.code)
      || (tx.symbol && tx.symbol.currency && tx.symbol.currency.code) || '';
    const amount = Number(tx.amount) || 0;

    if (isOption && optInfo.underlying) {
      if (amount === 0) return;
      const w = ensure(optInfo.underlying, currency);
      if (optInfo.type === 'PUT') w.netPut += amount;
      else if (optInfo.type === 'CALL') w.netCall += amount;
      // Unknown option type is skipped so Put + Call + Dividends == Triple Income always holds.
      return;
    }

    // Dividends / distributions / withholding tax on the equity (withholding nets it down).
    const cat = classifyIncomeActivity(tx);
    if (cat === 'Dividend' || cat === 'Distribution' || cat === 'Tax Withheld') {
      if (amount === 0) return;
      const sym = extractSymbolInfo(tx.symbol).symbol;
      if (!sym || sym === 'N/A') return;
      ensure(sym, currency).dividends += amount;
    }
  });

  const rows = [];
  Object.keys(byU).sort().forEach((u) => {
    const w = byU[u];
    if (w.netPut === 0 && w.netCall === 0 && w.dividends === 0) return;
    const pos = positions ? positions[u] : null;
    const shares = pos ? (Number(pos.units) || 0) : 0;
    const stockCost = pos ? (Number(pos.costNative) || 0) : 0;
    const currency = w.currency || (pos ? pos.currency : '') || 'USD';
    const tripleIncome = w.netPut + w.netCall + w.dividends;
    const effectiveBasis = stockCost - tripleIncome;
    rows.push({
      underlying: u,
      currency: currency,
      shares: r2(shares),
      stockCostBasis: r2(stockCost),
      netPut: r2(w.netPut),
      netCall: r2(w.netCall),
      dividends: r2(w.dividends),
      tripleIncome: r2(tripleIncome),
      effectiveBasis: r2(effectiveBasis),
      breakEven: shares > 0 ? r4(effectiveBasis / shares) : '',
    });
  });
  return rows;
}

/**
 * Writes the Wheel sheet (one row per underlying).
 * @param {Array<Object>} rows - Output of buildWheelByUnderlying
 */
function writeWheelSheet(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(WHEEL_SHEET) || ss.insertSheet(WHEEL_SHEET);
  sheet.clear();

  const headers = [
    'Underlying', 'Currency', 'Shares Held', 'Stock Cost Basis', 'Net Put Premium',
    'Net Call Premium', 'Dividends', 'Triple Income', 'Effective Cost Basis', 'Break-even / Share',
  ];
  sheet.appendRow(headers);

  const data = rows.map((w) => [
    w.underlying, w.currency, w.shares, w.stockCostBasis, w.netPut, w.netCall,
    w.dividends, w.tripleIncome, w.effectiveBasis, w.breakEven,
  ]);

  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
    [4, 5, 6, 7, 8, 9, 10].forEach((col) => {
      sheet.getRange(2, col, data.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT);
    });
    sheet.getRange(2, 3, data.length, 1).setNumberFormat('#,##0.####'); // shares
  }

  formatSheetHeader(sheet);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 9).setNote(
    'Effective Cost Basis = stock cost basis − net put premium − net call premium − dividends ' +
    '("triple income"). Break-even / Share = effective basis ÷ shares held — the price at which ' +
    'you are flat after everything collected. Trade-management view; premiums are capital and ' +
    'dividends are income for tax (see Capital Gains / Income). Values are in each underlying\'s ' +
    'native currency.'
  );
}
