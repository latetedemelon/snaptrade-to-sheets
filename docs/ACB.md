# Adjusted Cost Base (ACB) & Capital Gains

`refreshACB()` (menu: **📊 SnapTrade → 📐 Calculate ACB / Capital Gains**) reads your full
SnapTrade activity history and builds two sheets:

- **ACB Ledger** — one row per buy, sell, or return-of-capital, grouped by symbol and
  ordered by trade date, with a running cost base and per-sale realized gain/loss.
- **Capital Gains** — per-symbol current ACB plus realized gains broken down by tax year.

ACB is tracked in **CAD**, the basis the CRA requires. Each transaction is converted at the
`GOOGLEFINANCE` exchange rate **on its own trade date** (not today's rate). The conversion
and all running totals are written as live cell formulas, so the numbers stay auditable and
recalculate automatically.

## How the calculation works

Per symbol, pooled across all accounts (the CRA identical-property rule), processed
chronologically:

- **Buy / reinvested distribution (DRIP):** total ACB increases by `units × price + fee`
  (converted to CAD); unit count increases.
- **Sell:** realized gain = `proceeds − (ACB-per-unit × units sold)`, where
  `proceeds = units × price − fee` (in CAD). Total ACB is reduced by the ACB of the units
  sold; **ACB-per-unit is unchanged** by a sale.
- **Return of capital (ROC):** total ACB is reduced by the distribution amount; unit count
  is unchanged.

### Worked example (a CAD-listed security, so FX = 1)

| Event | Units | Price | Fee | Running units | Running ACB | ACB/unit | Realized gain |
|-------|------:|------:|----:|--------------:|------------:|---------:|--------------:|
| Buy   | 100   | 10.00 | 5   | 100 | 1,005.00 | 10.0500 | — |
| Buy   | 50    | 12.00 | 0   | 150 | 1,605.00 | 10.7000 | — |
| Sell  | 80    | 15.00 | 5   | 70  |   749.00 | 10.7000 | **+339.00** |

Sell math: proceeds `80×15 − 5 = 1,195`; ACB of units sold `10.70 × 80 = 856`;
gain `1,195 − 856 = 339`; remaining ACB `1,605 − 856 = 749`.

## Activity-type mapping

Activities are classified by keyword in `ACB.gs` (`ACB_TYPE_KEYWORDS`). Defaults:

- **Buy:** `BUY`, `REINVEST`, `DRIP`, or a `DIVIDEND` that delivered shares.
- **Sell:** `SELL`.
- **Return of capital:** `RETURNOFCAPITAL`, `RETURN OF CAPITAL`, `ROC`.
- Everything else (cash dividends, interest, contributions, fees, transfers) and all
  **options** activity is ignored for ACB.

If your brokerage labels activities differently, edit `ACB_TYPE_KEYWORDS`.

## ⚠️ Completeness: ACB depends on having the full history

ACB is a running total from each security's **first** purchase. It is only correct when the
activity feed reaches back to that purchase. SnapTrade/brokerage activity sync depth varies,
so a security bought before the available window will start from a cost base of zero — a
silently wrong result. The calculator guards against this in three ways:

1. **Widest possible request.** History is requested from `1990-01-01` to today, so the API
   returns everything it has.
2. **Reconciliation + flags.** After building the ledger, the final share count for each
   symbol is compared against the units the brokerage currently reports (from the holdings
   endpoint). The **Status** column on the Capital Gains sheet flags any symbol where:
   - the ledger's units disagree with current holdings,
   - a sale appears before any buy, or
   - running units ever go negative.
   A flag means earlier activity is probably missing and the ACB for that symbol is not
   trustworthy.
3. **Opening balances (the fix).** Create a sheet named **`ACB Opening Balances`** to seed
   cost base that predates the window. Columns:

   | Symbol | As-of Date | Units | Total ACB (CAD) |
   |--------|-----------|------:|----------------:|
   | XEQT   | 2019-06-01 | 200  | 5,400.00 |

   These rows are applied before the fetched activity, so the running ACB starts from the
   correct opening position. Pull the opening figures from your last broker statement or
   prior year's tax records.

## Caveats

- This is a calculation aid, **not tax advice**. The CRA **superficial-loss** rule (losses
  on repurchases within 30 days) is **not** applied — review flagged losses yourself.
- `GOOGLEFINANCE` historical FX can occasionally return `#N/A` for thin currencies or very
  old dates; the FX cell falls back to the current rate, then to `1`. Spot-check the
  `FX→CAD` column.
- Verify the running totals against a known position before relying on the numbers.
