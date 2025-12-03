# CAD Equivalent Columns Implementation

## Overview
Added Canadian Dollar (CAD) equivalent columns to all four data sheets using Google Sheets' GOOGLEFINANCE function for automatic currency conversion.

## Sheet Changes

### 1. Holdings Sheet
**New Columns Added:**
- Price (CAD) - Column F
- Market Value (CAD) - Column H
- Cost Basis (CAD) - Column J
- Gain/Loss (CAD) - Column L

**Updated Column Structure:**
```
A: Account
B: Symbol
C: Description
D: Quantity
E: Price
F: Price (CAD)          ← NEW
G: Market Value
H: Market Value (CAD)   ← NEW
I: Cost Basis
J: Cost Basis (CAD)     ← NEW
K: Gain/Loss
L: Gain/Loss (CAD)      ← NEW
M: Currency
```

### 2. Accounts Sheet
**New Columns Added:**
- Balance (CAD) - Column C

**Updated Column Structure:**
```
A: Account Name
B: Balance
C: Balance (CAD)        ← NEW
D: Currency
E: Notes
F: Last Update
G: Institution
H: Account ID (hidden)
I: Raw Data (hidden)
```

### 3. Account History Sheet
**New Columns Added:**
- Balance (CAD) - Column E

**Updated Column Structure:**
```
A: Timestamp
B: Account Name
C: Account ID
D: Balance
E: Balance (CAD)        ← NEW
F: Currency
G: Institution
```

### 4. Transactions Sheet
**New Columns Added:**
- Amount (CAD) - Column C
- Currency - Column D (moved from transaction data)

**Updated Column Structure:**
```
A: Date
B: Amount
C: Amount (CAD)         ← NEW
D: Currency             ← NEW
E: Description
F: Category
G: Account
H: Attachment
I: Transaction ID (hidden)
J: Raw Data (hidden)
```

## How It Works

### GOOGLEFINANCE Formula
All CAD columns use the GOOGLEFINANCE formula to automatically convert currencies:

```javascript
=IF(Currency="CAD", OriginalValue, 
   IF(Currency="", OriginalValue, 
      OriginalValue * GOOGLEFINANCE("CURRENCY:" & Currency & "CAD")))
```

**Logic:**
1. If the currency is already CAD, use the original value (no conversion)
2. If the currency is empty, assume it's the same as the original value
3. Otherwise, multiply by the current exchange rate from GOOGLEFINANCE

### Example Formulas

**Holdings - Price (CAD) in cell F2:**
```
=IF(M2="CAD", E2, IF(M2="", E2, E2 * GOOGLEFINANCE("CURRENCY:" & M2 & "CAD")))
```

**Accounts - Balance (CAD) in cell C2:**
```
=IF(D2="CAD", B2, IF(D2="", B2, B2 * GOOGLEFINANCE("CURRENCY:" & D2 & "CAD")))
```

**Account History - Balance (CAD) in cell E2:**
```
=IF(F2="CAD", D2, IF(F2="", D2, D2 * GOOGLEFINANCE("CURRENCY:" & F2 & "CAD")))
```

**Transactions - Amount (CAD) in cell C2:**
```
=IF(D2="CAD", B2, IF(D2="", B2, B2 * GOOGLEFINANCE("CURRENCY:" & D2 & "CAD")))
```

## Benefits

1. **Automatic Updates**: Exchange rates are updated automatically by Google Sheets
2. **Real-time Conversion**: Current market rates are used for conversion
3. **Multi-currency Support**: Works with any currency that GOOGLEFINANCE supports
4. **No Manual Calculation**: Users don't need to manually convert values
5. **Consistent View**: All values can be compared in a single currency (CAD)

## Implementation Notes

- Formulas are added programmatically after data is written to sheets
- All monetary columns are formatted as currency ($#,##0.00)
- If GOOGLEFINANCE cannot find the exchange rate, the cell will show an error
- Exchange rates are real-time and may fluctuate

## Currency Support

GOOGLEFINANCE supports major currencies including:
- USD (US Dollar)
- CAD (Canadian Dollar)
- EUR (Euro)
- GBP (British Pound)
- JPY (Japanese Yen)
- And many more...

For a full list of supported currencies, see: https://www.google.com/finance

## Testing Recommendations

1. Test with accounts containing different currencies (USD, EUR, etc.)
2. Verify CAD-denominated accounts show the same value in both columns
3. Check that formulas update when exchange rates change
4. Ensure empty currency fields are handled gracefully
