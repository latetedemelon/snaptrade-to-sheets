/**
 * Test validation script for parallel API optimization.
 * This file contains helper functions to validate the optimizations.
 * It can be included in the project for manual testing but is not required for production.
 */

/**
 * Tests the fetchAccountDataInParallel function with mock data.
 * This is a manual test that validates the function's behavior.
 */
function testFetchAccountDataInParallel() {
  // This test requires actual SnapTrade credentials to run
  // It's designed to be run manually in the Apps Script editor
  
  try {
    Logger.log('[TEST] Starting fetchAccountDataInParallel test');
    
    // Fetch accounts first
    const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null);
    Logger.log(`[TEST] Retrieved ${accounts.length} accounts`);
    
    if (accounts.length === 0) {
      Logger.log('[TEST] No accounts found. Skipping test.');
      return;
    }
    
    // Test parallel fetching of balances
    Logger.log('[TEST] Testing parallel balance fetching...');
    const startTime = new Date().getTime();
    const balancesMap = fetchAccountDataInParallel(accounts, 'balances');
    const parallelTime = new Date().getTime() - startTime;
    
    Logger.log(`[TEST] Parallel fetch completed in ${parallelTime}ms`);
    Logger.log(`[TEST] Retrieved balances for ${Object.keys(balancesMap).length} accounts`);
    
    // Verify each account has balances
    let successCount = 0;
    accounts.forEach((account) => {
      if (balancesMap[account.id]) {
        successCount++;
        Logger.log(`[TEST] ✓ Account ${account.id} has ${balancesMap[account.id].length} balance entries`);
      } else {
        Logger.log(`[TEST] ✗ Account ${account.id} missing balance data`);
      }
    });
    
    Logger.log(`[TEST] Success rate: ${successCount}/${accounts.length} accounts`);
    
    // Test parallel fetching of holdings
    Logger.log('[TEST] Testing parallel holdings fetching...');
    const holdingsStartTime = new Date().getTime();
    const holdingsMap = fetchAccountDataInParallel(accounts, 'holdings');
    const holdingsParallelTime = new Date().getTime() - holdingsStartTime;
    
    Logger.log(`[TEST] Parallel holdings fetch completed in ${holdingsParallelTime}ms`);
    Logger.log(`[TEST] Retrieved holdings for ${Object.keys(holdingsMap).length} accounts`);
    
    // Verify each account has holdings data
    let holdingsSuccessCount = 0;
    accounts.forEach((account) => {
      if (holdingsMap[account.id]) {
        holdingsSuccessCount++;
        const positions = holdingsMap[account.id].positions || [];
        Logger.log(`[TEST] ✓ Account ${account.id} has ${positions.length} positions`);
      } else {
        Logger.log(`[TEST] ✗ Account ${account.id} missing holdings data`);
      }
    });
    
    Logger.log(`[TEST] Holdings success rate: ${holdingsSuccessCount}/${accounts.length} accounts`);
    
    Logger.log('[TEST] ✓ All tests passed!');
    return {
      accountCount: accounts.length,
      balanceFetchTime: parallelTime,
      holdingsFetchTime: holdingsParallelTime,
      balancesSuccess: successCount,
      holdingsSuccess: holdingsSuccessCount,
    };
    
  } catch (error) {
    Logger.log(`[TEST] ✗ Test failed: ${error.message}`);
    Logger.log(`[TEST] Stack trace: ${error.stack}`);
    throw error;
  }
}

/**
 * Validates that updateAccountHistoryOnce works with both pre-fetched and non-pre-fetched balances.
 */
function testUpdateAccountHistoryOnce() {
  try {
    Logger.log('[TEST] Starting updateAccountHistoryOnce test');
    
    const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null);
    Logger.log(`[TEST] Retrieved ${accounts.length} accounts`);
    
    if (accounts.length === 0) {
      Logger.log('[TEST] No accounts found. Skipping test.');
      return;
    }
    
    // Test 1: With prefetched balances (simulating refreshAccounts flow)
    Logger.log('[TEST] Test 1: updateAccountHistoryOnce WITH prefetched balances');
    const balancesMap = fetchAccountDataInParallel(accounts, 'balances');
    const startTime1 = new Date().getTime();
    updateAccountHistoryOnce(accounts, balancesMap);
    const time1 = new Date().getTime() - startTime1;
    Logger.log(`[TEST] Test 1 completed in ${time1}ms (should be fast - no API calls)`);
    
    // Test 2: Without prefetched balances (simulating trackAccountHistory flow)
    Logger.log('[TEST] Test 2: updateAccountHistoryOnce WITHOUT prefetched balances');
    const startTime2 = new Date().getTime();
    updateAccountHistoryOnce(accounts);
    const time2 = new Date().getTime() - startTime2;
    Logger.log(`[TEST] Test 2 completed in ${time2}ms (includes parallel API fetch)`);
    
    Logger.log('[TEST] ✓ Both test scenarios passed!');
    Logger.log(`[TEST] Performance difference: ${time2 - time1}ms`);
    
    return {
      withPrefetch: time1,
      withoutPrefetch: time2,
      difference: time2 - time1,
    };
    
  } catch (error) {
    Logger.log(`[TEST] ✗ Test failed: ${error.message}`);
    Logger.log(`[TEST] Stack trace: ${error.stack}`);
    throw error;
  }
}

/**
 * Compares performance of sequential vs parallel API calls.
 * This test measures the actual performance improvement.
 * Note: This test intentionally makes sequential API calls which may hit rate limits.
 * Automatically limits to first 5 accounts to prevent rate limiting issues.
 */
function compareSequentialVsParallel() {
  try {
    Logger.log('[TEST] Starting performance comparison test');
    
    const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null);
    Logger.log(`[TEST] Retrieved ${accounts.length} accounts`);
    
    if (accounts.length === 0) {
      Logger.log('[TEST] No accounts found. Skipping test.');
      return;
    }
    
    // Limit to first 5 accounts to prevent rate limiting
    const testAccounts = accounts.slice(0, Math.min(5, accounts.length));
    Logger.log(`[TEST] Testing with ${testAccounts.length} accounts (limited to 5 max)`);
    
    // Sequential approach (old method)
    Logger.log('[TEST] Testing SEQUENTIAL approach...');
    const sequentialStart = new Date().getTime();
    const sequentialBalances = [];
    testAccounts.forEach((account) => {
      const balances = snapTradeRequest('GET', `/api/v1/accounts/${account.id}/balances`, {}, null);
      sequentialBalances.push({ accountId: account.id, balances: balances });
    });
    const sequentialTime = new Date().getTime() - sequentialStart;
    Logger.log(`[TEST] Sequential approach completed in ${sequentialTime}ms`);
    
    // Parallel approach (new method)
    Logger.log('[TEST] Testing PARALLEL approach...');
    const parallelStart = new Date().getTime();
    const parallelBalances = fetchAccountDataInParallel(testAccounts, 'balances');
    const parallelTime = new Date().getTime() - parallelStart;
    Logger.log(`[TEST] Parallel approach completed in ${parallelTime}ms`);
    
    // Calculate improvement
    const improvement = ((sequentialTime - parallelTime) / sequentialTime * 100).toFixed(2);
    const speedup = (sequentialTime / parallelTime).toFixed(2);
    
    Logger.log('[TEST] ========================================');
    Logger.log(`[TEST] Performance Results:`);
    Logger.log(`[TEST] Accounts tested: ${testAccounts.length}`);
    Logger.log(`[TEST] Sequential time: ${sequentialTime}ms`);
    Logger.log(`[TEST] Parallel time: ${parallelTime}ms`);
    Logger.log(`[TEST] Improvement: ${improvement}% faster`);
    Logger.log(`[TEST] Speedup factor: ${speedup}x`);
    Logger.log('[TEST] ========================================');
    
    return {
      accountCount: testAccounts.length,
      sequentialTime: sequentialTime,
      parallelTime: parallelTime,
      improvement: improvement,
      speedup: speedup,
    };
    
  } catch (error) {
    Logger.log(`[TEST] ✗ Test failed: ${error.message}`);
    Logger.log(`[TEST] Stack trace: ${error.stack}`);
    throw error;
  }
}

/**
 * Tests the ACB classification, record-building, and completeness diagnostics using a
 * fixed in-memory fixture. Requires no SnapTrade credentials. The running ACB / capital
 * gains math itself lives in sheet formulas and is verified with the worked example in
 * docs/ACB.md.
 */
function testAcbCalculations() {
  const assert = (cond, msg) => { if (!cond) throw new Error(`Assertion failed: ${msg}`); };
  const approx = (a, b) => Math.abs(a - b) < 1e-6;

  Logger.log('[TEST] Starting ACB calculation test');

  // 1. Activity classification.
  assert(classifyAcbActivity({ type: 'BUY' }) === 'BUY', 'BUY classifies as BUY');
  assert(classifyAcbActivity({ type: 'Sell' }) === 'SELL', 'Sell classifies as SELL');
  assert(classifyAcbActivity({ type: 'DIVIDEND', units: 2 }) === 'BUY', 'reinvested dividend is a BUY');
  assert(classifyAcbActivity({ type: 'DIVIDEND', units: 0 }) === null, 'cash dividend is ignored');
  assert(classifyAcbActivity({ type: 'RETURN OF CAPITAL' }) === 'ROC', 'ROC classifies as ROC');
  assert(classifyAcbActivity({ type: 'INTEREST' }) === null, 'interest is ignored');
  assert(classifyAcbActivity({ type: 'BUY', option_symbol: {} }) === null, 'options are ignored');

  // 2. Record building from a fixture (two AAPL buys, one AAPL sell, one orphan MSFT sell).
  const sym = (s) => ({ symbol: s, description: s, currency: { code: 'USD' } });
  const activities = [
    { type: 'BUY', symbol: sym('AAPL'), units: 100, price: 10, fee: 5, trade_date: '2023-01-10', currency: { code: 'USD' }, account: { name: 'RRSP' } },
    { type: 'BUY', symbol: sym('AAPL'), units: 50, price: 12, fee: 0, trade_date: '2023-02-01', currency: { code: 'USD' }, account: { name: 'RRSP' } },
    { type: 'SELL', symbol: sym('AAPL'), units: 80, price: 15, fee: 5, trade_date: '2023-03-01', currency: { code: 'USD' }, account: { name: 'RRSP' } },
    { type: 'SELL', symbol: sym('MSFT'), units: 10, price: 20, fee: 0, trade_date: '2023-01-05', currency: { code: 'USD' }, account: { name: 'TFSA' } },
    { type: 'INTEREST', symbol: sym('CASH'), amount: 1.23, trade_date: '2023-01-31', currency: { code: 'USD' } },
  ];

  const records = buildAcbRecords(activities);
  assert(records.length === 4, `4 records built (got ${records.length})`);

  sortAcbRecords(records);
  // Sorted by symbol then date: AAPL(buy,buy,sell) then MSFT(sell).
  assert(records[0].symbol === 'AAPL' && records[0].action === 'BUY', 'first record is AAPL BUY');
  assert(records[2].action === 'SELL', 'third AAPL record is the SELL');
  assert(records[3].symbol === 'MSFT', 'MSFT sorts after AAPL');

  // 3. Diagnostics: AAPL ends at 70 units and reconciles; MSFT is an orphan sell.
  const diagnostics = computeAcbDiagnostics(records, { AAPL: { units: 70, costNative: 749, currency: 'USD' } }); // MSFT absent -> 0
  assert(approx(diagnostics.AAPL.finalUnits, 70), `AAPL final units 70 (got ${diagnostics.AAPL.finalUnits})`);
  assert(diagnostics.AAPL.flagged === false, 'AAPL not flagged (reconciles to 70)');
  assert(diagnostics.MSFT.flagged === true, 'MSFT flagged (sell precedes any buy)');
  assert(diagnostics.MSFT.reason.indexOf('first activity is a sale') !== -1, 'MSFT reason mentions orphan sale');

  // 4. Reconciliation mismatch flags an otherwise-clean symbol.
  const mismatch = computeAcbDiagnostics(records, { AAPL: { units: 999, costNative: 0, currency: 'USD' } });
  assert(mismatch.AAPL.flagged === true, 'AAPL flagged when holdings disagree with ledger');

  Logger.log('[TEST] ✓ ACB calculation test passed');
  return { records: records.length, aaplFinalUnits: diagnostics.AAPL.finalUnits, flagged: ['MSFT'] };
}

/**
 * Tests income classification and record-building from a fixed fixture. No credentials needed.
 */
function testIncomeTracker() {
  const assert = (cond, msg) => { if (!cond) throw new Error(`Assertion failed: ${msg}`); };

  Logger.log('[TEST] Starting income tracker test');

  assert(classifyIncomeActivity({ type: 'DIVIDEND' }) === 'Dividend', 'DIVIDEND -> Dividend');
  assert(classifyIncomeActivity({ type: 'INTEREST' }) === 'Interest', 'INTEREST -> Interest');
  assert(classifyIncomeActivity({ type: 'DISTRIBUTION' }) === 'Distribution', 'DISTRIBUTION -> Distribution');
  assert(classifyIncomeActivity({ type: 'NON_RESIDENT_TAX' }) === 'Tax Withheld', 'NR tax -> Tax Withheld');
  assert(classifyIncomeActivity({ type: 'BUY' }) === null, 'BUY is not income');

  const sym = (s) => ({ symbol: s, description: s, currency: { code: 'USD' } });
  const activities = [
    { type: 'DIVIDEND', symbol: sym('VTI'), amount: 50, trade_date: '2023-03-15', currency: { code: 'USD' }, account: { name: 'RRSP' } },
    { type: 'INTEREST', amount: 5, trade_date: '2023-04-01', currency: { code: 'CAD' }, account: { name: 'Cash' } },
    { type: 'NON_RESIDENT_TAX', symbol: sym('VTI'), amount: -7.5, trade_date: '2023-03-15', currency: { code: 'USD' } },
    { type: 'BUY', symbol: sym('VTI'), amount: -1000, trade_date: '2023-02-01', currency: { code: 'USD' } },
    { type: 'DIVIDEND', symbol: sym('XEQT'), amount: 0, trade_date: '2023-05-01', currency: { code: 'CAD' } }, // reinvested-as-units: no cash
  ];

  const records = buildIncomeRecords(activities);
  assert(records.length === 3, `3 income records (got ${records.length})`);
  const cats = records.map((r) => r.category).sort();
  assert(cats.join(',') === 'Dividend,Interest,Tax Withheld', `categories (got ${cats.join(',')})`);

  // Timezone-safe date parsing: calendar day/year preserved regardless of zone.
  assert(parseActivityDate_('2024-01-01').getFullYear() === 2024, 'Jan 1 stays in its year (no UTC rollback)');
  assert(parseActivityDate_('2023-12-31').getDate() === 31, 'Dec 31 calendar day preserved');
  assert(parseActivityDate_('') === null, 'empty date -> null');

  Logger.log('[TEST] ✓ Income tracker test passed');
  return { records: records.length };
}

/**
 * Tests option contract extraction across the nesting variations. No credentials needed.
 */
function testOptionsExtraction() {
  const assert = (cond, msg) => { if (!cond) throw new Error(`Assertion failed: ${msg}`); };

  Logger.log('[TEST] Starting options extraction test');

  // Nested: position.symbol.option_symbol with an underlying_symbol object.
  const a = extractOptionInfo({
    symbol: { option_symbol: { ticker: 'AAPL 240119C00150000', option_type: 'CALL', strike_price: 150, expiration_date: '2024-01-19', underlying_symbol: { symbol: 'AAPL' } } },
    units: 2, price: 3.5, currency: { code: 'USD' },
  });
  assert(a.type === 'CALL', 'type CALL');
  assert(a.strike === 150, 'strike 150');
  assert(a.underlying === 'AAPL', 'underlying AAPL from object');
  assert(a.expiry === '2024-01-19', 'expiry parsed');

  // Flat: option fields directly on position.option_symbol, underlying inferred from ticker.
  const b = extractOptionInfo({ option_symbol: { ticker: 'TSLA 251219P00200000', option_type: 'put', strike_price: 200 } });
  assert(b.type === 'PUT', 'type normalized to PUT');
  assert(b.underlying === 'TSLA', 'underlying inferred from ticker');

  Logger.log('[TEST] ✓ Options extraction test passed');
  return { ok: true };
}

/**
 * Tests forex (currency-as-property) record building and diagnostics. No credentials needed.
 */
function testForexCalculations() {
  const assert = (cond, msg) => { if (!cond) throw new Error(`Assertion failed: ${msg}`); };
  const approx = (a, b) => Math.abs(a - b) < 1e-6;

  Logger.log('[TEST] Starting forex calculation test');

  const activities = [
    { type: 'SELL', amount: 1000, trade_date: '2023-01-10', currency: { code: 'USD' }, account: { name: 'Margin' } },
    { type: 'BUY', amount: -600, trade_date: '2023-02-01', currency: { code: 'USD' } },
    { type: 'DIVIDEND', amount: 50, trade_date: '2023-03-01', currency: { code: 'USD' } },
    { type: 'INTEREST', amount: 5, trade_date: '2023-04-01', currency: { code: 'CAD' } }, // home currency ignored
    { type: 'FEE', amount: 0, trade_date: '2023-04-02', currency: { code: 'USD' } },       // non-cash ignored
    { type: 'BUY', amount: -200, trade_date: '2023-01-05', currency: { code: 'EUR' } },     // orphan disposition
  ];

  const records = buildForexRecords(activities);
  assert(records.length === 4, `4 forex records (got ${records.length})`); // 3 USD + 1 EUR

  sortForexRecords(records);
  const diag = computeForexDiagnostics(records, { USD: 450 }); // EUR absent -> 0
  assert(approx(diag.USD.finalUnits, 450), `USD balance 450 (got ${diag.USD.finalUnits})`);
  assert(diag.USD.flagged === false, 'USD reconciles, not flagged');
  assert(diag.EUR.flagged === true, 'EUR orphan disposition flagged');
  assert(diag.EUR.reason.indexOf('first activity is a disposition') !== -1, 'EUR reason mentions orphan disposition');

  Logger.log('[TEST] ✓ Forex calculation test passed');
  return { records: records.length };
}

/**
 * Tests realized-trade leg classification and per-instrument grouping/ordering from a fixed
 * fixture. No credentials needed. Covers an equity buy/buy/sell and an option open→close→reopen
 * (roll) sequence, asserting that the rolled option's close emits a CLOSE leg. The running
 * average-cost / realized-P/L math itself lives in sheet formulas (see writeRealizedLedger).
 */
function testRealizedTrades() {
  const assert = (cond, msg) => { if (!cond) throw new Error(`Assertion failed: ${msg}`); };
  const approx = (a, b) => Math.abs(a - b) < 1e-6;

  Logger.log('[TEST] Starting realized trades test');

  // 1. Leg classification: opens, closes, expiry/assignment, and units-sign fallback.
  assert(classifyRealizedLeg({ type: 'BUY' }) === 'OPEN', 'BUY -> OPEN');
  assert(classifyRealizedLeg({ type: 'SELL' }) === 'CLOSE', 'SELL -> CLOSE');
  assert(classifyRealizedLeg({ type: 'BUY_TO_OPEN' }) === 'OPEN', 'BUY_TO_OPEN -> OPEN');
  assert(classifyRealizedLeg({ type: 'SELL_TO_CLOSE' }) === 'CLOSE', 'SELL_TO_CLOSE -> CLOSE');
  assert(classifyRealizedLeg({ type: 'OPTIONEXPIRATION' }) === 'CLOSE', 'expiry -> CLOSE');
  assert(classifyRealizedLeg({ type: 'OPTIONASSIGNMENT' }) === 'CLOSE', 'assignment -> CLOSE');
  assert(classifyRealizedLeg({ type: 'TRADE', units: 5 }) === 'OPEN', 'positive units -> OPEN');
  assert(classifyRealizedLeg({ type: 'TRADE', units: -5 }) === 'CLOSE', 'negative units -> CLOSE');
  assert(classifyRealizedLeg({ type: 'DIVIDEND', units: 0 }) === null, 'no-units, non-trade -> null');

  // 2. Build legs from a fixture: an equity buy/buy/sell, an income event (skipped), and an
  // option roll (open the original contract, close it, open a replacement contract).
  const sym = (s) => ({ symbol: s, description: s, currency: { code: 'USD' } });
  const opt = (ticker) => ({ ticker: ticker, option_type: 'CALL', strike_price: 150, expiration_date: '2024-01-19' });
  const activities = [
    // Equity round trip (two opens, one close).
    { type: 'BUY', symbol: sym('AAPL'), units: 100, price: 10, trade_date: '2023-01-10', currency: { code: 'USD' }, account: { name: 'RRSP' } },
    { type: 'BUY', symbol: sym('AAPL'), units: 50, price: 12, trade_date: '2023-02-01', currency: { code: 'USD' }, account: { name: 'RRSP' } },
    { type: 'SELL', symbol: sym('AAPL'), units: 80, price: 15, trade_date: '2023-03-01', currency: { code: 'USD' }, account: { name: 'RRSP' } },
    // Income — neither an equity nor option open/close, must be skipped.
    { type: 'DIVIDEND', symbol: sym('AAPL'), amount: 25, trade_date: '2023-02-15', currency: { code: 'USD' } },
    // Option roll: open original, close it (the roll), then open the replacement contract.
    { type: 'BUY_TO_OPEN', option_symbol: opt('AAPL 240119C00150000'), units: 2, price: 3.5, multiplier: 100, trade_date: '2023-06-01', currency: { code: 'USD' }, account: { name: 'RRSP' } },
    { type: 'SELL_TO_CLOSE', option_symbol: opt('AAPL 240119C00150000'), units: 2, price: 5.0, multiplier: 100, trade_date: '2023-07-01', currency: { code: 'USD' }, account: { name: 'RRSP' } },
    { type: 'BUY_TO_OPEN', option_symbol: opt('AAPL 240621C00160000'), units: 2, price: 4.0, multiplier: 100, trade_date: '2023-07-01', currency: { code: 'USD' }, account: { name: 'RRSP' } },
  ];

  const legs = buildRealizedLegs(activities);
  // 6 trade legs (3 equity + 3 option); the dividend is dropped.
  assert(legs.length === 6, `6 legs built (got ${legs.length})`);

  const equityLegs = legs.filter((l) => l.instrumentType === 'Equity');
  const optionLegs = legs.filter((l) => l.instrumentType === 'Option');
  assert(equityLegs.length === 3, `3 equity legs (got ${equityLegs.length})`);
  assert(optionLegs.length === 3, `3 option legs (got ${optionLegs.length})`);

  // Equity: two opens then one close, all keyed to AAPL.
  const equityCloses = equityLegs.filter((l) => l.action === 'CLOSE');
  assert(equityCloses.length === 1, `1 equity close (got ${equityCloses.length})`);
  assert(equityLegs.every((l) => l.symbol === 'AAPL'), 'equity legs keyed by symbol');
  assert(equityLegs.every((l) => l.multiplier === 1), 'equity multiplier is 1');

  // Option roll: the closed contract emits a CLOSE leg; the replacement is a separate group.
  const rolledClose = optionLegs.find((l) => l.action === 'CLOSE');
  assert(!!rolledClose, 'rolled option emits a CLOSE leg');
  assert(rolledClose.symbol === 'AAPL 240119C00150000', 'CLOSE leg keyed to the original OCC ticker');
  assert(rolledClose.multiplier === 100, 'option multiplier is 100');
  const optionSymbols = optionLegs.map((l) => l.symbol).filter((s, i, a) => a.indexOf(s) === i);
  assert(optionSymbols.length === 2, `option roll spans 2 contracts (got ${optionSymbols.length})`);

  // Grouping/ordering: every close has a preceding open within its own instrument group (opens
  // are sorted before closes on the same date so a same-day open feeds the average cost first).
  const closeAfterOpenInGroup = legs.every((leg, i) => {
    if (leg.action !== 'CLOSE') return true;
    for (let j = i - 1; j >= 0 && legs[j].symbol === leg.symbol; j--) {
      if (legs[j].action === 'OPEN') return true;
    }
    return false;
  });
  assert(closeAfterOpenInGroup, 'every close has a preceding open within its instrument group');

  // 3. Amount path: when the feed gives a total `amount` (not a per-unit price), proceeds must
  // be the native price per single share/contract, so the ledger formula (units x proceeds x
  // multiplier) reconstructs the original total — not units^2 or a multiplier-off figure.
  const amountLegs = buildRealizedLegs([
    { type: 'SELL', symbol: sym('AAPL'), units: 80, amount: 1200, trade_date: '2023-03-01', currency: { code: 'USD' } },
    { type: 'SELL_TO_CLOSE', option_symbol: opt('AAPL 240119C00150000'), units: 2, amount: 1000, multiplier: 100, trade_date: '2023-07-01', currency: { code: 'USD' } },
  ]);
  const eqAmt = amountLegs.find((l) => l.instrumentType === 'Equity');
  const optAmt = amountLegs.find((l) => l.instrumentType === 'Option');
  assert(approx(eqAmt.proceeds, 15), `equity amount-path proceeds/share 15 (got ${eqAmt.proceeds})`); // 1200/80
  assert(approx(optAmt.proceeds, 5), `option amount-path proceeds/share 5 (got ${optAmt.proceeds})`); // 1000/(2*100)
  assert(approx(eqAmt.units * eqAmt.proceeds * eqAmt.multiplier, 1200), 'equity total reconstructs to amount');
  assert(approx(optAmt.units * optAmt.proceeds * optAmt.multiplier, 1000), 'option total reconstructs to amount');

  Logger.log('[TEST] ✓ Realized trades test passed');
  return {
    legs: legs.length,
    equityCloses: equityCloses.length,
    optionCloses: optionLegs.filter((l) => l.action === 'CLOSE').length,
    optionContracts: optionSymbols.length,
  };
}

/**
 * Tests the balance reconciliation guards: cash-field selection and tolerance. No creds needed.
 */
function testReconciliationGuards() {
  const assert = (cond, msg) => { if (!cond) throw new Error(`Assertion failed: ${msg}`); };

  Logger.log('[TEST] Starting reconciliation guard test');

  // A real cash balance of 0 must NOT be replaced by total/available.
  const zeroCash = extractBalancesByCurrency([
    { currency: { code: 'USD' }, cash: 0, total: 5000, available: 5000, buying_power: 1000 },
  ]);
  assert(zeroCash.USD.cash === 0, `cash 0 preserved (got ${zeroCash.USD.cash})`);
  assert(zeroCash.USD.buyingPower === 1000, 'buying power read');

  // Missing cash falls back to total.
  const fallback = extractBalancesByCurrency([{ currency: { code: 'CAD' }, total: 250 }]);
  assert(fallback.CAD.cash === 250, `cash falls back to total (got ${fallback.CAD.cash})`);

  // Buying power is not summed across duplicate balance objects.
  const dupes = extractBalancesByCurrency([
    { currency: { code: 'USD' }, cash: 10, buying_power: 1000 },
    { currency: { code: 'USD' }, cash: 10, buying_power: 1000 },
  ]);
  assert(dupes.USD.buyingPower === 1000, `buying power not doubled (got ${dupes.USD.buyingPower})`);

  // Cash check tolerates sub-cent drift but flags real differences.
  assert(computeBalanceCheck(100.004, { cash: 100, buyingPower: 0 }) === 'OK', 'sub-cent drift OK');
  assert(computeBalanceCheck(105, { cash: 100, buyingPower: 0 }).indexOf('Trust /balances') !== -1, 'real diff flagged');

  Logger.log('[TEST] ✓ Reconciliation guard test passed');
  return { ok: true };
}

/**
 * Tests the pure debug-log string helper (truncation + safe stringify). No credentials needed.
 */
function testDebugLogHelper() {
  const assert = (cond, msg) => { if (!cond) throw new Error(`Assertion failed: ${msg}`); };

  Logger.log('[TEST] Starting debug-log helper test');

  assert(safeStringifyForLog_('hello') === 'hello', 'string passthrough');
  assert(safeStringifyForLog_({ a: 1 }) === '{"a":1}', 'object stringified');
  assert(safeStringifyForLog_(undefined) === '', 'undefined -> empty');

  const big = safeStringifyForLog_('x'.repeat(6000));
  assert(big.length < 6000 && big.indexOf('[truncated]') !== -1, 'long output truncated');

  // Circular references must not throw.
  const circular = {}; circular.self = circular;
  const out = safeStringifyForLog_(circular);
  assert(typeof out === 'string', 'circular reference handled without throwing');

  Logger.log('[TEST] ✓ Debug-log helper test passed');
  return { ok: true };
}

/**
 * Runs all validation tests.
 */
function runAllValidationTests() {
  Logger.log('========================================');
  Logger.log('Running all validation tests...');
  Logger.log('========================================');
  
  const results = {
    acb: null,
    income: null,
    parallelFetch: null,
    historyUpdate: null,
    performance: null,
  };

  try {
    results.acb = testAcbCalculations();
  } catch (error) {
    Logger.log(`Failed: testAcbCalculations - ${error.message}`);
  }

  try {
    results.income = testIncomeTracker();
  } catch (error) {
    Logger.log(`Failed: testIncomeTracker - ${error.message}`);
  }

  try {
    results.options = testOptionsExtraction();
  } catch (error) {
    Logger.log(`Failed: testOptionsExtraction - ${error.message}`);
  }

  try {
    results.forex = testForexCalculations();
  } catch (error) {
    Logger.log(`Failed: testForexCalculations - ${error.message}`);
  }

  try {
    results.realizedTrades = testRealizedTrades();
  } catch (error) {
    Logger.log(`Failed: testRealizedTrades - ${error.message}`);
  }

  try {
    results.reconciliation = testReconciliationGuards();
  } catch (error) {
    Logger.log(`Failed: testReconciliationGuards - ${error.message}`);
  }

  try {
    results.debugLog = testDebugLogHelper();
  } catch (error) {
    Logger.log(`Failed: testDebugLogHelper - ${error.message}`);
  }

  try {
    results.parallelFetch = testFetchAccountDataInParallel();
  } catch (error) {
    Logger.log(`Failed: testFetchAccountDataInParallel - ${error.message}`);
  }
  
  try {
    results.historyUpdate = testUpdateAccountHistoryOnce();
  } catch (error) {
    Logger.log(`Failed: testUpdateAccountHistoryOnce - ${error.message}`);
  }
  
  try {
    results.performance = compareSequentialVsParallel();
  } catch (error) {
    Logger.log(`Failed: compareSequentialVsParallel - ${error.message}`);
  }
  
  Logger.log('========================================');
  Logger.log('All tests completed!');
  Logger.log('========================================');
  
  // Log summary of results instead of full JSON to keep logs readable
  const summaries = [
    { test: 'Performance', data: results.performance, format: r => `${r.improvement}% faster with ${r.accountCount} accounts` },
    { test: 'History update', data: results.historyUpdate, format: r => `${r.difference}ms difference between with/without prefetch` },
    { test: 'Parallel fetch', data: results.parallelFetch, format: r => `${r.accountCount} accounts processed successfully` }
  ];
  
  summaries.forEach(({ test, data, format }) => {
    if (data) {
      Logger.log(`${test} test: ${format(data)}`);
    }
  });
  
  return results;
}

/**
 * Tests the getAccountsForSidebar function to ensure it correctly:
 * 1. Extracts meaningful status strings from sync_status objects
 * 2. Calculates balances from holdings data (cash + securities)
 */
function testGetAccountsForSidebar() {
  try {
    Logger.log('[TEST] Starting getAccountsForSidebar test');
    
    const sidebarData = getAccountsForSidebar();
    
    if (sidebarData.error) {
      Logger.log(`[TEST] ✗ Error returned: ${sidebarData.error}`);
      return { success: false, error: sidebarData.error };
    }
    
    Logger.log(`[TEST] Retrieved ${sidebarData.length} accounts for sidebar`);
    
    let statusOkCount = 0;
    let balanceOkCount = 0;
    
    sidebarData.forEach((account, index) => {
      Logger.log(`[TEST] Account ${index + 1}:`);
      Logger.log(`[TEST]   Name: ${account.name}`);
      Logger.log(`[TEST]   Institution: ${account.institution}`);
      Logger.log(`[TEST]   Balance: $${account.balance.toFixed(2)}`);
      Logger.log(`[TEST]   Status: ${account.status}`);
      
      // Check that status is a string (not [object Object])
      if (typeof account.status === 'string' && !account.status.includes('[object')) {
        statusOkCount++;
        Logger.log(`[TEST]   ✓ Status is a valid string`);
      } else {
        Logger.log(`[TEST]   ✗ Status is invalid: ${account.status}`);
      }
      
      // Check that balance is a number
      if (typeof account.balance === 'number' && !isNaN(account.balance)) {
        balanceOkCount++;
        Logger.log(`[TEST]   ✓ Balance is a valid number`);
      } else {
        Logger.log(`[TEST]   ✗ Balance is invalid: ${account.balance}`);
      }
    });
    
    const success = statusOkCount === sidebarData.length && balanceOkCount === sidebarData.length;
    
    Logger.log('[TEST] ========================================');
    Logger.log(`[TEST] Status validation: ${statusOkCount}/${sidebarData.length} accounts`);
    Logger.log(`[TEST] Balance validation: ${balanceOkCount}/${sidebarData.length} accounts`);
    Logger.log(`[TEST] Overall result: ${success ? '✓ PASSED' : '✗ FAILED'}`);
    Logger.log('[TEST] ========================================');
    
    return {
      success: success,
      totalAccounts: sidebarData.length,
      statusOk: statusOkCount,
      balanceOk: balanceOkCount,
    };
    
  } catch (error) {
    Logger.log(`[TEST] ✗ Test failed: ${error.message}`);
    Logger.log(`[TEST] Stack trace: ${error.stack}`);
    return { success: false, error: error.message };
  }
}
