# Roadmap

Candidate features and improvements, not yet built. Priorities are suggestions.

## Features

- **Scheduled auto-refresh** — time-driven triggers to refresh accounts/holdings and append
  account history on a schedule, instead of manual menu clicks. *(On hold by request.)*
- **Realized trades / closed positions ledger** — match opening and closing legs from the
  activity feed into round-trip trades showing realized P/L per trade (proceeds − cost − fees)
  and holding period. Covers **options rolls** (a roll is just a close + an open) and equities.
  This is what the current Options sheet does *not* do — it only snapshots open positions and
  their unrealized P/L. See "Closed-trade / options-roll P/L" note below.
- **Year-end tax summaries** — a T5008-style realized-gains report (the Capital Gains sheet
  is the foundation) and T5/T3 income summaries from dividend/interest activity.
- **Portfolio performance** — money-weighted (XIRR) and time-weighted returns from the
  account-history and activity data.
- **Configurable activity-type mapping** — a settings dialog to map a brokerage's activity
  labels to ACB actions, instead of editing `ACB_TYPE_KEYWORDS` in code.
- **Superficial-loss handling** — apply the CRA 30-day rule to flagged losses in the ACB
  ledger (currently out of scope; losses are surfaced but not adjusted).

## Reporting & display (inspired by Wealthica)

Wealthica is a Canadian portfolio dashboard; these are the reporting/display features worth
replicating in a Sheets context, mapped to what SnapTrade data we already pull. Roughly
ordered by value.

- **Portfolio dashboard / net-worth overview** — a single summary sheet aggregating total
  value across all accounts and currencies (CAD base), with day / period change and the
  top-level allocation. *(Partially seeded by the Accounts sheet and Account History.)*
- **Asset allocation report** — breakdowns by asset class, sector, geography, and currency,
  with pie/donut charts and optional target-vs-actual columns. Needs an instrument-metadata
  source (some fields come from SnapTrade; sector/geo may need a lookup table).
- **Unrealized P/L by symbol** — consolidate the same symbol across accounts: market value
  vs book value, unrealized gain/loss ($ and %), and % of portfolio. *(Holdings data is
  already pulled; this is a presentation layer.)*
- **Net-worth over time chart** — turn Account History into a charted time series, with
  optional **manual assets/liabilities** (real estate, crypto wallets, loans) so the chart
  reflects true net worth, not just brokerage value.
- **Dividend/income dashboard** — extend the Income sheet with projected forward annual
  income, yield-on-cost, and a dividend calendar (ex-date / pay-date) per holding.
- **Performance & rate of return** — XIRR (money-weighted) and time-weighted returns over
  standard windows (1M, YTD, 1Y, all), with a **benchmark comparison** against an index via
  GOOGLEFINANCE. *(Overlaps the "Portfolio performance" feature above.)*
- **Fees report** — aggregate commissions and fees paid (per account / per year). *(The
  Transactions ledger now captures a Fee column, so the data is available.)*
- **Currency-exposure report** — total exposure by currency and the CAD-equivalent split.
  *(Complements the Forex sheets.)*
- **Daily snapshots** — generalize Account History into snapshots of holdings + balances so
  any past day can be reconstructed (enables true historical performance).
- **Goals / milestones** — track progress toward a target net worth or savings goal.
- **Custom classification** — user-defined tags/asset-classes for holdings, used by the
  allocation report (Wealthica lets users reclassify positions).

### Closed-trade / options-roll P/L (design note)

The Options sheet today is a snapshot of **open** option positions with unrealized P/L
(market value − cost basis). It does **not** track realized P/L when a contract is closed,
expires, is assigned, or is **rolled** (rolls show up as a close of the old contract plus an
open of the new one). To answer "did this trade/roll make money?", build the realized-trades
ledger above from the activity feed: group buy/sell (and expiry/assignment) legs per option
symbol into round trips, applying the contract multiplier and netting fees. The same engine
handles equities. Tax treatment for options differs from the security ACB calculator, so this
should be its own sheet rather than folded into Capital Gains.

## Code quality

- **Centralized column management** — replace hardcoded column numbers in the refreshers
  with named-constant maps to reduce magic numbers.
- **Shared currency-grouping helper** — `refreshAccounts()` and `updateAccountHistoryOnce()`
  still duplicate the by-currency grouping logic; extract a shared function.
- **Aggregated error reporting** — collect per-account fetch failures and surface a summary
  to the user rather than only logging them.
- **Expanded test coverage** — CI (`.github/workflows/ci.yml`) now syntax-checks the
  sources and runs the ACB logic test on every push/PR, and `deploy.yml` can `clasp push`
  on demand. Next: mock API responses to cover the refreshers and the sheet-formula output.
