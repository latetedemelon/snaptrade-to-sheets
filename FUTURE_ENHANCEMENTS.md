# Future Enhancement Opportunities

## Code Quality Improvements

### 1. Extract Shared Currency Grouping Logic
The logic for grouping cash and holdings by currency is duplicated in `refreshAccounts()` and `updateAccountHistoryOnce()`. 

**Suggestion**: Create a shared function:
```javascript
function calculateAccountSummaryByCurrency(holdings) {
  const byCurrency = {};
  
  // Add cash balances
  if (holdings.account_balances) {
    holdings.account_balances.forEach((balance) => {
      const currencyCode = (balance.currency && balance.currency.code) || 'USD';
      if (!byCurrency[currencyCode]) {
        byCurrency[currencyCode] = { cash: 0, holdingsValue: 0 };
      }
      byCurrency[currencyCode].cash += balance.cash || 0;
    });
  }
  
  // Add holdings value
  if (holdings.positions) {
    holdings.positions.forEach((position) => {
      const currencyCode = (position.currency && position.currency.code) || 'USD';
      if (!byCurrency[currencyCode]) {
        byCurrency[currencyCode] = { cash: 0, holdingsValue: 0 };
      }
      const units = position.units || 0;
      const price = position.price || 0;
      byCurrency[currencyCode].holdingsValue += units * price;
    });
  }
  
  return byCurrency;
}
```

**Benefits**:
- Eliminates code duplication
- Ensures consistent calculations
- Easier to maintain and test

### 2. Centralized Column Management
Currently column numbers are hardcoded throughout the code.

**Suggestion**: Use constants or a column mapping object:
```javascript
const ACCOUNTS_COLUMNS = {
  ACCOUNT_NAME: 1,
  ACCOUNT_ID: 2,
  CASH: 3,
  HOLDINGS_VALUE: 4,
  TOTAL_VALUE: 5,
  CURRENCY: 6,
  TOTAL_CAD: 7,
  LAST_UPDATE: 8,
  INSTITUTION: 9,
  RAW_DATA: 10
};
```

**Benefits**:
- Self-documenting code
- Easy to update if columns change
- Reduces magic numbers

### 3. Better Error Handling
Currently, failed accounts are silently skipped with a log message.

**Suggestion**: Collect errors and report them:
```javascript
const errors = [];

accounts.forEach((account) => {
  const holdings = holdingsMap[account.id];
  
  if (!holdings) {
    errors.push({ account: account.name || account.id, error: 'No holdings data' });
    return;
  }
  // ...
});

if (errors.length > 0) {
  Logger.log(`Failed to process ${errors.length} accounts: ${JSON.stringify(errors)}`);
  // Optionally show warning to user
}
```

**Benefits**:
- User visibility into failures
- Better debugging
- Can retry failed accounts

### 4. Batch Processing for Large Account Sets
Currently all accounts are processed in a single batch.

**Suggestion**: For users with 50+ accounts, implement batching:
```javascript
function fetchAccountDataInParallel(accounts, endpointSuffix) {
  const BATCH_SIZE = 50;
  const resultMap = {};
  
  for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
    const batch = accounts.slice(i, i + BATCH_SIZE);
    const batchResults = fetchBatch(batch, endpointSuffix);
    Object.assign(resultMap, batchResults);
  }
  
  return resultMap;
}
```

**Benefits**:
- Stays well under the 100 request limit
- Better error recovery
- Progress reporting for large datasets

### 5. Improved Documentation
**Suggestions**:
- Add JSDoc comments with @example tags
- Document the holdings endpoint returning both cash and positions
- Add inline comments explaining R1C1 notation

### 6. Testing Infrastructure
**Suggestions**:
- Add unit tests for currency grouping logic
- Add integration tests for parallel fetching
- Mock API responses for reliable testing

## Priority Recommendations

**High Priority** (should be done soon):
1. Extract shared currency grouping logic (reduces maintenance burden)
2. Centralized column management (prevents bugs from column changes)

**Medium Priority** (nice to have):
3. Better error handling and reporting
4. Improved documentation

**Low Priority** (future optimization):
5. Batch processing for 50+ accounts (affects very few users)
6. Testing infrastructure (if project grows)

## Implementation Notes
These improvements are not critical for the current functionality but would improve code maintainability and robustness for future development.

All changes should be made incrementally to avoid introducing bugs, with thorough testing of each enhancement.
