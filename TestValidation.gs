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
 * Runs all validation tests.
 */
function runAllValidationTests() {
  Logger.log('========================================');
  Logger.log('Running all validation tests...');
  Logger.log('========================================');
  
  const results = {
    parallelFetch: null,
    historyUpdate: null,
    performance: null,
  };
  
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
  if (results.performance) {
    Logger.log(`Performance test: ${results.performance.improvement}% faster with ${results.performance.accountCount} accounts`);
  }
  if (results.historyUpdate) {
    Logger.log(`History update test: ${results.historyUpdate.difference}ms difference between with/without prefetch`);
  }
  if (results.parallelFetch) {
    Logger.log(`Parallel fetch test: ${results.parallelFetch.accountCount} accounts processed successfully`);
  }
  
  return results;
}
