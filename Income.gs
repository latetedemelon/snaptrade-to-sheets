/**
 * Income & dividend tracker.
 *
 * Builds an "Income" sheet from the full activity history: a chronological ledger of cash
 * income events (dividends, interest, distributions, withholding tax) converted to CAD at
 * each event's historical (trade-date) rate, plus a by-tax-year summary per category.
 *
 * This is independent of the ACB calculator: reinvested-dividend cash is still income here
 * even though the ACB ledger treats the reinvestment as a buy.
 */

const INCOME_SHEET = 'Income';

/**
 * Income categories keyed by the keywords (matched case-insensitively as substrings of the
 * activity type) that select them. Withholding tax is checked first so it isn't swallowed
 * by the dividend rule. Edit to match your brokerage's activity-type labels.
 */
const INCOME_TYPE_KEYWORDS = [
  ['Tax Withheld', ['WITHHOLD', 'WITHHELD', 'NRTAX', 'NON_RESIDENT_TAX', 'FOREIGNTAX']],
  ['Dividend', ['DIVIDEND']],
  ['Interest', ['INTEREST']],
  ['Distribution', ['DISTRIBUTION']],
];

const INCOME_CATEGORIES = ['Dividend', 'Interest', 'Distribution', 'Tax Withheld'];

/**
 * Entry point (wired to the SnapTrade menu).
 */
function refreshIncome() {
  try {
    showToast('Fetching activity history…', 'Income', -1);
    const activities = fetchAllActivities();
    const records = buildIncomeRecords(activities);

    if (records.length === 0) {
      clearToast();
      SpreadsheetApp.getUi().alert('No dividend, interest, or distribution activity was found.');
      return;
    }

    records.sort((a, b) => a.date.getTime() - b.date.getTime());
    writeIncomeSheet(records);

    clearToast();
    SpreadsheetApp.getUi().alert(`Tracked ${records.length} income events. See the "Income" sheet.`);
  } catch (error) {
    clearToast();
    Logger.log(`[refreshIncome] ${error.message}`);
    SpreadsheetApp.getUi().alert(`Error tracking income: ${error.message}`);
  }
}

/**
 * Classifies an activity into an income category, or null if it is not income.
 * @param {Object} tx
 * @returns {?string}
 */
function classifyIncomeActivity(tx) {
  const type = (tx.type || '').toString().toUpperCase();
  for (let i = 0; i < INCOME_TYPE_KEYWORDS.length; i++) {
    const [category, keywords] = INCOME_TYPE_KEYWORDS[i];
    if (keywords.some((kw) => type.indexOf(kw) !== -1)) return category;
  }
  return null;
}

/**
 * Builds income records from activities.
 * @param {Array} activities
 * @returns {Array<Object>} {date, symbol, account, category, amount, currency}
 */
function buildIncomeRecords(activities) {
  const records = [];
  activities.forEach((tx) => {
    const category = classifyIncomeActivity(tx);
    if (!category) return;

    const amount = Number(tx.amount) || 0;
    if (amount === 0) return; // reinvested-as-units rows carry no cash income

    const dateStr = tx.trade_date || tx.settlement_date;
    const date = dateStr ? new Date(dateStr) : null;
    if (!date || isNaN(date.getTime())) return;

    const symbolInfo = extractSymbolInfo(tx.symbol);
    const symbol = symbolInfo.symbol === 'N/A' ? '' : symbolInfo.symbol;
    const currency = (tx.currency && tx.currency.code)
      || (tx.symbol && tx.symbol.currency && tx.symbol.currency.code)
      || 'USD';

    records.push({
      date: date,
      symbol: symbol,
      account: (tx.account && (tx.account.name || tx.account.number)) || '',
      category: category,
      amount: amount,
      currency: currency,
    });
  });
  return records;
}

/**
 * Writes the Income sheet: a CAD-converted ledger and a by-tax-year summary per category.
 * @param {Array<Object>} records - Sorted income records
 */
function writeIncomeSheet(records) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(INCOME_SHEET) || ss.insertSheet(INCOME_SHEET);
  sheet.clear();

  const headers = ['Date', 'Account', 'Symbol', 'Type', 'Amount', 'Currency', 'FX→CAD', 'Amount (CAD)'];
  sheet.appendRow(headers);

  const data = records.map((rec, i) => {
    const r = i + 2;
    return [
      rec.date, rec.account, rec.symbol, rec.category, rec.amount, rec.currency,
      historicalCadFxFormula(`$F${r}`, `$A${r}`), // FX on the event date
      `=$E${r}*$G${r}`,                            // Amount (CAD) = Amount x FX
    ];
  });

  sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  const lastRow = data.length + 1;
  sheet.getRange(2, 1, data.length, 1).setNumberFormat(CONFIG.SHEETS.DATE_FORMAT);
  sheet.getRange(2, 5, data.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT); // Amount
  sheet.getRange(2, 7, data.length, 1).setNumberFormat('0.0000');                       // FX
  sheet.getRange(2, 8, data.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT); // Amount (CAD)
  formatSheetHeader(sheet);
  sheet.setFrozenRows(1);

  // By-tax-year summary per category.
  const years = [];
  records.forEach((rec) => {
    const y = rec.date.getFullYear();
    if (years.indexOf(y) === -1) years.push(y);
  });
  years.sort();

  const dRange = `$D$2:$D$${lastRow}`;
  const aRange = `$A$2:$A$${lastRow}`;
  const hRange = `$H$2:$H$${lastRow}`;

  const titleRow = lastRow + 2;
  sheet.getRange(titleRow, 1).setValue('Income by Tax Year (CAD)');

  const summary = [['Tax Year'].concat(INCOME_CATEGORIES).concat(['Total'])];
  years.forEach((year) => {
    const row = [year];
    INCOME_CATEGORIES.forEach((cat) => {
      row.push(`=SUMPRODUCT((YEAR(${aRange})=${year})*(${dRange}="${cat}")*${hRange})`);
    });
    row.push(`=SUMPRODUCT((YEAR(${aRange})=${year})*${hRange})`); // Total
    summary.push(row);
  });

  const headerRow = titleRow + 1;
  sheet.getRange(headerRow, 1, summary.length, summary[0].length).setValues(summary);
  sheet.getRange(headerRow + 1, 2, years.length, INCOME_CATEGORIES.length + 1)
    .setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT);
}
