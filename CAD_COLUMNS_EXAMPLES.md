# Visual Examples of CAD Columns

## Holdings Sheet Example

| Account | Symbol | Description | Quantity | Price | Price (CAD) | Market Value | Market Value (CAD) | Cost Basis | Cost Basis (CAD) | Gain/Loss | Gain/Loss (CAD) | Currency |
|---------|--------|-------------|----------|-------|-------------|--------------|-------------------|------------|------------------|-----------|----------------|----------|
| Account1 | AAPL | Apple Inc. | 10 | $150.00 | $202.50 | $1,500.00 | $2,025.00 | $1,200.00 | $1,620.00 | $300.00 | $405.00 | USD |
| Account2 | SHOP | Shopify Inc. | 5 | $75.00 | $75.00 | $375.00 | $375.00 | $300.00 | $300.00 | $75.00 | $75.00 | CAD |
| Account3 | ASML | ASML Holding | 2 | €700.00 | $1,022.00 | €1,400.00 | $2,044.00 | €1,200.00 | $1,752.00 | €200.00 | $292.00 | EUR |

*Note: Exchange rates shown are examples. Actual rates are fetched in real-time from GOOGLEFINANCE.*

---

## Accounts Sheet Example

| Account Name | Balance | Balance (CAD) | Currency | Notes | Last Update | Institution |
|--------------|---------|---------------|----------|-------|-------------|-------------|
| TD Checking | $5,000.00 | $6,750.00 | USD | | 2024-01-15 | TD Ameritrade |
| RBC Savings | $10,000.00 | $10,000.00 | CAD | | 2024-01-15 | RBC Direct |
| IBKR Trading | €2,500.00 | $3,650.00 | EUR | | 2024-01-15 | Interactive Brokers |

---

## Account History Sheet Example

| Timestamp | Account Name | Account ID | Balance | Balance (CAD) | Currency | Institution |
|-----------|--------------|------------|---------|---------------|----------|-------------|
| 2024-01-15 | TD Checking | 123456 | $5,000.00 | $6,750.00 | USD | TD Ameritrade |
| 2024-01-15 | RBC Savings | 789012 | $10,000.00 | $10,000.00 | CAD | RBC Direct |
| 2024-01-14 | TD Checking | 123456 | $4,800.00 | $6,480.00 | USD | TD Ameritrade |
| 2024-01-14 | RBC Savings | 789012 | $9,500.00 | $9,500.00 | CAD | RBC Direct |

---

## Transactions Sheet Example

| Date | Amount | Amount (CAD) | Currency | Description | Category | Account |
|------|--------|--------------|----------|-------------|----------|---------|
| 2024-01-15 | $500.00 | $675.00 | USD | Buy AAPL | BUY | TD Checking |
| 2024-01-14 | $200.00 | $200.00 | CAD | Buy SHOP | BUY | RBC Savings |
| 2024-01-13 | €150.00 | $219.00 | EUR | Buy ASML | BUY | IBKR Trading |
| 2024-01-12 | -$50.00 | -$67.50 | USD | Dividend | DIVIDEND | TD Checking |

---

## Key Features Illustrated

1. **Multi-Currency Support**: The examples show USD, CAD, and EUR currencies
2. **Automatic Conversion**: CAD columns show converted values using current exchange rates
3. **CAD Passthrough**: When currency is already CAD, the CAD column shows the same value
4. **Consistent Formatting**: All monetary values are formatted as currency

## Example Exchange Rates Used (for illustration)

- USD to CAD: 1.35
- EUR to CAD: 1.46

*These are example rates. In production, GOOGLEFINANCE provides real-time rates.*

## Formula Examples in Action

**For a USD price of $150.00:**
```
=IF(M2="CAD", E2, IF(M2="", E2, E2 * GOOGLEFINANCE("CURRENCY:USDCAD")))
Result: $150.00 × 1.35 = $202.50 CAD
```

**For a CAD price of $75.00:**
```
=IF(M2="CAD", E2, IF(M2="", E2, E2 * GOOGLEFINANCE("CURRENCY:CADCAD")))
Result: $75.00 (no conversion needed)
```

**For a EUR price of €700.00:**
```
=IF(M2="CAD", E2, IF(M2="", E2, E2 * GOOGLEFINANCE("CURRENCY:EURCAD")))
Result: €700.00 × 1.46 = $1,022.00 CAD
```
