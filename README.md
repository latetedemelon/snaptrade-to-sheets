# SnapTrade Google Sheets Integration

A Google Sheets add-on that connects your brokerage accounts to Google Sheets, enabling automated portfolio tracking, transaction history, and account balance monitoring directly in your spreadsheets.

## What Does It Do?

This integration allows you to:
- **Connect multiple brokerage accounts** from 20+ brokerages (Robinhood, Schwab, Fidelity, E*TRADE, Interactive Brokers, and more)
- **Track your portfolio** with real-time holdings, balances, and account summaries
- **Monitor transactions** with detailed transaction history and categorization
- **Automate data refresh** directly from Google Sheets menus

All data is fetched securely using the SnapTrade API with HMAC-SHA256 authentication, and your credentials are stored safely in Google Apps Script properties.

## Before You Begin: SnapTrade Account and API Credentials

SnapTrade offers a free account that you can use to connect your brokerage accounts and access the API used by this add-on.

Follow these steps to sign up and get your credentials:
- Go to the [SnapTrade website](https://snaptrade.com) and create a free account.
- After signing in, open the SnapTrade Dashboard.
- Navigate to the developer/API section of the dashboard to create an application.
- Copy your Client ID and Consumer Key from the dashboard — you will paste these into the add-on during setup.

Notes:
- You can start on the free tier; it’s sufficient for connecting brokerages and pulling account, holdings, and transactions data.

## Quick Start

### 1. Configure API Keys

1. Get your SnapTrade API credentials from [SnapTrade Dashboard](https://snaptrade.com)
2. Open your Google Sheet
3. Go to **📊 SnapTrade → ⚙️ Settings → Configure API Keys**
4. Enter your Client ID and Consumer Key

### 2. Register User

1. Go to **📊 SnapTrade → ⚙️ Settings → Register User**
2. Enter a unique user ID or let the system generate one
3. Your user credentials will be stored securely

### 3. Connect Brokerage

1. Go to **📊 SnapTrade → 🔗 Connect Brokerage**
2. Click "Open Connection Portal"
3. Select your brokerage and complete the authentication
4. Click "Check Connection Status" to verify the connection

### 4. Refresh Data

Use the menu items to populate your sheets with data:
- **📊 Refresh Accounts** - Creates an Accounts sheet with all connected accounts (shows separate rows for each currency)
- **💰 Refresh Holdings** - Creates a Holdings sheet with your current equity positions
- **🎯 Refresh Options** - Creates an Options sheet with contract-level detail (underlying, type, strike, expiry, multiplier) and CAD values
- **📜 Refresh Transactions** - Creates a Transactions sheet with the full activity ledger (date, type, symbol, units, price, fee, CAD amount)
- **📐 Calculate ACB / Capital Gains** - Builds a CAD Adjusted Cost Base ledger and a capital-gains-by-tax-year summary from your trade history (see [docs/ACB.md](docs/ACB.md))
- **💵 Income & Dividends** - Builds an Income sheet: a CAD-converted ledger of dividends, interest, distributions, and withholding tax, summarized by tax year
- **📈 Track Account History** - Manually track account values over time (also auto-updates when refreshing accounts)

**Note:** Refreshing accounts automatically updates the Account History sheet (once per day).

### 5. Track Account Values Over Time

Account history is tracked automatically when you refresh accounts:
1. Go to **📊 SnapTrade → 📊 Refresh Accounts**
2. The "Account History" sheet updates automatically with current balances
3. Multiple refreshes in the same day update existing rows (no duplicates)
4. Historical data builds up over time for tracking portfolio growth

You can also manually trigger an update via **📊 SnapTrade → 📈 Track Account History**

## Adjusted Cost Base (ACB)

**📐 Calculate ACB / Capital Gains** computes a Canadian-style Adjusted Cost Base in CAD
(using historical, trade-date exchange rates) and a realized-capital-gains summary by tax
year. ACB is a running total from each holding's first purchase, so it is only correct when
your activity history reaches back that far — the tool reconciles against current holdings
and flags symbols with likely gaps, and you can seed earlier positions via an
`ACB Opening Balances` sheet. See **[docs/ACB.md](docs/ACB.md)** for details and a worked
example. This is a calculation aid, not tax advice.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — source layout, data flow, and local
  development with `clasp`
- [docs/ACB.md](docs/ACB.md) — Adjusted Cost Base & capital gains
- [docs/API_REFERENCE.md](docs/API_REFERENCE.md) — SnapTrade endpoints and response shapes
- [docs/SECURITY.md](docs/SECURITY.md) — authentication and credential handling
- [docs/ROADMAP.md](docs/ROADMAP.md) — planned features
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — change history

## Development

This is a container-bound Google Apps Script project. To edit locally with
[clasp](https://github.com/google/clasp):

```bash
npm install -g @google/clasp
clasp login
cp .clasp.json.example .clasp.json   # set "scriptId" to your bound Apps Script project
clasp push                            # pushes .gs / .html / appsscript.json only
```

The script ID is under **Extensions → Apps Script → Project Settings** in your sheet.
