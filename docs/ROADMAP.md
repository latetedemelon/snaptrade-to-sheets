# Roadmap

Candidate features and improvements, not yet built. Priorities are suggestions.

## Features

- **Scheduled auto-refresh** — time-driven triggers to refresh accounts/holdings and append
  account history on a schedule, instead of manual menu clicks.
- **Year-end tax summaries** — a T5008-style realized-gains report (the Capital Gains sheet
  is the foundation) and T5/T3 income summaries from dividend/interest activity.
- **Dividend & income tracker** — aggregate cash dividends, interest, and distributions per
  symbol and per year (currently ignored by the ACB calculator).
- **Portfolio performance** — money-weighted (XIRR) and time-weighted returns from the
  account-history and activity data.
- **Configurable activity-type mapping** — a settings dialog to map a brokerage's activity
  labels to ACB actions, instead of editing `ACB_TYPE_KEYWORDS` in code.
- **Superficial-loss handling** — apply the CRA 30-day rule to flagged losses in the ACB
  ledger (currently out of scope; losses are surfaced but not adjusted).

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
