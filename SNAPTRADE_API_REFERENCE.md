# SnapTrade API Reference

This document provides details about the SnapTrade API structure to help with future development and troubleshooting.

## Holdings Endpoint

**Endpoint**: `GET /api/v1/accounts/{accountId}/holdings`

### Response Structure

The holdings endpoint returns an object with the following structure:

```javascript
{
  "account": {...},                    // Account metadata
  "positions": [...],                  // Array of position objects (securities/stocks)
  "balances": [...],                   // Array of balance objects (cash balances) ⚠️
  "orders": [...],                     // Recent orders
  "cache_timestamp": "...",            // Cache metadata
  "cache_expiry": "...",
  "cache_expired": false,
  "option_positions": [...],           // Options positions
  "total_value": {...}                 // Total portfolio value
}
```

### ⚠️ Important: Cash Balance Field Name

**The cash balances are in the `balances` field, NOT `account_balances`.**

This is a key detail that caused issues initially. The code checks both field names for compatibility:
```javascript
const balancesArray = holdings.account_balances || holdings.balances;
```

### Balance Object Structure

Each item in the `balances` array has this structure:

```javascript
{
  "currency": {
    "code": "USD",                     // Currency code (USD, CAD, etc.)
    "name": "US Dollar",
    "id": "57f81c53-bdda-45a7-a51f-032afd1ae41b"
  },
  "cash": 26535.3624,                  // ⭐ Cash amount - PRIMARY field
  "buying_power": 26535.3624           // Available buying power
}
```

### Position Object Structure

Each item in the `positions` array has this structure:

```javascript
{
  "symbol": {...},
  "units": 100,                        // Number of shares/units
  "price": 150.50,                     // Current price per unit
  "currency": {
    "code": "USD",
    "name": "US Dollar",
    "id": "..."
  },
  // ... other fields
}
```

## Cash Retrieval Logic

To retrieve cash amounts from the holdings response:

1. **Access the balances array**: `holdings.balances` (fallback to `holdings.account_balances` for compatibility)
2. **Iterate through each balance object** in the array
3. **Extract cash amount**: Use `balance.cash` as the primary field
4. **Fallback fields**: If `balance.cash` is not available, try `balance.total` or `balance.available`
5. **Group by currency**: Use `balance.currency.code` to group balances by currency

### Code Example

```javascript
const balancesArray = holdings.account_balances || holdings.balances;

if (balancesArray && Array.isArray(balancesArray)) {
  balancesArray.forEach((balance) => {
    const currencyCode = (balance.currency && balance.currency.code) || 'USD';
    const cashAmount = balance.cash || balance.total || balance.available || 0;
    
    // Process cash amount by currency
    byCurrency[currencyCode].cash += cashAmount;
  });
}
```

## Holdings Value Calculation

Holdings (securities) value is calculated from the `positions` array:

```javascript
if (holdings.positions) {
  holdings.positions.forEach((position) => {
    const currencyCode = (position.currency && position.currency.code) || 'USD';
    const units = position.units || 0;
    const price = position.price || 0;
    const value = units * price;
    
    // Process holdings value by currency
    byCurrency[currencyCode].holdingsValue += value;
  });
}
```

## Common Issues and Solutions

### Issue: Cash showing as $0

**Cause**: Using `holdings.account_balances` instead of `holdings.balances`

**Solution**: Check both field names:
```javascript
const balancesArray = holdings.account_balances || holdings.balances;
```

### Issue: Accounts not showing at all

**Cause**: Empty `byCurrency` object when no balances or positions exist

**Solution**: Add fallback to create default entry:
```javascript
if (Object.keys(byCurrency).length === 0) {
  // Add default row with zero values
  rows.push([...defaultValues, 'USD', ...]);
}
```

## Testing

To verify cash retrieval is working:

1. Run "Refresh Accounts" from the SnapTrade menu
2. Check the Accounts sheet - Cash column should show amounts
3. Open the sidebar - Total should include both cash and holdings value
4. For debugging, add this to `calculateBalanceByCurrency()`:
   ```javascript
   Logger.log(`Holdings object keys: ${Object.keys(holdings).join(', ')}`);
   Logger.log(`Balance object: ${JSON.stringify(balance)}`);
   ```

## API Endpoint Reference

- **List Accounts**: `GET /api/v1/accounts`
- **Get Holdings**: `GET /api/v1/accounts/{accountId}/holdings`
- **Get Balances**: `GET /api/v1/accounts/{accountId}/balances` (separate endpoint, not currently used)
- **Get Transactions**: `GET /api/v1/accounts/{accountId}/transactions`

## Notes

- The API may return multiple balance objects for multi-currency accounts (e.g., CAD and USD)
- Cash amounts can be negative (margin/borrowed funds)
- The `buying_power` field may differ from `cash` (includes margin)
- Always group by currency code to handle multi-currency accounts correctly
