# Roadmap

Candidate features and improvements. Priorities are suggestions. Items marked **[in review]**
have an open PR; **[open question]** items need a decision before/while building (see the
**Open questions & decisions** section at the end).

## In review (open PRs, stacked on PR #14)

- **Realized trades / closed-positions ledger** — PR #15 (`Realized.gs`). Round-trip realized
  P/L for equities and options, including option rolls. Open questions: option-assignment
  premium treatment; average-cost vs FIFO — see Q1/Q2 below.
- **Unrealized P/L by symbol** — PR #16 (`Pnl.gs`). Consolidated holdings: market vs book
  value, unrealized $/%, % of portfolio. Mergeable; only LOW nits.
- **Fees & commissions tracker** — PR #17 (`Fees.gs`). Trade vs account fees, CAD by tax year.
  Open question: brokerage-specific fee labels — see Q3 below.

## Features

- **Scheduled auto-refresh** — time-driven triggers to refresh accounts/holdings and append
  account history on a schedule, instead of manual menu clicks. *(On hold by request.)*
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

- **Portfolio dashboard / net-worth overview** *(open question Q5)* — a single summary sheet
  aggregating total value across all accounts and currencies (CAD base), with day / period
  change and the top-level allocation. *(Partially seeded by the Accounts sheet and Account
  History.)*
- **Asset allocation report** *(open question Q4)* — breakdowns by asset class, sector,
  geography, and currency, with pie/donut charts and optional target-vs-actual columns. Needs
  an instrument-metadata source (some fields come from SnapTrade; sector/geo may need a lookup
  table).
- **Unrealized P/L by symbol** — **[in review: PR #16]** consolidate the same symbol across
  accounts: market value vs book value, unrealized gain/loss ($ and %), and % of portfolio.
- **Net-worth over time chart** *(open question Q7)* — turn Account History into a charted
  time series, with optional **manual assets/liabilities** (real estate, crypto wallets,
  loans) so the chart reflects true net worth, not just brokerage value.
- **Dividend/income dashboard** — extend the Income sheet with projected forward annual
  income, yield-on-cost, and a dividend calendar (ex-date / pay-date) per holding.
- **Performance & rate of return** *(open question Q6)* — XIRR (money-weighted) and
  time-weighted returns over standard windows (1M, YTD, 1Y, all), with a **benchmark
  comparison** against an index via GOOGLEFINANCE. *(Overlaps "Portfolio performance" above.)*
- **Fees report** — **[in review: PR #17]** aggregate commissions and fees paid (per account /
  per year).
- **Currency-exposure report** — total exposure by currency and the CAD-equivalent split.
  *(Complements the Forex sheets.)*
- **Daily snapshots** — generalize Account History into snapshots of holdings + balances so
  any past day can be reconstructed (enables true historical performance).
- **Goals / milestones** *(open question Q8)* — track progress toward a target net worth or
  savings goal.
- **Custom classification** *(open question Q4/Q8)* — user-defined tags/asset-classes for
  holdings, used by the allocation report (Wealthica lets users reclassify positions).

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
  sources and runs the logic tests on every push/PR, and `deploy.yml` can `clasp push`
  on demand. Next: mock API responses to cover the refreshers and the sheet-formula output.
- **Formula-level numeric tests** — the ACB and forex running-ACB / realized-gain math lives
  in sheet formulas that `node` cannot evaluate, so those numbers (the most tax-sensitive
  ones) are currently only covered at the record-building layer. Add a pure-JS reference
  implementation of the running ledger to assert the math end-to-end.
- **Approximate CAD cost check** — optionally add an informational column that converts the
  broker's native average cost to CAD at the current rate, clearly labelled approximate, so
  the Cost Check does something for USD holdings (it is currently "n/a" for non-CAD on
  purpose, to avoid historical-vs-spot false mismatches).

## Open questions & decisions (tracking)

Each item lists the **default** currently shipped/assumed and the **options**. Resolved
answers should be recorded inline (date + choice) and the affected feature updated.

### On the in-review PRs

- **Q1 — Realized trades: option-assignment treatment** *(PR #15)*. When a written option is
  assigned, the premium is currently booked as a **standalone option disposition** (default).
  Options: (a) keep standalone (informational, simplest); (b) roll the premium into the
  assigned underlying's cost base / proceeds per CRA treatment (more correct for tax, more
  complex — must link the option leg to the resulting stock trade).
- **Q2 — Realized trades: cost method** *(PR #15)*. Default **average-cost**, matching the ACB
  calculator. Options: (a) average-cost (consistent across the tool); (b) FIFO; (c)
  specific-lot selection. Canada generally requires average-cost (ACB), so (a) is the likely
  keeper — confirm.
- **Q3 — Fees: brokerage-specific labels** *(PR #17)*. `FEE_TYPE_KEYWORDS` matches
  FEE/COMMISSION/CHARGE/WITHDRAWALFEE (substring). Options: (a) leave as-is; (b) extend with
  more terms (ADR fees, regulatory/SEC fees, FX/conversion fees, ECN, interest-as-fee) — needs
  a sample of real activity-type strings from the brokerages in use.

### On held backlog features

- **Q4 — Asset-allocation / classification data source**. Sector / geography / asset-class
  are not reliably in the SnapTrade feed. Options: (a) ship currency + asset-type only (what
  we have); (b) add a user-maintained classification sheet (symbol → class/sector/region) that
  the report joins against; (c) pull from a third-party metadata source (extra dependency,
  network policy). Blocks the Asset-allocation report and Custom classification.
- **Q5 — Portfolio dashboard scope/layout**. Options: (a) single summary tab with headline
  totals (net worth, day/period change, allocation) and no charts; (b) add embedded Sheets
  charts (allocation donut, net-worth line); (c) which headline metrics and periods to show.
- **Q6 — Performance methodology**. Options: (a) XIRR / money-weighted only; (b) time-weighted
  only; (c) both. Plus benchmark choice (e.g., a single index like XEQT/VEQT/SPX via
  GOOGLEFINANCE, user-selectable, or none).
- **Q7 — Manual assets/liabilities**. Do we add a user-input sheet for non-brokerage assets
  (real estate, crypto, cash, loans) so net-worth reflects the full picture? Options: (a) no,
  brokerage-only; (b) yes, simple manual sheet folded into the net-worth chart.
- **Q8 — Goals/milestones & custom classification priority**. Confirm interest and relative
  priority; custom classification (Q4b) is a prerequisite for a meaningful allocation report.
