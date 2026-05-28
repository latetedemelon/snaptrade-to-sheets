/**
 * Option roll chains / net credit.
 *
 * Groups an underlying's option activity into "chains" — a chain is a run of legs during which
 * the position stays open, kept alive across rolls (a roll = close the old contract + open a
 * new one, usually same day). A chain ends when the position goes flat (net contracts return to
 * zero with a later-dated next leg, or no more legs). For each chain it reports the net credit
 * (sum of all leg cash flows: premiums received are positive, debits paid negative), how many
 * times it was rolled, and whether it is still open.
 *
 * This is a trade-management view, not a tax view: each option contract is still separate
 * property for ACB purposes (see the Realized Trades sheet). "Net credit" answers "how much
 * have I banked, net, on this position across all the rolls?"
 *
 * Heuristic + limitations: chains are grouped per underlying and exposure is tracked by
 * open/close magnitude (not long/short sign, which the feed doesn't always disambiguate), so
 * simultaneous independent positions in the same underlying are treated as one campaign. Good
 * enough for the common "roll one position out/up/down" workflow.
 */

const ROLL_CHAINS_SHEET = 'Roll Chains';

/**
 * Entry point (wired to the SnapTrade menu).
 */
function refreshRollChains() {
  try {
    showToast('Fetching activity history…', 'Roll Chains', -1);
    debugLog('refreshRollChains', 'start');
    const activities = fetchAllActivities();
    const chains = buildRollChains(activities);
    debugLog('refreshRollChains', `built ${chains.length} chain(s) from ${activities.length} activities`);

    if (chains.length === 0) {
      clearToast();
      SpreadsheetApp.getUi().alert('No option activity was found to build roll chains.');
      return;
    }

    writeRollChainsSheet(chains);
    clearToast();
    const open = chains.filter((c) => c.status === 'Open').length;
    SpreadsheetApp.getUi().alert(
      `Built ${chains.length} option roll chain(s) (${open} still open). See the "Roll Chains" sheet.`
    );
  } catch (error) {
    clearToast();
    debugLog('refreshRollChains', 'error', error.stack || error.message);
    SpreadsheetApp.getUi().alert(`Error building roll chains: ${error.message}`);
  }
}

/**
 * Groups option activities into roll chains per underlying. Pure function (no Spreadsheet /
 * UrlFetch access) so it is unit-testable.
 * @param {Array} activities
 * @returns {Array<Object>} chains: {underlying, chainNum, status, legs, rolls, firstDate,
 *   lastDate, netCredit, currency, openContracts}
 */
function buildRollChains(activities) {
  // 1. Extract option legs with an OPEN/CLOSE action and signed cash flow.
  const legs = [];
  (activities || []).forEach((tx) => {
    const info = extractOptionInfo(tx);
    const typeStr = (tx.type || '').toString().toUpperCase();
    const isOption = !!tx.option_symbol || typeStr.indexOf('OPTION') !== -1 || !!info.ticker;
    if (!isOption || !info.underlying) return;

    const action = classifyRealizedLeg(tx); // 'OPEN' | 'CLOSE' | null
    if (!action) return;

    const date = parseActivityDate_(tx.trade_date || tx.settlement_date);
    if (!date) return;

    const units = Math.abs(Number(tx.units) || 0);
    const amount = Number(tx.amount) || 0; // signed: credit (+) / debit (-)
    if (units === 0 && amount === 0) return;

    legs.push({
      date: date,
      underlying: info.underlying,
      action: action,
      units: units,
      amount: amount,
      currency: (tx.currency && tx.currency.code) || 'USD',
    });
  });

  // 2. Group by underlying.
  const byUnderlying = {};
  legs.forEach((leg) => { (byUnderlying[leg.underlying] = byUnderlying[leg.underlying] || []).push(leg); });

  // 3. Walk each underlying's legs by date; break a chain when exposure returns to flat.
  const chains = [];
  Object.keys(byUnderlying).sort().forEach((underlying) => {
    const list = byUnderlying[underlying].slice().sort((a, b) => {
      if (a.date.getTime() !== b.date.getTime()) return a.date.getTime() - b.date.getTime();
      // opens before closes on the same day so a same-day roll keeps the chain alive
      return (a.action === 'OPEN' ? 0 : 1) - (b.action === 'OPEN' ? 0 : 1);
    });

    let chainNum = 0;
    let chain = null;
    let exposure = 0;

    list.forEach((leg, i) => {
      if (!chain) {
        chainNum += 1;
        chain = { underlying: underlying, chainNum: chainNum, opens: 0, netCredit: 0,
          currency: leg.currency, firstDate: leg.date, lastDate: leg.date };
        exposure = 0;
      }
      chain.netCredit += leg.amount;
      chain.lastDate = leg.date;
      if (leg.action === 'OPEN') { exposure += leg.units; chain.opens += 1; }
      else { exposure = Math.max(0, exposure - leg.units); }

      const next = list[i + 1];
      const flatAndDone = exposure <= 1e-9 && (!next || next.date.getTime() > leg.date.getTime());
      if (flatAndDone) { chains.push(finalizeRollChain_(chain, exposure)); chain = null; }
    });

    if (chain) chains.push(finalizeRollChain_(chain, exposure));
  });

  return chains;
}

/**
 * Finalizes a chain's derived fields. @returns {Object} */
function finalizeRollChain_(chain, exposure) {
  return {
    underlying: chain.underlying,
    chainNum: chain.chainNum,
    status: exposure > 1e-9 ? 'Open' : 'Closed',
    rolls: Math.max(0, chain.opens - 1),
    firstDate: chain.firstDate,
    lastDate: chain.lastDate,
    netCredit: Math.round(chain.netCredit * 100) / 100,
    currency: chain.currency,
    openContracts: Math.round(exposure * 10000) / 10000,
    opens: chain.opens,
  };
}

/**
 * Writes the Roll Chains sheet: one row per chain, with a CAD-at-current-rate column.
 * @param {Array<Object>} chains
 */
function writeRollChainsSheet(chains) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ROLL_CHAINS_SHEET) || ss.insertSheet(ROLL_CHAINS_SHEET);
  sheet.clear();

  const headers = [
    'Underlying', 'Chain #', 'Status', 'Rolls', 'Open Contracts', 'First Date', 'Last Date',
    'Net Credit', 'Currency', 'Net Credit (CAD, approx)',
  ];
  sheet.appendRow(headers);

  const sorted = chains.slice().sort((a, b) => {
    if (a.underlying !== b.underlying) return a.underlying < b.underlying ? -1 : 1;
    return a.chainNum - b.chainNum;
  });

  const data = sorted.map((c) => [
    c.underlying, c.chainNum, c.status, c.rolls, c.openContracts,
    c.firstDate, c.lastDate, c.netCredit, c.currency, '', // CAD (formula)
  ]);

  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
    // Net Credit (CAD) at col 10 <- Currency(9) and Net Credit(8). Current (spot) rate, since a
    // chain spans many dates; labelled approximate.
    const cadFormula = getCADConversionFormula(-1, -2);
    const cad = [];
    for (let i = 0; i < data.length; i++) cad.push([cadFormula]);
    sheet.getRange(2, 10, data.length, 1).setFormulasR1C1(cad);

    sheet.getRange(2, 6, data.length, 2).setNumberFormat(CONFIG.SHEETS.DATE_FORMAT); // dates
    sheet.getRange(2, 8, data.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT); // net credit
    sheet.getRange(2, 10, data.length, 1).setNumberFormat(CONFIG.SHEETS.CURRENCY_FORMAT); // CAD
  }

  formatSheetHeader(sheet);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 8).setNote(
    'Net Credit = sum of all option cash flows in the chain (premiums received positive, debits ' +
    'paid negative). A chain is kept alive across rolls and ends when the position goes flat. ' +
    'This is a trade-management view, not the per-contract ACB used for tax (see Realized Trades).'
  );
}
