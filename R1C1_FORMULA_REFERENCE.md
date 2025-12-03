# R1C1 Formula Reference Documentation

## Overview
The CAD conversion formulas use R1C1 notation for batch insertion, which improves performance significantly compared to individual cell updates.

## R1C1 Notation Explained

R1C1 notation uses relative references:
- `RC[x]` means "same row, column offset by x from current column"
- `RC[-1]` means "same row, previous column"
- `RC[1]` means "same row, next column"

## Formula Breakdown by Sheet

### Holdings Sheet
**Column Structure:**
```
E: Price           F: Price (CAD)
G: Market Value    H: Market Value (CAD)
I: Cost Basis      J: Cost Basis (CAD)
K: Gain/Loss       L: Gain/Loss (CAD)
M: Currency
```

**Formula in Column F (Price CAD):**
```
=IF(RC[7]="CAD", RC[-1], IF(RC[7]="", RC[-1], RC[-1] * GOOGLEFINANCE("CURRENCY:" & RC[7] & "CAD")))
```
- `RC[7]` → Column M (Currency) - 7 columns to the right
- `RC[-1]` → Column E (Price) - 1 column to the left

**Formula in Column H (Market Value CAD):**
```
=IF(RC[5]="CAD", RC[-1], IF(RC[5]="", RC[-1], RC[-1] * GOOGLEFINANCE("CURRENCY:" & RC[5] & "CAD")))
```
- `RC[5]` → Column M (Currency) - 5 columns to the right
- `RC[-1]` → Column G (Market Value) - 1 column to the left

**Formula in Column J (Cost Basis CAD):**
```
=IF(RC[3]="CAD", RC[-1], IF(RC[3]="", RC[-1], RC[-1] * GOOGLEFINANCE("CURRENCY:" & RC[3] & "CAD")))
```
- `RC[3]` → Column M (Currency) - 3 columns to the right
- `RC[-1]` → Column I (Cost Basis) - 1 column to the left

**Formula in Column L (Gain/Loss CAD):**
```
=IF(RC[1]="CAD", RC[-1], IF(RC[1]="", RC[-1], RC[-1] * GOOGLEFINANCE("CURRENCY:" & RC[1] & "CAD")))
```
- `RC[1]` → Column M (Currency) - 1 column to the right
- `RC[-1]` → Column K (Gain/Loss) - 1 column to the left

### Accounts Sheet
**Column Structure:**
```
B: Balance    C: Balance (CAD)    D: Currency
```

**Formula in Column C (Balance CAD):**
```
=IF(RC[1]="CAD", RC[-1], IF(RC[1]="", RC[-1], RC[-1] * GOOGLEFINANCE("CURRENCY:" & RC[1] & "CAD")))
```
- `RC[1]` → Column D (Currency) - 1 column to the right
- `RC[-1]` → Column B (Balance) - 1 column to the left

### Account History Sheet
**Column Structure:**
```
D: Balance    E: Balance (CAD)    F: Currency
```

**Formula in Column E (Balance CAD):**
```
=IF(RC[1]="CAD", RC[-1], IF(RC[1]="", RC[-1], RC[-1] * GOOGLEFINANCE("CURRENCY:" & RC[1] & "CAD")))
```
- `RC[1]` → Column F (Currency) - 1 column to the right
- `RC[-1]` → Column D (Balance) - 1 column to the left

### Transactions Sheet
**Column Structure:**
```
B: Amount    C: Amount (CAD)    D: Currency
```

**Formula in Column C (Amount CAD):**
```
=IF(RC[1]="CAD", RC[-1], IF(RC[1]="", RC[-1], RC[-1] * GOOGLEFINANCE("CURRENCY:" & RC[1] & "CAD")))
```
- `RC[1]` → Column D (Currency) - 1 column to the right
- `RC[-1]` → Column B (Amount) - 1 column to the left

## Formula Logic

All formulas follow the same pattern:
1. Check if currency is CAD → use original value (no conversion)
2. Check if currency is empty → use original value (assume same currency)
3. Otherwise → multiply by GOOGLEFINANCE exchange rate

## Performance Benefits

Using `setFormulasR1C1()` with an array of formulas is much faster than individual `setFormula()` calls:
- **Individual calls**: 100 rows × 4 formulas = 400 API calls
- **Batch operation**: 4 API calls (one per column)
- **Improvement**: ~100x faster for large datasets

## Verification

To verify formulas are working correctly:
1. Check a CAD row - CAD column should equal original value
2. Check a USD row - CAD column should be ~1.35x original (varies by rate)
3. Check an empty currency row - CAD column should equal original value
4. Exchange rates should update automatically

## Error Handling

If GOOGLEFINANCE cannot find an exchange rate:
- Cell will show `#N/A` error
- This typically means the currency code is invalid
- Check the Currency column for typos
