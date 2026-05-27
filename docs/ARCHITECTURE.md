# Architecture

A container-bound **Google Apps Script** add-on (V8 runtime, no external dependencies) that
syncs SnapTrade brokerage data into the active Google Sheet.

## Source layout

| File | Responsibility |
|------|----------------|
| `Code.gs` | Auth (HMAC-SHA256 signing), API requests, parallel fetch, and the Accounts / Holdings / Transactions / Account History refreshers. Defines `onOpen()` (the menu) and `CONFIG`. |
| `ACB.gs` | Adjusted Cost Base & capital-gains calculator (see [ACB.md](ACB.md)). |
| `Income.gs` | Dividend / interest / distribution income tracker with by-year CAD summary. |
| `Options.gs` | Options holdings sheet (contract-level fields, multiplier, CAD values). |
| `Dialogs.gs` | Server-side handlers for the HTML dialogs. |
| `TestValidation.gs` | Manual test/validation functions run from the Apps Script editor. |
| `*.html` | Modal dialogs and the accounts sidebar; call server functions via `google.script.run`. |
| `appsscript.json` | Manifest: runtime, timezone, OAuth scopes. |

## Data flow

```
SnapTrade API                         Google Sheets
  GET /accounts            ─┐
  GET /accounts/{id}/holdings ├─► fetchAccountDataInParallel ─► Accounts / Holdings / History
  GET /activities          ─┘                                 ─► Transactions
                                                              ─► ACB Ledger / Capital Gains
```

- **Auth:** `generateSnapTradeSignature()` signs each request; credentials live in
  Script Properties (app: Client ID / Consumer Key) and User Properties (user ID / secret).
- **Parallelism:** `fetchAccountDataInParallel()` uses `UrlFetchApp.fetchAll()` in batches
  of 50, retrying failed responses once.
- **CAD conversion:** `getCADConversionFormula(currencyOffset, valueOffset)` produces the
  single shared R1C1 `GOOGLEFINANCE` formula used by every sheet.

## Local development with clasp

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json   # then set "scriptId" to your bound project
clasp push                            # only .gs/.html/appsscript.json are pushed (.claspignore)
```

Find the script ID via **Extensions → Apps Script → Project Settings** in the bound sheet.
