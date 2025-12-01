/**
 * Core SnapTrade Google Sheets integration logic.
 * Handles authentication, signature generation, API requests, and data import helpers.
 */

/**
 * Generates HMAC-SHA256 signature for SnapTrade API requests.
 * @param {string} consumerKey - SnapTrade consumer key (secret)
 * @param {Object|null} requestBody - Request body object, or null for GET requests
 * @param {string} requestPath - API path (e.g., '/api/v1/accounts')
 * @param {string} queryString - Sorted query string without leading '?'
 * @returns {string} Base64-encoded signature
 */
function generateSnapTradeSignature(consumerKey, requestBody, requestPath, queryString) {
  const sigObject = {
    content: requestBody,
    path: requestPath,
    query: queryString,
  };

  const sigContent = JSON.stringify(sigObject);
  const signatureBytes = Utilities.computeHmacSha256Signature(sigContent, consumerKey);
  return Utilities.base64Encode(signatureBytes);
}

/**
 * Returns core configuration and user credentials from PropertiesService.
 * @returns {{clientId: string, consumerKey: string, userId: string, userSecret: string}}
 */
function getSnapTradeContext() {
  const scriptProps = PropertiesService.getScriptProperties();
  const userProps = PropertiesService.getUserProperties();

  return {
    clientId: scriptProps.getProperty('SNAPTRADE_CLIENT_ID') || '',
    consumerKey: scriptProps.getProperty('SNAPTRADE_CONSUMER_KEY') || '',
    userId: userProps.getProperty('SNAPTRADE_USER_ID') || '',
    userSecret: userProps.getProperty('SNAPTRADE_USER_SECRET') || '',
  };
}

/**
 * Builds a sorted query string from provided parameters.
 * @param {Object} params
 * @returns {string}
 */
function buildSortedQuery(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');
}

/**
 * Makes an authenticated request to the SnapTrade API.
 * @param {string} method - HTTP method (GET, POST, DELETE)
 * @param {string} path - API path starting with /api/v1/
 * @param {Object} additionalParams - Additional query parameters
 * @param {Object|null} body - Request body for POST/PUT
 * @returns {Object} Parsed JSON response
 */
function snapTradeRequest(method, path, additionalParams, body) {
  const context = getSnapTradeContext();
  const timestamp = Math.floor(Date.now() / 1000).toString();

  const params = {
    clientId: context.clientId,
    timestamp: timestamp,
    userId: context.userId,
    userSecret: context.userSecret,
    ...(additionalParams || {}),
  };

  const sortedQuery = buildSortedQuery(params);
  const signature = generateSnapTradeSignature(context.consumerKey, body, path, sortedQuery);

  const options = {
    method: method.toLowerCase(),
    headers: { Signature: signature },
    muteHttpExceptions: true,
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(body);
  }

  const response = UrlFetchApp.fetch(`https://api.snaptrade.com${path}?${sortedQuery}`, options);
  const code = response.getResponseCode();
  const content = response.getContentText();

  if (code >= 200 && code < 300) {
    return JSON.parse(content);
  }

  if (code === 429) {
    throw new Error('Rate limited. Please wait before making more requests.');
  }

  throw new Error(`SnapTrade API Error (${code}): ${content}`);
}

/**
 * Makes a SnapTrade request with exponential backoff retry handling.
 * @param {string} method
 * @param {string} path
 * @param {Object} params
 * @param {Object|null} body
 * @param {number} maxRetries
 * @returns {Object}
 */
function snapTradeRequestWithRetry(method, path, params, body, maxRetries) {
  const retries = typeof maxRetries === 'number' ? maxRetries : 3;
  let delay = 1000;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return snapTradeRequest(method, path, params || {}, body || null);
    } catch (error) {
      const isRateLimited = error.message.includes('429') || error.message.includes('Rate limited');
      const isServerError = error.message.includes('500') || error.message.includes('502');

      if ((isRateLimited || isServerError) && attempt < retries - 1) {
        Logger.log(`Attempt ${attempt + 1} failed. Retrying in ${delay}ms...`);
        Utilities.sleep(delay);
        delay *= 2;
      } else {
        throw error;
      }
    }
  }

  throw new Error('Unexpected error reaching SnapTrade.');
}

/**
 * Registers a new SnapTrade user and stores credentials in User Properties.
 * @param {string} userId
 * @returns {{userId: string, userSecret: string}}
 */
function registerSnapTradeUser(userId) {
  const context = getSnapTradeContext();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const requestPath = '/api/v1/snapTrade/registerUser';
  const queryString = buildSortedQuery({ clientId: context.clientId, timestamp: timestamp });
  const requestBody = { userId: userId };

  const signature = generateSnapTradeSignature(context.consumerKey, requestBody, requestPath, queryString);
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    headers: { Signature: signature },
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(`https://api.snaptrade.com${requestPath}?${queryString}`, options);
  const code = response.getResponseCode();
  const content = response.getContentText();

  if (code === 200) {
    const result = JSON.parse(content);
    PropertiesService.getUserProperties().setProperties({
      SNAPTRADE_USER_ID: result.userId,
      SNAPTRADE_USER_SECRET: result.userSecret,
    });
    return result;
  }

  throw new Error(`Registration failed: ${content}`);
}

/**
 * Generates a SnapTrade Connection Portal URL for brokerage linking.
 * @param {Object} options - Optional filters for broker or redirect.
 * @returns {string} Portal URL
 */
function generateConnectionPortalUrl(options) {
  const context = getSnapTradeContext();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const requestPath = '/api/v1/snapTrade/login';

  const params = new URLSearchParams({
    clientId: context.clientId,
    timestamp: timestamp,
    userId: context.userId,
    userSecret: context.userSecret,
  });

  const sortedQuery = Array.from(params.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  const requestBody = {};
  if (options && options.broker) requestBody.broker = options.broker;
  if (options && options.customRedirect) requestBody.customRedirect = options.customRedirect;
  if (options && options.connectionType) requestBody.connectionType = options.connectionType;

  const bodyToSign = Object.keys(requestBody).length > 0 ? requestBody : null;
  const signature = generateSnapTradeSignature(context.consumerKey, bodyToSign, requestPath, sortedQuery);

  const fetchOptions = {
    method: 'post',
    contentType: 'application/json',
    headers: { Signature: signature },
    muteHttpExceptions: true,
  };

  if (bodyToSign) {
    fetchOptions.payload = JSON.stringify(requestBody);
  }

  const response = UrlFetchApp.fetch(`https://api.snaptrade.com${requestPath}?${sortedQuery}`, fetchOptions);
  const content = response.getContentText();
  const code = response.getResponseCode();

  if (code >= 200 && code < 300) {
    const result = JSON.parse(content);
    return result.redirectURI;
  }

  throw new Error(`Failed to create portal URL: ${content}`);
}

/**
 * Lists accounts for current user.
 * @returns {Array}
 */
function listUserAccounts() {
  const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null);
  return accounts || [];
}

/**
 * Returns data prepared for sidebar rendering.
 * @returns {Array<{name: string, institution: string, balance: number, status: string}>}
 */
function getAccountsForSidebar() {
  const accounts = listUserAccounts();
  return accounts.map((account) => ({
    name: account.name || account.number,
    institution: account.institution_name || 'Unknown',
    balance: (account.balance && account.balance.total && account.balance.total.amount) || 0,
    status: account.sync_status || 'Connected',
  }));
}

/**
 * Fetches brokerages metadata for broker status dialog.
 * @returns {Array}
 */
function getBrokerages() {
  return snapTradeRequest('GET', '/api/v1/brokerages', {}, null);
}

/**
 * Compares account list length to detect new connections.
 * @param {number} previousCount
 * @returns {{newAccounts: number, totalAccounts: number}}
 */
function checkForNewAccounts(previousCount) {
  const accounts = listUserAccounts();
  return {
    newAccounts: accounts.length - previousCount,
    totalAccounts: accounts.length,
  };
}

/**
 * Clears all stored credentials and data sheets.
 */
function clearAllData() {
  PropertiesService.getScriptProperties().deleteAllProperties();
  PropertiesService.getUserProperties().deleteAllProperties();

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const targets = ['Holdings', 'Balances', 'Transactions'];

  targets.forEach((name) => {
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet) {
      spreadsheet.deleteSheet(sheet);
    }
  });
}

/**
 * Fetches holdings for all accounts and writes to sheet.
 */
function refreshHoldings() {
  const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName('Holdings') || spreadsheet.insertSheet('Holdings');

  sheet.clear();
  sheet.appendRow([
    'Account',
    'Symbol',
    'Description',
    'Quantity',
    'Price',
    'Market Value',
    'Cost Basis',
    'Gain/Loss',
    'Currency',
  ]);

  const rows = [];

  accounts.forEach((account) => {
    const holdings = snapTradeRequest('GET', `/api/v1/accounts/${account.id}/holdings`, {}, null);

    if (holdings.positions) {
      holdings.positions.forEach((position) => {
        const symbol = (position.symbol && position.symbol.symbol) || 'N/A';
        const description = (position.symbol && position.symbol.description) || '';
        const units = position.units || 0;
        const price = position.price || 0;
        const marketValue = units * price;
        const costBasis = units * (position.average_purchase_price || 0);

        rows.push([
          account.name || account.number,
          symbol,
          description,
          units,
          price,
          marketValue,
          costBasis,
          marketValue - costBasis,
          (position.currency && position.currency.code) || 'USD',
        ]);
      });
    }
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }

  sheet.getRange(2, 5, Math.max(rows.length, 1), 4).setNumberFormat('$#,##0.00');
  SpreadsheetApp.getUi().alert(`Refreshed ${rows.length} positions from ${accounts.length} accounts.`);
}

/**
 * Creates a balances summary sheet.
 */
function refreshBalances() {
  const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName('Balances') || spreadsheet.insertSheet('Balances');

  sheet.clear();
  sheet.appendRow(['Account', 'Institution', 'Cash', 'Buying Power', 'Total Value', 'Currency']);

  const rows = [];

  accounts.forEach((account) => {
    const balances = snapTradeRequest('GET', `/api/v1/accounts/${account.id}/balances`, {}, null);

    balances.forEach((bal) => {
      rows.push([
        account.name || account.number,
        account.institution_name || '',
        bal.cash || 0,
        bal.buying_power || 0,
        (account.balance && account.balance.total && account.balance.total.amount) || 0,
        (bal.currency && bal.currency.code) || 'USD',
      ]);
    });
  });

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    sheet.getRange(2, 3, rows.length, 3).setNumberFormat('$#,##0.00');
  }
}

/**
 * Fetches transactions for a date range.
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 */
function refreshTransactions(startDate, endDate) {
  const params = {};
  if (startDate) params.startDate = startDate;
  if (endDate) params.endDate = endDate;

  const transactions = snapTradeRequest('GET', '/api/v1/activities', params, null);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName('Transactions') || spreadsheet.insertSheet('Transactions');

  sheet.clear();
  sheet.appendRow([
    'Date',
    'Account',
    'Type',
    'Symbol',
    'Description',
    'Quantity',
    'Price',
    'Amount',
    'Fee',
    'Currency',
  ]);

  const rows = transactions.map((tx) => [
    tx.trade_date || tx.settlement_date,
    (tx.account && (tx.account.name || tx.account.number)) || '',
    tx.type,
    (tx.symbol && tx.symbol.symbol) || '',
    tx.description || '',
    tx.units || '',
    tx.price || '',
    tx.amount || 0,
    tx.fee || 0,
    (tx.currency && tx.currency.code) || 'USD',
  ]);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    sheet.getRange(2, 8, rows.length, 2).setNumberFormat('$#,##0.00');
  }
}

/**
 * Generates a UUID v4-like identifier.
 * @returns {string}
 */
function generateUserId() {
  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return template.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Creates the custom add-on menu.
 * @param {GoogleAppsScript.Events.SheetsOnOpen} e
 */
function onOpen(e) {
  SpreadsheetApp.getUi()
    .createMenu('📊 SnapTrade')
    .addItem('🔗 Connect Brokerage', 'showConnectBrokerageDialog')
    .addItem('📋 View Connected Accounts', 'showAccountsSidebar')
    .addSeparator()
    .addItem('💰 Refresh Holdings', 'refreshHoldings')
    .addItem('💵 Refresh Balances', 'refreshBalances')
    .addItem('📜 Refresh Transactions', 'showTransactionDialog')
    .addSeparator()
    .addSubMenu(
      SpreadsheetApp.getUi()
        .createMenu('⚙️ Settings')
        .addItem('Configure API Keys', 'showApiKeyDialog')
        .addItem('Register User', 'showRegisterDialog')
        .addItem('Broker Capabilities', 'showBrokerStatusDialog')
        .addItem('Help & Docs', 'showHelpDialog')
        .addItem('Clear All Data', 'clearAllData')
    )
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}
