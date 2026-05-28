/**
 * Portfolio summary dashboard.
 *
 * A single "Summary" sheet that pulls together the other sheets with live formulas (no extra
 * API calls): headline totals, year-to-date income / realized gains / FX / fees, a net-worth
 * line chart from Account History, allocation pies by account and currency, and a top-holdings
 * table. Everything degrades gracefully (shows "—" or a hint) when a source sheet hasn't been
 * generated yet — keep the underlying sheets refreshed and this recalculates on its own.
 *
 * Source sheets and the columns this reads:
 *   Accounts:         B Account Name, G Currency, H Total (CAD), I Buying Power
 *   Account History:  A Timestamp, H Total (CAD)
 *   Unrealized P/L:   A Symbol, I Market Value (CAD), K Gain/Loss (CAD), L % of Portfolio
 *   Income:           A Date, H Amount (CAD)
 *   ACB Ledger:       A Date, D Action (SELL), O Realized Gain/Loss (CAD)
 *   Forex Ledger:     A Date, D Direction (Dispose), L Realized FX G/L (CAD)
 *   Fees:             A Date, H Fee (CAD)
 */

const SUMMARY_SHEET = 'Summary';

/**
 * Entry point (wired to the SnapTrade menu).
 */
function refreshSummary() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SUMMARY_SHEET) || ss.insertSheet(SUMMARY_SHEET, 0);
    sheet.getCharts().forEach((c) => sheet.removeChart(c));
    sheet.clear();
    sheet.setHiddenGridlines(true);

    const cur = CONFIG.SHEETS.CURRENCY_FORMAT;
    const yStart = 'DATE(YEAR(TODAY()),1,1)';
    const yEnd = 'DATE(YEAR(TODAY()),12,31)';

    // Title.
    sheet.getRange('A1').setValue('Portfolio Summary');
    sheet.getRange('A1:L1').merge();
    sheet.getRange('A1').setFontSize(18).setFontWeight('bold');
    sheet.getRange('A2').setValue('Live overview — keep the underlying sheets refreshed; this recalculates automatically.')
      .setFontColor('#666666').setFontStyle('italic');

    // --- Headline tiles (row 4 labels, row 5 values) ---
    const tile = (col, label, formula, fmt) => {
      sheet.getRange(4, col).setValue(label).setFontWeight('bold').setFontColor('#444444');
      const v = sheet.getRange(5, col);
      v.setFormula(formula).setFontSize(14).setFontWeight('bold');
      if (fmt) v.setNumberFormat(fmt);
    };
    tile(1, 'Total Value (CAD)', "=IFERROR(SUM('Accounts'!$H$2:$H),\"—\")", cur);
    tile(4, 'Buying Power', "=IFERROR(SUM('Accounts'!$I$2:$I),0)", cur);
    tile(7, '# Accounts', "=IFERROR(COUNTUNIQUE('Accounts'!$B$2:$B),0)", '0');
    tile(10, 'Last Snapshot', "=IFERROR(IF(COUNT('Account History'!$A$2:$A)=0,\"—\",MAX('Account History'!$A$2:$A)),\"—\")", CONFIG.SHEETS.DATE_FORMAT);

    // --- This year (YTD) tiles (row 7 header, row 8 labels, row 9 values) ---
    sheet.getRange('A7').setValue('This Year (YTD)').setFontWeight('bold').setFontSize(12);
    const ytd = (col, label, sheetName, sumCol, extraCriteria) => {
      const range = (c) => `'${sheetName}'!$${c}:$${c}`;
      let f = `=IFERROR(SUMIFS(${range(sumCol)},${range('A')},">="&${yStart},${range('A')},"<="&${yEnd}`;
      if (extraCriteria) f += `,${range(extraCriteria.col)},"${extraCriteria.val}"`;
      f += '),0)';
      sheet.getRange(8, col).setValue(label).setFontWeight('bold').setFontColor('#444444');
      sheet.getRange(9, col).setFormula(f).setNumberFormat(cur).setFontSize(12);
    };
    ytd(1, 'Income (CAD)', 'Income', 'H');
    ytd(4, 'Realized Gains (CAD)', 'ACB Ledger', 'O', { col: 'D', val: 'SELL' });
    ytd(7, 'Realized FX (CAD)', 'Forex Ledger', 'L', { col: 'D', val: 'Dispose' });
    ytd(10, 'Fees (CAD)', 'Fees', 'H');

    // --- Hidden helper queries feed the charts. Each goes in its OWN column block (N:O, Q:R,
    // T:U) starting at row 1, so a chart range for one never overlaps another's data. ---
    sheet.getRange('N1').setFormula(
      "=IFERROR(QUERY('Account History'!A2:H,\"select toDate(A), sum(H) where A is not null group by toDate(A) order by toDate(A) label toDate(A) 'Date', sum(H) 'Net Worth (CAD)'\"),\"Refresh Accounts to build history\")"
    );
    sheet.getRange('Q1').setFormula(
      "=IFERROR(QUERY('Accounts'!A2:H,\"select B, sum(H) where B is not null group by B order by sum(H) desc label B 'Account', sum(H) 'Value (CAD)'\"),\"Refresh Accounts\")"
    );
    sheet.getRange('T1').setFormula(
      "=IFERROR(QUERY('Accounts'!A2:H,\"select G, sum(H) where G is not null group by G order by sum(H) desc label G 'Currency', sum(H) 'Value (CAD)'\"),\"Refresh Accounts\")"
    );
    SpreadsheetApp.flush(); // evaluate the QUERYs so their spilled heights can be measured

    const nwHeight = summaryColHeight_(sheet, 14);   // N
    const acctHeight = summaryColHeight_(sheet, 17); // Q
    const curHeight = summaryColHeight_(sheet, 20);  // T
    // Date-format the net-worth date column so the chart renders a date axis (not serials).
    if (nwHeight > 1) sheet.getRange(2, 14, nwHeight - 1, 1).setNumberFormat(CONFIG.SHEETS.DATE_FORMAT);

    // --- Net worth over time chart (range bounded to the series, not the whole column) ---
    sheet.getRange('A11').setValue('Net Worth Over Time (CAD)').setFontWeight('bold').setFontSize(12);
    sheet.insertChart(sheet.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(sheet.getRange(1, 14, Math.max(nwHeight, 2), 2)) // N1:O{height}
      .setNumHeaders(1)
      .setOption('title', 'Net Worth (CAD)')
      .setOption('legend', { position: 'none' })
      .setOption('width', 920).setOption('height', 320)
      .setPosition(12, 1, 0, 0)
      .build());

    // --- Allocation pies (each bounded to its own block) ---
    sheet.getRange('A30').setValue('Allocation by Account').setFontWeight('bold').setFontSize(12);
    sheet.getRange('G30').setValue('Allocation by Currency').setFontWeight('bold').setFontSize(12);
    sheet.insertChart(sheet.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sheet.getRange(1, 17, Math.max(acctHeight, 2), 2)).setNumHeaders(1) // Q1:R{height}
      .setOption('title', 'By Account').setOption('pieHole', 0.4)
      .setOption('width', 440).setOption('height', 280)
      .setPosition(31, 1, 0, 0).build());
    sheet.insertChart(sheet.newChart()
      .setChartType(Charts.ChartType.PIE)
      .addRange(sheet.getRange(1, 20, Math.max(curHeight, 2), 2)).setNumHeaders(1) // T1:U{height}
      .setOption('title', 'By Currency').setOption('pieHole', 0.4)
      .setOption('width', 440).setOption('height', 280)
      .setPosition(31, 7, 0, 0).build());

    // --- Top holdings table (live) ---
    sheet.getRange('A47').setValue('Top Holdings').setFontWeight('bold').setFontSize(12);
    sheet.getRange('A48').setFormula(
      "=IFERROR(QUERY('Unrealized P/L'!A2:L,\"select A, I, K, L where A is not null and A <> 'TOTAL' order by I desc limit 15 label A 'Symbol', I 'Market Value (CAD)', K 'Gain/Loss (CAD)', L '% of Portfolio'\"),\"Run Unrealized P/L to populate\")"
    );
    sheet.getRange('B48:C68').setNumberFormat(cur);      // market value / gain-loss (CAD)
    sheet.getRange('D48:D68').setNumberFormat('0.00%');  // % of portfolio

    // Cosmetics: widen the visible columns and hide the helper columns.
    sheet.setColumnWidths(1, 12, 95);
    sheet.setColumnWidth(1, 150);
    sheet.hideColumns(14, 8); // N..U helper queries

    SpreadsheetApp.flush();
    SpreadsheetApp.getUi().alert(
      'Summary dashboard built. Tiles and charts pull live from the other sheets — if a section ' +
      'shows "—" or a hint, run the matching refresh (Accounts, Unrealized P/L, Income, ACB, etc.).'
    );
  } catch (error) {
    debugLog('refreshSummary', 'error', error.stack || error.message);
    SpreadsheetApp.getUi().alert(`Error building summary: ${error.message}`);
  }
}

/**
 * Number of populated rows (from row 1) in a column — used to bound a chart's data range to a
 * spilled QUERY result instead of grabbing the whole column (which could swallow other data).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} col - 1-based column index
 * @returns {number} last populated row index (≥ 1)
 */
function summaryColHeight_(sheet, col) {
  const last = sheet.getLastRow();
  if (last < 1) return 1;
  const values = sheet.getRange(1, col, last, 1).getValues();
  let height = 1;
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] !== '' && values[i][0] !== null) height = i + 1;
  }
  return height;
}
