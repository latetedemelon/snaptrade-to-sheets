# Foreign-Exchange Capital Gains (currency as property)

**💱 Forex Gains** (`refreshForex()` in `Forex.gs`) tracks capital gains on foreign currency
itself. The CRA treats foreign currency as property: when you acquire it (proceeds from a
sale, a USD dividend, a deposit, a CAD→USD conversion) it has a CAD cost at that day's rate,
and when you dispose of it (buying a US stock, a USD fee, a withdrawal, a USD→CAD conversion)
you realize an FX capital gain or loss against the currency's running ACB.

It builds two sheets:

- **Forex Ledger** — every non-CAD cash movement, grouped by currency and ordered by date,
  classified as **Acquire** (amount > 0) or **Dispose** (amount < 0), with a running balance,
  running ACB (CAD), ACB per unit, and realized FX gain/loss on each disposition.
- **Forex Gains** — per-currency ACB and realized FX gains, plus a by-tax-year total.

## Method

Per currency, processed chronologically:

- **Acquire `X` units** (CAD value = `X × rate`): balance and total ACB both increase.
- **Dispose `X` units**: realized FX gain = `X × rate − (ACB-per-unit × X)`; total ACB falls
  by `ACB-per-unit × X`; ACB-per-unit is unchanged.

Each row's CAD value uses the GOOGLEFINANCE rate on that date (`historicalCadFxFormula`).

### Worked example (USD)

| Date | Direction | USD | Rate | CAD value | Balance | ACB (CAD) | ACB/unit | Realized |
|------|-----------|----:|-----:|----------:|--------:|----------:|---------:|---------:|
| Jan 10 | Acquire | 1,000 | 1.35 | 1,350 | 1,000 | 1,350 | 1.3500 | — |
| Feb 01 | Dispose |   600 | 1.30 |   780 |   400 |   540 | 1.3500 | **−30.00** |

The Feb disposition: CAD received `600 × 1.30 = 780`; ACB of the USD spent
`1.35 × 600 = 810`; FX loss `780 − 810 = −30`.

## ⚠️ Completeness

This is even more sensitive to history than the security ACB: if the feed misses the inflow
that first brought a currency into the account (often a CAD→USD conversion), dispositions
look like they exceed the balance. The **Status** column on the Forex Gains sheet
**soft-flags** any currency whose first event is a disposition, whose balance goes negative,
or whose ledger balance disagrees with the current cash the brokerage reports. Flags never
block the calculation; they indicate the FX gains for that currency aren't trustworthy until
the missing activity is supplied.

This is a calculation aid, not tax advice.
