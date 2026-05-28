# Installation Guide

This guide walks you through installing the SnapTrade → Google Sheets integration into your
own Google Sheet, from zero to refreshing live data. Budget about 10–15 minutes.

If you just want the short version, the [README Quick Start](../README.md#quick-start) covers
the in-sheet configuration steps; this guide adds the full install (getting the code into
Apps Script) and authorization details.

---

## 1. What you'll end up with

A normal Google Sheet with an extra **📊 SnapTrade** menu. From that menu you connect your
brokerage(s) once, then click items like *Refresh Accounts*, *Refresh Holdings*, or
*Calculate ACB / Capital Gains* to pull your data into sheets. Everything runs inside your own
Google account using [Google Apps Script](https://developers.google.com/apps-script); there is
no external server.

## 2. Prerequisites

- A **Google account** (to create a Google Sheet).
- A **SnapTrade account** with API credentials — a **Client ID** and a **Consumer Key**. The
  free tier is enough to connect brokerages and pull accounts, holdings, and transactions.
- Either a willingness to **copy a handful of files** into the Apps Script editor (Method A,
  no tools required), or **Node.js + `clasp`** if you prefer a command-line install (Method B).

## 3. Get your SnapTrade API credentials

1. Create a free account at [snaptrade.com](https://snaptrade.com) and sign in.
2. Open the **Dashboard** and go to the developer / API section.
3. Create an application. Copy its **Client ID** and **Consumer Key** — you'll paste these into
   the sheet later. Treat the Consumer Key like a password.

> The Client ID and Consumer Key identify *your application* to SnapTrade. Each end user you
> connect later gets their own separate User ID / User Secret, created in step 6.

## 4. Install the script into a Google Sheet

Pick **one** method.

### Method A — Copy into the Apps Script editor (recommended, no tools)

1. Create a new Google Sheet (or open the one you want to use).
2. In the menu bar choose **Extensions → Apps Script**. A bound Apps Script project opens in a
   new tab.
3. The editor starts with a single `Code.gs` containing an empty `myFunction`. You'll replace
   it and add the rest of the files.
4. For each **`.gs`** file in the repository, create a matching **Script** file in the editor
   and paste its full contents:
   - `Code.gs` (replace the default file's contents)
   - `ACB.gs`, `Dialogs.gs`, `Forex.gs`, `Income.gs`, `Options.gs`, `Realized.gs`
   - `TestValidation.gs` *(optional — only needed if you want to run the built-in tests)*

   To add a file: click the **+** next to *Files* → **Script**, type the name **without** the
   `.gs` extension (the editor adds it), then paste.
5. For each **`.html`** file in the repository, create a matching **HTML** file (**+** → *HTML*)
   and paste its contents:
   - `AccountsSidebar.html`, `ApiKeyDialog.html`, `BrokerStatusDialog.html`,
     `ConnectBrokerageDialog.html`, `HelpDialog.html`, `RegisterDialog.html`,
     `TransactionDialog.html`
6. Update the manifest so the OAuth scopes and timezone are correct:
   - Click the gear **⚙️ Project Settings** and tick **"Show `appsscript.json` manifest file in
     the editor."**
   - Open the now-visible `appsscript.json` and replace its contents with the repo's
     `appsscript.json`.
7. Click **Save** (💾). Switch back to the spreadsheet tab and **reload the page**. After a few
   seconds a **📊 SnapTrade** menu appears. Continue to [step 5](#5-authorize-the-script).

### Method B — Push with `clasp` (command line)

1. Install [clasp](https://github.com/google/clasp) and log in:
   ```bash
   npm install -g @google/clasp
   clasp login
   ```
   (On a server / cloud VM with no browser, use `clasp login --no-localhost` — see
   [headless login](#clasp-login-on-a-headless-or-remote-machine-no-browser) below.)
2. Get the **Script ID** of your sheet's bound project: in the sheet, **Extensions → Apps
   Script → ⚙️ Project Settings → Script ID**. (If the sheet has no script yet, open
   **Extensions → Apps Script** once to create the bound project.)
3. Clone this repository and point `clasp` at your project:
   ```bash
   git clone https://github.com/latetedemelon/snaptrade-to-sheets.git
   cd snaptrade-to-sheets
   cp .clasp.json.example .clasp.json
   # edit .clasp.json and set "scriptId" to the Script ID from step 2
   clasp push          # uploads the .gs / .html files and appsscript.json
   ```
4. Reload the spreadsheet; the **📊 SnapTrade** menu appears.

> `clasp push` only uploads source (`.gs`, `.html`, `appsscript.json`); it never touches your
> credentials, which live in Apps Script *properties*, not in the code.

#### `clasp login` on a headless or remote machine (no browser)

If you're installing from a server, container, or cloud VM (e.g. a GCloud instance over SSH),
`clasp login` can't open a browser for the Google OAuth flow. Use the no-localhost flow and
make sure the API is enabled:

1. **Enable the Apps Script API** for the Google account you'll log in as:
   <https://script.google.com/home/usersettings> → turn **Google Apps Script API** **on**.
   (Without this, login may appear to work but `push`/`pull` fail with 403.)
2. Log in with the flag that prints a URL instead of opening a browser:
   ```bash
   clasp login --no-localhost
   ```
   Open the printed URL **in a browser on your own computer**, approve access, then paste the
   resulting code back into the terminal.

**Troubleshooting `clasp login`:**

- **`Unexpected end of JSON input`** — clasp is reading an empty or corrupted **global**
  credentials file. Note that clasp keeps login credentials in `~/.clasprc.json` (your home
  directory), which is *different* from the per-project `./.clasp.json` (which only holds the
  `scriptId`). Delete the global file and log in again:
  ```bash
  rm -f ~/.clasprc.json        # Windows: del %USERPROFILE%\.clasprc.json
  clasp login --no-localhost
  ```
  If it persists, find and remove any zero-byte clasp config:
  ```bash
  find ~ . -maxdepth 3 \( -name '.clasprc.json' -o -name '.clasp.json' \) -size 0 2>/dev/null
  ```
- **`invalid_grant` / "you're logged in but `push` fails"** — same fix: remove
  `~/.clasprc.json` and re-run `clasp login`.
- **Access blocked / `invalid_request` in the browser** — the Apps Script API (step 1) isn't
  enabled for that account, or you approved with a different account than the one that owns the
  sheet. Re-check step 1 and log in with the sheet's owner account.

> Pushing a **container-bound** Sheets script from a headless box is the most finicky path. If
> the OAuth flow keeps fighting you, **[Method A](#method-a--copy-into-the-apps-script-editor-recommended-no-tools)**
> (copy-paste into the Apps Script editor) needs no `clasp`, no login, and no API toggle — it's
> the faster way to just get the tool running.


## 5. Authorize the script

The first time you click a **📊 SnapTrade** menu item, Google asks you to authorize the script.

1. Click any menu item (e.g. **⚙️ Settings → Configure API Keys**).
2. In the consent dialog, choose your Google account.
3. Because this is your own unpublished script, Google shows an **"unverified app"** notice.
   Click **Advanced → Go to *(project name)* (unsafe)** to proceed — "unsafe" here just means
   Google hasn't reviewed your personal script; the code is the files you just installed.
4. Review and **Allow** the requested permissions. The script requests only:
   - **See, edit, create, and delete only *this* spreadsheet** (`spreadsheets.currentonly`) —
     it cannot touch your other files.
   - **Connect to an external service** (`script.external_request`) — to call the SnapTrade API.
   - **Display and run third-party web content in dialogs** (`script.container.ui`) — for the
     connection/setup pop-ups.

See [SECURITY.md](SECURITY.md) for how credentials are stored and used.

## 6. Configure, register, and connect

Now do the in-sheet setup (same as the README Quick Start):

1. **Configure API Keys** — **📊 SnapTrade → ⚙️ Settings → Configure API Keys**, then paste your
   SnapTrade **Client ID** and **Consumer Key** from step 3.
2. **Register User** — **⚙️ Settings → Register User**. Enter a unique user ID or let it
   generate one. This creates and stores your SnapTrade User ID / User Secret.
3. **Connect Brokerage** — **📊 SnapTrade → 🔗 Connect Brokerage → Open Connection Portal**,
   pick your brokerage, and complete its login. Then **Check Connection Status** to confirm.

## 7. First data refresh & verification

From the **📊 SnapTrade** menu, run **📊 Refresh Accounts**. You should see an "Accounts" sheet
populate with your connected accounts and balances, and an alert summarizing how many were
refreshed. From there, try **💰 Refresh Holdings** and **📜 Refresh Transactions**.

If a refresh errors or looks wrong, enable **⚙️ Settings → 🐞 Toggle Debug Mode**, re-run it,
then open **🐞 View Debug Log** — see [Troubleshooting](#10-troubleshooting).

The full menu rundown (Options, ACB / Capital Gains, Income & Dividends, Forex Gains, Realized
Trades, Account History) is in the [README](../README.md#4-refresh-data).

## 8. A note on timezone

The manifest sets the script timezone to **America/Toronto** (this is a Canada-focused tax
tool). The timezone affects how dates are bucketed into tax years. To change it, edit
`appsscript.json` (`"timeZone"`) or set it under **Apps Script → Project Settings → Time zone**,
and ideally match your spreadsheet's locale (**File → Settings** in the sheet).

## 9. Updating to a newer version

- **Method A:** re-open **Extensions → Apps Script** and paste the updated contents over each
  changed file (and the manifest if it changed). Save and reload the sheet.
- **Method B:** `git pull` then `clasp push`.

Updating code never affects your stored credentials or your existing data sheets.

## 10. Troubleshooting

- **No 📊 SnapTrade menu after install** — reload the spreadsheet; ensure `Code.gs` was saved
  (it defines `onOpen`). If it still doesn't appear, open the Apps Script editor, select the
  `onOpen` function, and click **Run** once to trigger authorization.
- **"API credentials are not configured" / "user is not registered"** — complete step 6 in
  order (keys → register → connect).
- **A refresh fails or numbers look off** — turn on **🐞 Toggle Debug Mode**, reproduce, then
  read the **Debug Log** sheet (records API calls, statuses, counts, and errors). Credentials
  and request values are never logged. Turn debug off when done.
- More detail in the [README Troubleshooting section](../README.md#troubleshooting).

## 11. Uninstalling / clearing data

- To wipe stored credentials and the data sheets created by the tool, use **⚙️ Settings →
  Clear All Data**.
- To remove the integration entirely, delete the bound script in **Extensions → Apps Script**
  (or just delete the spreadsheet). You may also revoke the script's access at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions), and disconnect
  brokerages from your SnapTrade dashboard.

---

This is a personal-use integration and a calculation aid, not tax or investment advice.
