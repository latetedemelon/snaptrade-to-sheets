/**
 * Core SnapTrade Google Sheets integration logic.
 * Handles authentication, signature generation, API requests, and data import helpers.
 */

/**
 * Application constants and configuration
 */
const CONFIG = {
  SHEETS: {
    CURRENCY_FORMAT: '$#,##0.00',
    DATE_FORMAT: 'yyyy-mm-dd',
    TIMESTAMP_FORMAT: 'yyyy-mm-dd HH:mm:ss',
    COLUMNS: {
      ACCOUNTS: {
        CURRENCY_COLS: [4, 5, 6, 8], // Cash, Holdings Value, Total Value, Total (CAD)
      },
      HISTORY: {
        CURRENCY_COLS: [4, 5, 6, 8], // Cash, Holdings Value, Total Value, Total (CAD)
      }
    }
  },
  API: {
    MAX_RETRIES: 3,
    INITIAL_RETRY_DELAY_MS: 1000,
    BASE_URL: 'https://api.snaptrade.com',
  },
  VALIDATION: {
    MIN_CLIENT_ID_LENGTH: 10,
    MIN_CONSUMER_KEY_LENGTH: 20,
  },
  CACHE: {
    SIDEBAR_TTL_SECONDS: 300, // 5 minutes
  },
  HISTORY: {
    DATA_RETENTION_DAYS: 90,
  }
};

/**
 * Generates HMAC-SHA256 signature for SnapTrade API requests.
 * @param {string} consumerKey - SnapTrade consumer key (secret)
 * @param {Object|null} requestBody - Request body object, or null for GET requests
 * @param {string} requestPath - API path (e.g., '/api/v1/accounts')
 * @param {string} queryString - Sorted query string without leading '?'
 * @returns {string} Base64-encoded signature
 */
function generateSnapTradeSignature(consumerKey, requestBody, requestPath, queryString) {
  if (!consumerKey) {
    throw new Error('Consumer Key is not configured. Please configure your API keys via SnapTrade → Settings → Configure API Keys.');
  }
  
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
 * Parses a JSON response body, raising a clear error when the body is not JSON
 * (e.g. an HTML error page) instead of throwing an opaque SyntaxError.
 * @param {string} content - Raw response body
 * @param {string} context - Short label describing the call site, used in the error
 * @returns {Object} Parsed JSON
 */
function safeJsonParse(content, context) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const preview = (content || '').toString().trim().substring(0, 200);
    throw new Error(`${context}: SnapTrade returned a non-JSON response. Body began with: ${preview}`);
  }
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
  
  // Validate that required credentials are configured
  if (!context.clientId || !context.consumerKey) {
    throw new Error('SnapTrade API credentials are not configured. Please configure your API keys via SnapTrade → Settings → Configure API Keys.');
  }
  if (!context.userId || !context.userSecret) {
    throw new Error('SnapTrade user is not registered. Please register a user via SnapTrade → Settings → Register User.');
  }
  
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

  const startMs = Date.now();
  // Log endpoint + param keys only (never values) so secrets are not written to the log.
  debugLog('snapTradeRequest', `→ ${method} ${path}`, Object.keys(additionalParams || {}));

  const response = UrlFetchApp.fetch(`https://api.snaptrade.com${path}?${sortedQuery}`, options);
  const code = response.getResponseCode();
  const content = response.getContentText();
  debugLog('snapTradeRequest', `← ${method} ${path} ${code} in ${Date.now() - startMs}ms (${content.length} bytes)`);

  if (code >= 200 && code < 300) {
    return safeJsonParse(content, `SnapTrade ${method} ${path}`);
  }

  if (code === 429) {
    debugLog('snapTradeRequest', `rate limited on ${method} ${path}`);
    throw new Error('Rate limited. Please wait before making more requests.');
  }

  debugLog('snapTradeRequest', `error ${code} on ${method} ${path}`, content.substring(0, 500));
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
        debugLog('snapTradeRequestWithRetry', `attempt ${attempt + 1} failed, retrying in ${delay}ms`, error.message);
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
 * Fetches data from multiple accounts in parallel using UrlFetchApp.fetchAll().
 * 
 * CURRENT LIMITATIONS:
 * - UrlFetchApp.fetchAll() has a maximum of 100 requests per batch
 * - Google Apps Script has a 6-minute execution limit
 * 
 * FUTURE ENHANCEMENT: For users with 50+ accounts, implement batch processing
 * by splitting requests into batches of 50 each to stay well under the 100 limit
 * and provide better error recovery.
 * 
 * @param {Array} accounts - Array of account objects from SnapTrade API
 * @param {string} endpointSuffix - Endpoint suffix (e.g., 'holdings', 'balances')
 * @returns {Object} Map of accountId to response data
 */
function fetchAccountDataInParallel(accounts, endpointSuffix) {
  if (!accounts || accounts.length === 0) {
    return {};
  }
  debugLog('fetchAccountDataInParallel', `fetching "${endpointSuffix}" for ${accounts.length} account(s)`);
  
  const context = getSnapTradeContext();

  // UrlFetchApp.fetchAll() caps at 100 requests per call. Stay well under that with
  // batches of 50 so large account sets (and better error isolation) are handled.
  const BATCH_SIZE = 50;
  const resultMap = {};

  // Builds a signed request object for one account. A fresh timestamp is generated
  // per call so retries are not rejected for clock skew.
  const buildRequest = (account) => {
    const path = `/api/v1/accounts/${account.id}/${endpointSuffix}`;
    const params = {
      clientId: context.clientId,
      timestamp: Math.floor(Date.now() / 1000).toString(),
      userId: context.userId,
      userSecret: context.userSecret,
    };
    const sortedQuery = buildSortedQuery(params);
    const signature = generateSnapTradeSignature(context.consumerKey, null, path, sortedQuery);
    return {
      url: `https://api.snaptrade.com${path}?${sortedQuery}`,
      method: 'get',
      headers: { Signature: signature },
      muteHttpExceptions: true,
    };
  };

  // Processes a batch of accounts and returns the accounts whose fetch failed.
  const runBatch = (batch) => {
    const responses = UrlFetchApp.fetchAll(batch.map(buildRequest));
    const failed = [];

    responses.forEach((response, index) => {
      const account = batch[index];
      if (!account) return;

      const code = response.getResponseCode();
      const content = response.getContentText();

      if (code >= 200 && code < 300) {
        try {
          resultMap[account.id] = safeJsonParse(content, `${endpointSuffix} for account ${account.id}`);
        } catch (error) {
          debugLog('fetchAccountDataInParallel', `parse error for account ${account.id}`, error.message);
          failed.push(account);
        }
      } else {
        debugLog('fetchAccountDataInParallel', `HTTP ${code} for account ${account.id} (${endpointSuffix})`, content.substring(0, 500));
        failed.push(account);
      }
    });

    return failed;
  };

  for (let start = 0; start < accounts.length; start += BATCH_SIZE) {
    const batch = accounts.slice(start, start + BATCH_SIZE);
    debugLog('fetchAccountDataInParallel', `executing batch of ${batch.length} request(s)`);

    const failed = runBatch(batch);

    // Retry failed accounts once before marking them unavailable.
    if (failed.length > 0) {
      debugLog('fetchAccountDataInParallel', `retrying ${failed.length} failed account(s)`);
      Utilities.sleep(CONFIG.API.INITIAL_RETRY_DELAY_MS);
      const stillFailed = runBatch(failed);
      stillFailed.forEach((account) => {
        resultMap[account.id] = null;
      });
    }
  }

  debugLog('fetchAccountDataInParallel', `completed: ${Object.keys(resultMap).length} of ${accounts.length} account(s) returned data`);
  return resultMap;
}

/**
 * Validates user ID format
 * @param {string} userId
 * @returns {string} Trimmed and validated user ID
 * @throws {Error} If validation fails
 */
function validateUserId(userId) {
  if (!userId || typeof userId !== 'string') {
    throw new Error('User ID must be a non-empty string');
  }
  
  const trimmed = userId.trim();
  
  if (trimmed.length === 0) {
    throw new Error('User ID cannot be empty');
  }
  
  if (trimmed.length > 255) {
    throw new Error('User ID cannot exceed 255 characters');
  }
  
  return trimmed;
}

/**
 * Validates date format (YYYY-MM-DD)
 * @param {string} dateStr
 * @returns {string} Validated date string
 * @throws {Error} If validation fails
 */
function validateDateFormat(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    throw new Error('Date must be a non-empty string');
  }
  
  const iso8601Pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso8601Pattern.test(dateStr)) {
    throw new Error(`Invalid date format: "${dateStr}". Expected YYYY-MM-DD`);
  }
  
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: "${dateStr}"`);
  }
  
  return dateStr;
}

/**
 * Validates API credentials
 * @param {string} clientId
 * @param {string} consumerKey
 * @throws {Error} If validation fails
 */
function validateApiCredentials(clientId, consumerKey) {
  if (!clientId || typeof clientId !== 'string' || clientId.trim().length === 0) {
    throw new Error('Client ID is required and must be a non-empty string');
  }
  
  if (!consumerKey || typeof consumerKey !== 'string' || consumerKey.trim().length === 0) {
    throw new Error('Consumer Key is required and must be a non-empty string');
  }
  
  if (clientId.trim().length < CONFIG.VALIDATION.MIN_CLIENT_ID_LENGTH) {
    throw new Error('Client ID appears to be too short. Please check your credentials.');
  }
  
  if (consumerKey.trim().length < CONFIG.VALIDATION.MIN_CONSUMER_KEY_LENGTH) {
    throw new Error('Consumer Key appears to be too short. Please check your credentials.');
  }
}

/**
 * Registers a new SnapTrade user and stores credentials in User Properties.
 * @param {string} userId
 * @returns {{userId: string, userSecret: string}}
 */
function registerSnapTradeUser(userId) {
  const validatedUserId = validateUserId(userId);
  const context = getSnapTradeContext();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const requestPath = '/api/v1/snapTrade/registerUser';
  const queryString = buildSortedQuery({ clientId: context.clientId, timestamp: timestamp });
  const requestBody = { userId: validatedUserId };

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
    const result = safeJsonParse(content, 'registerSnapTradeUser');
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

  const params = {
    clientId: context.clientId,
    timestamp: timestamp,
    userId: context.userId,
    userSecret: context.userSecret,
  };

  const sortedQuery = buildSortedQuery(params);

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
    const result = safeJsonParse(content, 'generateConnectionPortalUrl');
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
 * Generates an R1C1 CAD-conversion formula for use in sheets.
 * Multiplies a value cell by the live GOOGLEFINANCE rate from its currency to CAD,
 * passing the value through unchanged when the currency is CAD or blank.
 * Defaults (currency at RC[-1], value at RC[-2]) match the Accounts/History layout.
 * @param {number} [currencyOffset=-1] - Column offset to the currency-code cell
 * @param {number} [valueOffset=-2] - Column offset to the value cell to convert
 * @returns {string} R1C1 formula for CAD conversion
 */
function getCADConversionFormula(currencyOffset, valueOffset) {
  const cur = `RC[${currencyOffset === undefined ? -1 : currencyOffset}]`;
  const val = `RC[${valueOffset === undefined ? -2 : valueOffset}]`;
  return `=IF(${cur}="CAD", ${val}, IF(${cur}="", ${val}, ${val} * GOOGLEFINANCE("CURRENCY:" & ${cur} & "CAD")))`;
}

/**
 * Shows a temporary toast notification
 * @param {string} message
 * @param {string} title
 * @param {number} timeoutSeconds - -1 for persistent
 */
function showToast(message, title, timeoutSeconds) {
  title = title || 'SnapTrade';
  timeoutSeconds = timeoutSeconds !== undefined ? timeoutSeconds : 3;
  SpreadsheetApp.getActiveSpreadsheet().toast(message, title, timeoutSeconds);
}

/**
 * Clears any showing toast by showing an empty toast with 0 timeout
 */
function clearToast() {
  SpreadsheetApp.getActiveSpreadsheet().toast('', '', 0);
}


/**
 * Creates a default account row with zero values when holdings data is unavailable or empty.
 * @param {Object} account - Account object
 * @param {Object} options - Options object with timestamp flag
 * @returns {Array} Row data array
 */
function createDefaultAccountRow(account, options = {}) {
  const { timestamp } = options;
  
  // For history sheet: [timestamp, accountName, accountId, cash, holdingsValue, totalValue, currency, totalCAD, institution]
  if (timestamp) {
    return [
      timestamp,
      account.name || account.number,
      account.id || '',
      0, // Cash
      0, // Holdings Value
      0, // Total Value
      'USD',
      '', // Total (CAD)
      account.institution_name || '',
    ];
  }
  
  // For accounts sheet: [institution, accountName, accountId, cash, holdingsValue, totalValue, currency, totalCAD, buyingPower, balanceCheck, lastUpdate, rawData]
  return [
    account.institution_name || '',
    account.name || account.number,
    account.id || '',
    0, // Cash
    0, // Holdings Value
    0, // Total Value
    'USD',
    '', // Total (CAD)
    '', // Buying Power
    '', // Balance Check
    (account.sync_status && account.sync_status.holdings && account.sync_status.holdings.last_successful_sync) || '',
    JSON.stringify(account),
  ];
}

/**
 * Cross-checks the cash we derived from the holdings endpoint against the authoritative
 * cash from the /balances endpoint. This is a soft check: it never blocks a refresh. On a
 * conflict it surfaces the canonical /balances figure and a small warning that the
 * discrepancy is likely a bug in this tool, not bad data.
 * @param {number} derivedCash - Cash computed from holdings.balances
 * @param {?{cash: number, buyingPower: number}} authoritative - From the /balances endpoint
 * @returns {string}
 */
function computeBalanceCheck(derivedCash, authoritative) {
  if (!authoritative) return 'No /balances data';
  const diff = Math.abs(derivedCash - authoritative.cash);
  if (diff <= CASH_RECONCILE_TOLERANCE) return 'OK';
  return `⚠ Trust /balances ${authoritative.cash.toFixed(2)} (derived ${derivedCash.toFixed(2)}) — likely a spreadsheet bug`;
}

/**
 * Calculates balance by currency from holdings data.
 * @param {Object} holdings - Holdings object from API
 * @returns {Object} Map of currency code to {cash, holdingsValue}
 */
function calculateBalanceByCurrency(holdings) {
  const byCurrency = {};
  
  if (!holdings) return byCurrency;
  
  // Add cash balances
  // Try both 'account_balances' and 'balances' field names for backward compatibility
  // The SnapTrade API uses 'balances', but we check both to handle potential variations
  const balancesArray = holdings.account_balances || holdings.balances;
  
  if (balancesArray && Array.isArray(balancesArray)) {
    balancesArray.forEach((balance) => {
      const currencyCode = (balance.currency && balance.currency.code) || 'USD';
      if (!byCurrency[currencyCode]) {
        byCurrency[currencyCode] = { cash: 0, holdingsValue: 0 };
      }
      
      // Get cash amount (with fallbacks for API variations)
      const cashAmount = balance.cash || balance.total || balance.available || 0;
      byCurrency[currencyCode].cash += cashAmount;
    });
  }
  
  // Add holdings value
  if (holdings.positions) {
    holdings.positions.forEach((position) => {
      const currencyCode = (position.currency && position.currency.code) || 'USD';
      if (!byCurrency[currencyCode]) {
        byCurrency[currencyCode] = { cash: 0, holdingsValue: 0 };
      }
      const units = position.units || 0;
      const price = position.price || 0;
      byCurrency[currencyCode].holdingsValue += units * price;
    });
  }
  
  return byCurrency;
}

/**
 * Builds a currency->{cash, buyingPower} map from a /balances endpoint response (a flat
 * array of balance objects). Used to cross-check the cash we derive from the holdings
 * endpoint and to surface margin buying power.
 * @param {Array} balancesArray - Response from /accounts/{id}/balances
 * @returns {Object} map of currency code to {cash, buyingPower}
 */
function extractBalancesByCurrency(balancesArray) {
  const byCurrency = {};
  if (!Array.isArray(balancesArray)) return byCurrency;
  balancesArray.forEach((balance) => {
    const code = (balance.currency && balance.currency.code) || 'USD';
    if (!byCurrency[code]) byCurrency[code] = { cash: 0, buyingPower: 0 };
    // Prefer cash, then total, then available — but only fall back when the field is truly
    // absent. A legitimate cash balance of 0 must not be replaced by total/available.
    let cash = 0;
    if (balance.cash != null) cash = balance.cash;
    else if (balance.total != null) cash = balance.total;
    else if (balance.available != null) cash = balance.available;
    byCurrency[code].cash += cash;
    // Take the reported buying power (don't sum across balance objects, which would double it).
    if (balance.buying_power != null) byCurrency[code].buyingPower = balance.buying_power;
  });
  return byCurrency;
}

/** Cents-level tolerance for cross-checking cash figures (interest/rounding cause sub-cent drift). */
const CASH_RECONCILE_TOLERANCE = 0.01;

/**
 * Calculates total balance across all currencies from holdings data.
 * @param {Object} holdings - Holdings object from API
 * @returns {number} Total balance
 */
function calculateTotalBalance(holdings) {
  const byCurrency = calculateBalanceByCurrency(holdings);
  
  let total = 0;
  Object.keys(byCurrency).forEach((currency) => {
    total += byCurrency[currency].cash + byCurrency[currency].holdingsValue;
  });
  
  return total;
}

/**
 * Returns data prepared for sidebar rendering.
 * @returns {Array<{name: string, institution: string, balance: number, status: string}>}
 */
function getAccountsForSidebar() {
  try {
    // Try cache first
    const cache = CacheService.getUserCache();
    const cacheKey = 'sidebar_accounts_v1';
    const cached = cache.get(cacheKey);
    
    if (cached) {
      Logger.log('Returning cached sidebar data');
      return JSON.parse(cached);
    }
    
    Logger.log('Fetching fresh sidebar data');
    const accounts = listUserAccounts();
    
    // Fetch holdings for all accounts in parallel to get accurate balance data
    const holdingsMap = fetchAccountDataInParallel(accounts, 'holdings');
    
    const result = accounts.map((account) => {
      // Extract meaningful status from sync_status object
      let status = 'Connected';
      if (account.sync_status) {
        if (account.sync_status.holdings && account.sync_status.holdings.status) {
          status = account.sync_status.holdings.status;
        } else if (account.sync_status.initial_sync_completed === false) {
          status = 'Syncing';
        } else if (account.sync_status.initial_sync_completed === true) {
          status = 'Connected';
        }
      }
      
      // Calculate total balance using helper function
      const totalBalance = calculateTotalBalance(holdingsMap[account.id]);
      
      return {
        name: account.name || account.number,
        institution: account.institution_name || 'Unknown',
        balance: totalBalance,
        status: status,
      };
    });
    
    // Cache for 5 minutes
    cache.put(cacheKey, JSON.stringify(result), CONFIG.CACHE.SIDEBAR_TTL_SECONDS);
    
    return result;
  } catch (error) {
    Logger.log(`getAccountsForSidebar error: ${error.message}`);
    return { error: error.message };
  }
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

  __DEBUG_MODE_CACHE = false;
  __DEBUG_LOG_SHEET = null;
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const targets = ['Accounts', 'Holdings', 'Transactions', 'Account History', DEBUG_LOG_SHEET];

  targets.forEach((name) => {
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet) {
      spreadsheet.deleteSheet(sheet);
    }
  });
}

/** Sheet that receives user-visible troubleshooting logs when debug mode is on. */
const DEBUG_LOG_SHEET = 'Debug Log';

/** Per-execution caches so logging doesn't hit PropertiesService / getSheetByName each call. */
var __DEBUG_MODE_CACHE = null;
var __DEBUG_LOG_SHEET = null;

/**
 * Enables or disables debug mode for verbose, user-visible troubleshooting logs.
 * @param {boolean} enabled - True to enable debug mode, false to disable
 */
function setDebugMode(enabled) {
  const userProps = PropertiesService.getUserProperties();
  if (enabled) {
    userProps.setProperty('DEBUG_MODE', 'true');
    __DEBUG_MODE_CACHE = true;
    getDebugLogSheet_(); // create the sheet up front so it's easy to find
    SpreadsheetApp.getUi().alert(
      'Debug mode is ON.\n\nVerbose troubleshooting logs will be written to the "' + DEBUG_LOG_SHEET +
      '" sheet (and the Apps Script execution log). Reproduce the problem, then read that sheet ' +
      'or send it along when reporting an issue.\n\nTurn debug mode off when you are done — it ' +
      'makes refreshes slower.'
    );
  } else {
    userProps.deleteProperty('DEBUG_MODE');
    __DEBUG_MODE_CACHE = false;
    SpreadsheetApp.getUi().alert('Debug mode is OFF.');
  }
}

/**
 * Checks if debug mode is currently enabled (cached per execution).
 * @returns {boolean} True if debug mode is enabled
 */
function isDebugMode() {
  if (__DEBUG_MODE_CACHE === null) {
    __DEBUG_MODE_CACHE = PropertiesService.getUserProperties().getProperty('DEBUG_MODE') === 'true';
  }
  return __DEBUG_MODE_CACHE;
}

/**
 * Toggles debug mode on/off.
 */
function toggleDebugMode() {
  setDebugMode(!isDebugMode());
}

/**
 * Verbose troubleshooting log. Always writes to the Apps Script execution log; when debug
 * mode is on it ALSO appends a timestamped row to a visible "Debug Log" sheet so problems can
 * be diagnosed without opening the script editor. Rows are written immediately (not buffered)
 * so they survive a crash or 6-minute timeout — which is exactly when they matter.
 *
 * Use for high-level events (API calls, counts, flags, errors); avoid calling inside large
 * per-row loops, which would flood the sheet and slow the run.
 * @param {string} context - Short tag for where the log came from (e.g. 'snapTradeRequest')
 * @param {string} message
 * @param {*} [data] - Optional structured detail; stringified and truncated
 */
function debugLog(context, message, data) {
  const hasData = data !== undefined;
  const detail = hasData ? safeStringifyForLog_(data) : '';
  Logger.log(hasData ? `[${context}] ${message} | ${detail}` : `[${context}] ${message}`);
  if (!isDebugMode()) return;
  try {
    getDebugLogSheet_().appendRow([new Date(), context, message, detail]);
  } catch (e) {
    Logger.log(`[debugLog] Could not write to ${DEBUG_LOG_SHEET}: ${e.message}`);
  }
}

/**
 * Lazily creates/returns the Debug Log sheet (cached per execution).
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getDebugLogSheet_() {
  if (__DEBUG_LOG_SHEET) return __DEBUG_LOG_SHEET;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(DEBUG_LOG_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DEBUG_LOG_SHEET);
    sheet.appendRow(['Timestamp', 'Context', 'Message', 'Data']);
    formatSheetHeader(sheet);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(3, 320);
    sheet.setColumnWidth(4, 480);
  }
  __DEBUG_LOG_SHEET = sheet;
  return sheet;
}

/**
 * Safely stringifies arbitrary log data, truncating very long output.
 * @param {*} data
 * @returns {string}
 */
function safeStringifyForLog_(data) {
  let str;
  try {
    str = typeof data === 'string' ? data : JSON.stringify(data);
  } catch (e) {
    str = String(data);
  }
  if (str && str.length > 5000) str = str.substring(0, 5000) + '…[truncated]';
  return str || '';
}

/**
 * Clears the Debug Log sheet contents (keeps the header). Menu action.
 */
function clearDebugLog() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(DEBUG_LOG_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Debug Log is already empty.');
    return;
  }
  sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  SpreadsheetApp.getUi().alert('Debug Log cleared.');
}

/**
 * Activates the Debug Log sheet so the user can read it. Menu action.
 */
function showDebugLog() {
  const sheet = getDebugLogSheet_();
  SpreadsheetApp.setActiveSheet(sheet);
  if (sheet.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert(
      'Debug Log is empty. Turn on Debug Mode, reproduce the problem, then come back here.'
    );
  }
}

/**
 * Formats the header row of a sheet with styling.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The sheet to format
 */
function formatSheetHeader(sheet) {
  const lastColumn = sheet.getLastColumn();
  
  // Guard against empty sheets
  if (lastColumn === 0) {
    return;
  }
  
  const headerRange = sheet.getRange(1, 1, 1, lastColumn);
  
  // Make header bold
  headerRange.setFontWeight('bold');
  
  // Set background color (light blue)
  headerRange.setBackground('#4A86E8');
  
  // Set text color (white)
  headerRange.setFontColor('#FFFFFF');
  
  // Center align text
  headerRange.setHorizontalAlignment('center');
  
  // Freeze header row
  sheet.setFrozenRows(1);
  
  // Add borders
  headerRange.setBorder(true, true, true, true, true, true);
}

/**
 * Parses Java object format string and extracts key-value pairs.
 * Handles format: {key=value, key2=value2, ...}
 * Supports nested braces and brackets: {key={nested=val}, key2=[arr]}
 * Also handles unclosed brackets in Java array representations like [Ljava.lang.Object;@hash
 * @param {string} javaObjStr - String representation of Java object
 * @param {string} key - Key to extract from the object
 * @returns {string|null} Extracted value or null if not found
 */
function parseJavaObjectString(javaObjStr, key) {
  const debug = isDebugMode();
  
  if (debug) {
    Logger.log(`[parseJavaObjectString] Input type: ${typeof javaObjStr}, Key: ${key}`);
    Logger.log(`[parseJavaObjectString] Input value: ${javaObjStr}`);
  }
  
  if (!javaObjStr || typeof javaObjStr !== 'string') {
    if (debug) Logger.log(`[parseJavaObjectString] Invalid input, returning null`);
    return null;
  }
  
  // Remove outer braces if present
  let content = javaObjStr.trim();
  if (content.startsWith('{') && content.endsWith('}')) {
    content = content.substring(1, content.length - 1);
    if (debug) Logger.log(`[parseJavaObjectString] Stripped outer braces`);
  }
  
  // Parse using character-by-character approach to track depth
  const pairs = [];
  let currentKey = '';
  let currentValue = '';
  let inKey = true;
  let braceDepth = 0;
  let bracketDepth = 0;
  
  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    
    if (char === '{') {
      braceDepth++;
      if (!inKey) currentValue += char;
    } else if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      if (!inKey) currentValue += char;
    } else if (char === '[') {
      bracketDepth++;
      if (!inKey) currentValue += char;
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
      if (!inKey) currentValue += char;
    } else if (char === '=' && braceDepth === 0 && bracketDepth === 0 && inKey) {
      // Found the key-value separator
      inKey = false;
    } else if (char === ',' && braceDepth === 0 && bracketDepth === 0) {
      // Found end of key-value pair
      pairs.push({ key: currentKey.trim(), value: currentValue.trim() });
      currentKey = '';
      currentValue = '';
      inKey = true;
    } else if (char === ' ' && bracketDepth > 0 && !inKey) {
      // Special handling for unclosed brackets in Java array representations
      // Java's toString() for arrays like "[Ljava.lang.Object;@hash" doesn't include closing brackets
      // When we're inside brackets and hit a space, check if the next non-whitespace looks like a new key-value pair
      // This handles patterns like: "currencies=[Ljava.lang.Object;@773b7135, figi_code=BBG004Z0CPF7"
      let lookahead = i + 1;
      let possibleKey = '';
      const maxLookahead = 100; // Limit lookahead to prevent performance issues
      while (lookahead < content.length && lookahead < i + maxLookahead && 
             content[lookahead] !== '=' && content[lookahead] !== ',' && 
             content[lookahead] !== '{' && content[lookahead] !== '}') {
        possibleKey += content[lookahead];
        lookahead++;
      }
      if (lookahead < content.length && content[lookahead] === '=') {
        // This is a new key-value pair, reset bracket depth
        bracketDepth = 0;
        // Save current pair
        pairs.push({ key: currentKey.trim(), value: currentValue.trim() });
        currentKey = '';
        currentValue = '';
        inKey = true;
        // Don't add the space to anything, continue to next iteration
        continue;
      } else {
        if (!inKey) currentValue += char;
      }
    } else {
      if (inKey) {
        currentKey += char;
      } else {
        currentValue += char;
      }
    }
  }
  
  // Don't forget the last pair
  if (currentKey.trim() !== '') {
    pairs.push({ key: currentKey.trim(), value: currentValue.trim() });
  }
  
  if (debug) {
    Logger.log(`[parseJavaObjectString] Extracted ${pairs.length} pairs`);
    pairs.forEach((p, idx) => {
      Logger.log(`[parseJavaObjectString] Pair ${idx}: "${p.key}" = "${p.value}"`);
    });
  }
  
  // Find and return the requested key's value
  const pair = pairs.find(p => p.key === key);
  const result = pair ? pair.value : null;
  
  if (debug) {
    Logger.log(`[parseJavaObjectString] Result for key "${key}": ${result}`);
  }
  
  return result;
}

/**
 * Extracts symbol and description from position.symbol data.
 * Handles both object format and Java object string format.
 * @param {Object|string} symbolData - Symbol data from API
 * @returns {{symbol: string, description: string}}
 */
function extractSymbolInfo(symbolData) {
  const debug = isDebugMode();
  let symbol = 'N/A';
  let description = '';
  
  if (debug) {
    Logger.log(`[extractSymbolInfo] Input type: ${typeof symbolData}`);
    Logger.log(`[extractSymbolInfo] Input is null: ${symbolData === null}`);
    Logger.log(`[extractSymbolInfo] Input is undefined: ${symbolData === undefined}`);
    Logger.log(`[extractSymbolInfo] Input is array: ${Array.isArray(symbolData)}`);
  }
  
  if (!symbolData) {
    if (debug) Logger.log(`[extractSymbolInfo] symbolData is null/undefined, returning defaults`);
    return { symbol, description };
  }
  
  // Handle array format (take first element)
  if (Array.isArray(symbolData)) {
    if (debug) Logger.log(`[extractSymbolInfo] symbolData is array with ${symbolData.length} elements`);
    if (symbolData.length > 0) {
      return extractSymbolInfo(symbolData[0]);
    }
    return { symbol, description };
  }
  
  // Check if it's a string (Java object format or JSON)
  if (typeof symbolData === 'string') {
    const preview = symbolData.length > 100 ? symbolData.substring(0, 100) + '...' : symbolData;
    if (debug) Logger.log(`[extractSymbolInfo] symbolData is string: ${preview}`);
    
    // Try JSON parsing first
    try {
      const parsed = JSON.parse(symbolData);
      if (debug) Logger.log(`[extractSymbolInfo] Successfully parsed as JSON`);
      if (parsed && typeof parsed === 'object') {
        symbol = parsed.symbol || 'N/A';
        description = parsed.description || '';
        if (debug) Logger.log(`[extractSymbolInfo] Extracted from JSON - symbol: ${symbol}, description: ${description}`);
        return { symbol, description };
      }
    } catch (e) {
      if (debug) Logger.log(`[extractSymbolInfo] Not valid JSON, trying Java object parsing`);
    }
    
    // Parse as Java object string
    symbol = parseJavaObjectString(symbolData, 'symbol') || 'N/A';
    description = parseJavaObjectString(symbolData, 'description') || '';
    if (debug) Logger.log(`[extractSymbolInfo] Extracted from Java string - symbol: ${symbol}, description: ${description}`);
  } 
  // Check if it's an object
  else if (typeof symbolData === 'object') {
    if (debug) {
      Logger.log(`[extractSymbolInfo] symbolData is object`);
      Logger.log(`[extractSymbolInfo] Object keys: ${Object.keys(symbolData).join(', ')}`);
    }
    
    // Handle nested symbol.symbol structure
    if (symbolData.symbol && typeof symbolData.symbol === 'object') {
      if (debug) Logger.log(`[extractSymbolInfo] Detected nested symbol.symbol structure`);
      symbol = symbolData.symbol.symbol || 'N/A';
      description = symbolData.symbol.description || symbolData.description || '';
    } else if (symbolData.symbol && typeof symbolData.symbol === 'string') {
      symbol = symbolData.symbol;
      description = symbolData.description || '';
    } else {
      // Check if object is empty
      const keys = Object.keys(symbolData);
      if (keys.length === 0) {
        if (debug) Logger.log(`[extractSymbolInfo] Empty object, using defaults`);
      } else {
        symbol = symbolData.symbol || 'N/A';
        description = symbolData.description || '';
      }
    }
    
    if (debug) Logger.log(`[extractSymbolInfo] Extracted from object - symbol: ${symbol}, description: ${description}`);
  }
  
  return { symbol, description };
}

/**
 * Fetches holdings for all accounts and writes to sheet.
 */
function refreshHoldings() {
  const debug = isDebugMode();
  const MAX_DETAILED_POSITIONS = 3; // Number of positions to log in full detail
  
  try {
    if (debug) Logger.log('[refreshHoldings] Starting holdings refresh');
    
    const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null);
    
    if (debug) {
      Logger.log(`[refreshHoldings] Retrieved ${accounts.length} accounts`);
      Logger.log(`[refreshHoldings] Accounts data: ${JSON.stringify(accounts)}`);
    }
    
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('Holdings') || spreadsheet.insertSheet('Holdings');

    sheet.clear();
    sheet.appendRow([
      'Account',
      'Symbol',
      'Description',
      'Quantity',
      'Price',
      'Currency',
      'Market Value',
      'Cost Basis',
      'Gain/Loss',
      'Price (CAD)',
      'Market Value (CAD)',
      'Cost Basis (CAD)',
      'Gain/Loss (CAD)',
    ]);

    const rows = [];
    let positionCount = 0;

    // Fetch all holdings in parallel
    const holdingsMap = fetchAccountDataInParallel(accounts, 'holdings');

    accounts.forEach((account, accountIndex) => {
      if (debug) {
        Logger.log(`[refreshHoldings] Processing account ${accountIndex + 1}/${accounts.length}: ${account.name || account.number} (ID: ${account.id})`);
      }
      
      const holdings = holdingsMap[account.id];
      
      if (!holdings) {
        if (debug) {
          Logger.log(`[refreshHoldings] No holdings data for account ${account.id}`);
        }
        return;
      }
      
      if (debug) {
        Logger.log(`[refreshHoldings] Raw holdings response for account ${account.id}:`);
        Logger.log(JSON.stringify(holdings));
      }

      if (holdings.positions) {
        if (debug) {
          Logger.log(`[refreshHoldings] Account has ${holdings.positions.length} positions`);
        }
        
        holdings.positions.forEach((position, posIndex) => {
          positionCount++;
          
          // Log first few positions in detail
          if (debug && positionCount <= MAX_DETAILED_POSITIONS) {
            Logger.log(`[refreshHoldings] === Position ${positionCount} Full Structure ===`);
            Logger.log(JSON.stringify(position));
            Logger.log(`[refreshHoldings] position.symbol type: ${typeof position.symbol}`);
            Logger.log(`[refreshHoldings] position.symbol value: ${JSON.stringify(position.symbol)}`);
          }
          
          if (debug) {
            Logger.log(`[refreshHoldings] Processing position ${posIndex + 1}/${holdings.positions.length} in account ${account.id}`);
            Logger.log(`[refreshHoldings] Raw symbol data before extraction: ${JSON.stringify(position.symbol)}`);
          }
          
          const symbolInfo = extractSymbolInfo(position.symbol);
          
          if (debug) {
            Logger.log(`[refreshHoldings] Extracted symbol info: symbol="${symbolInfo.symbol}", description="${symbolInfo.description}"`);
          }
          
          const symbol = symbolInfo.symbol;
          const description = symbolInfo.description;
          const units = position.units || 0;
          const price = position.price || 0;
          const marketValue = units * price;
          const costBasis = units * (position.average_purchase_price || 0);
          const currency = (position.currency && position.currency.code) || 'USD';
          
          // We'll add formulas for CAD conversion after writing the data
          rows.push([
            account.name || account.number,
            symbol,
            description,
            units,
            price,
            currency,
            marketValue,
            costBasis,
            marketValue - costBasis,
            '', // Price (CAD) - will be filled with formula
            '', // Market Value (CAD) - will be filled with formula
            '', // Cost Basis (CAD) - will be filled with formula
            '', // Gain/Loss (CAD) - will be filled with formula
          ]);
        });
      } else {
        if (debug) {
          Logger.log(`[refreshHoldings] No positions found for account ${account.id}`);
        }
      }
    });

    if (debug) {
      Logger.log(`[refreshHoldings] Total positions processed: ${positionCount}`);
      Logger.log(`[refreshHoldings] Total rows to write: ${rows.length}`);
    }

    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
      
      // Add formulas for CAD conversion using R1C1 notation for batch operations
      // Column F is Currency (col 6), E is Price (col 5), G is Market Value (col 7), H is Cost Basis (col 8), I is Gain/Loss (col 9)
      // CAD columns: J (10), K (11), L (12), M (13)
      
      // Build formula arrays for batch insertion
      const priceCADFormulas = [];
      const marketValueCADFormulas = [];
      const costBasisCADFormulas = [];
      const gainLossCADFormulas = [];
      
      // Currency is col 6; CAD columns reference it plus their native-value column.
      const priceCAD = getCADConversionFormula(-4, -5);        // col 10 <- Currency(6), Price(5)
      const marketValueCAD = getCADConversionFormula(-5, -4);  // col 11 <- Currency(6), Market Value(7)
      const costBasisCAD = getCADConversionFormula(-6, -4);    // col 12 <- Currency(6), Cost Basis(8)
      const gainLossCAD = getCADConversionFormula(-7, -4);     // col 13 <- Currency(6), Gain/Loss(9)

      for (let i = 0; i < rows.length; i++) {
        priceCADFormulas.push([priceCAD]);
        marketValueCADFormulas.push([marketValueCAD]);
        costBasisCADFormulas.push([costBasisCAD]);
        gainLossCADFormulas.push([gainLossCAD]);
      }
      
      // Set all formulas at once
      sheet.getRange(2, 10, rows.length, 1).setFormulasR1C1(priceCADFormulas);
      sheet.getRange(2, 11, rows.length, 1).setFormulasR1C1(marketValueCADFormulas);
      sheet.getRange(2, 12, rows.length, 1).setFormulasR1C1(costBasisCADFormulas);
      sheet.getRange(2, 13, rows.length, 1).setFormulasR1C1(gainLossCADFormulas);
    }

    // Format price and value columns as currency
    // Original columns: E (Price), G (Market Value), H (Cost Basis), I (Gain/Loss)
    // CAD columns: J, K, L, M
    if (rows.length > 0) {
      sheet.getRange(2, 5, rows.length, 1).setNumberFormat('$#,##0.00'); // Price
      sheet.getRange(2, 7, rows.length, 1).setNumberFormat('$#,##0.00'); // Market Value
      sheet.getRange(2, 8, rows.length, 1).setNumberFormat('$#,##0.00'); // Cost Basis
      sheet.getRange(2, 9, rows.length, 1).setNumberFormat('$#,##0.00'); // Gain/Loss
      sheet.getRange(2, 10, rows.length, 1).setNumberFormat('$#,##0.00'); // Price (CAD)
      sheet.getRange(2, 11, rows.length, 1).setNumberFormat('$#,##0.00'); // Market Value (CAD)
      sheet.getRange(2, 12, rows.length, 1).setNumberFormat('$#,##0.00'); // Cost Basis (CAD)
      sheet.getRange(2, 13, rows.length, 1).setNumberFormat('$#,##0.00'); // Gain/Loss (CAD)
    }
    
    // Format header row
    formatSheetHeader(sheet);
    
    // Auto-resize columns for better readability
    sheet.autoResizeColumns(1, 13);
    
    const message = `Refreshed ${rows.length} positions from ${accounts.length} accounts.`;
    if (debug) Logger.log(`[refreshHoldings] ${message}`);
    
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    const errorMsg = `Error refreshing holdings: ${error.message}`;
    debugLog('refreshHoldings', 'error', error.stack || error.message);
    SpreadsheetApp.getUi().alert(errorMsg);
  }
}

/**
 * Creates an accounts summary sheet with complete account information including cash, holdings, and total value.
 * Automatically updates account history (once per day).
 */
function refreshAccounts() {
  try {
    showToast('Fetching accounts...', 'SnapTrade', -1);
    const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('Accounts') || spreadsheet.insertSheet('Accounts');

    sheet.clear();
    sheet.appendRow([
      'Institution',
      'Account Name',
      'Account ID',
      'Cash',
      'Holdings Value',
      'Total Value',
      'Currency',
      'Total (CAD)',
      'Buying Power',
      'Balance Check',
      'Last Update',
      'Raw Data',
    ]);

    const rows = [];

    showToast(`Fetching holdings for ${accounts.length} accounts...`, 'SnapTrade', -1);
    // Fetch holdings and balances for all accounts in parallel. The dedicated /balances
    // endpoint is the authoritative cash figure and is used to cross-check the cash we
    // derive from the holdings endpoint, and to surface margin buying power.
    const holdingsMap = fetchAccountDataInParallel(accounts, 'holdings');
    const balancesMap = fetchAccountDataInParallel(accounts, 'balances');

    showToast('Processing data...', 'SnapTrade', -1);
    // Fetch holdings for each account to calculate complete picture
    accounts.forEach((account) => {
      const holdings = holdingsMap[account.id];
      const balByCurrency = extractBalancesByCurrency(balancesMap[account.id]);

      // Log if holdings is null or undefined, but still include the account with zero values
      if (!holdings) {
        Logger.log(`No holdings data returned for account ${account.id} (${account.name || account.number}). Including account with zero values.`);
        rows.push(createDefaultAccountRow(account));
        return;
      }

      // Use helper function to calculate balance by currency
      const byCurrency = calculateBalanceByCurrency(holdings);

      // If no currencies found (empty holdings), create a default entry
      if (Object.keys(byCurrency).length === 0) {
        Logger.log(`No currency data found for account ${account.id} (${account.name || account.number}). Adding with zero values.`);
        rows.push(createDefaultAccountRow(account));
        return;
      }

      // Create a row for each currency
      Object.keys(byCurrency).forEach((currencyCode) => {
        const cash = byCurrency[currencyCode].cash;
        const holdingsValue = byCurrency[currencyCode].holdingsValue;
        const totalValue = cash + holdingsValue;
        const authoritative = balByCurrency[currencyCode];
        const balanceCheck = computeBalanceCheck(cash, authoritative);

        rows.push([
          account.institution_name || '',
          account.name || account.number,
          account.id || '',
          cash,
          holdingsValue,
          totalValue,
          currencyCode,
          '', // Total (CAD) - will be filled with formula
          authoritative ? authoritative.buyingPower : '',
          balanceCheck,
          (account.sync_status && account.sync_status.holdings && account.sync_status.holdings.last_successful_sync) || '',
          JSON.stringify(account),
        ]);
      });
    });

    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
      
      // Add formulas for CAD conversion using helper function
      const cadFormula = getCADConversionFormula();
      const totalCADFormulas = Array.from({length: rows.length}, () => [cadFormula]);
      
      // Set all formulas at once
      sheet.getRange(2, 8, rows.length, 1).setFormulasR1C1(totalCADFormulas);
      
      // Format currency columns (Cash, Holdings Value, Total Value, Total (CAD), Buying Power)
      const currencyFormat = CONFIG.SHEETS.CURRENCY_FORMAT;
      const currencyCols = CONFIG.SHEETS.COLUMNS.ACCOUNTS.CURRENCY_COLS.concat([9]);
      currencyCols.forEach(col => {
        sheet.getRange(2, col, rows.length, 1).setNumberFormat(currencyFormat);
      });
    }
    
    // Format header row
    formatSheetHeader(sheet);
    
    // Note: Removed autoResizeColumns() as it triggers formula evaluation (GOOGLEFINANCE)
    // which causes Google Sheets' persistent "working" indicator
    // Users can manually resize columns if needed via Format → Resize columns
    
    // Hide Account ID (column 3), Last Update (column 11), and Raw Data (column 12) by default
    sheet.hideColumns(3, 1); // Hide Account ID (column 3)
    sheet.hideColumns(11, 2); // Hide Last Update (11) and Raw Data (12)
    
    // Automatically update account history (once per day) - pass the already-fetched holdings
    try {
      updateAccountHistoryOnce(accounts, holdingsMap);
    } catch (historyError) {
      Logger.log(`Error updating account history: ${historyError.message}`);
      // Continue execution - history update failure shouldn't prevent accounts refresh
    }
    
    // Flush all pending operations before showing alert
    SpreadsheetApp.flush();
    
    // Clear any persistent toast before showing alert
    clearToast();
    
    SpreadsheetApp.getUi().alert(`Refreshed ${rows.length} account balances from ${accounts.length} accounts.`);
    
    // Clear toast again after alert to ensure no residual toast appears
    clearToast();
  } catch (error) {
    clearToast();
    SpreadsheetApp.getUi().alert(`Error refreshing accounts: ${error.message}`);
    debugLog('refreshAccounts', 'error', error.stack || error.message);
    clearToast();
  }
}

/**
 * Tracks account values over time by appending current balances to a history sheet.
 * Creates a time-series record of each account's net value.
 */
function trackAccountHistory() {
  try {
    const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null);
    updateAccountHistoryOnce(accounts);
    
    const timestamp = new Date();
    SpreadsheetApp.getUi().alert(`Tracked ${accounts.length} account values at ${timestamp.toLocaleString()}.`);
  } catch (error) {
    SpreadsheetApp.getUi().alert(`Error tracking account history: ${error.message}`);
    debugLog('trackAccountHistory', 'error', error.stack || error.message);
  }
}

/**
 * Updates account history, but only once per day. If called multiple times in the same day,
 * updates existing rows instead of creating new ones.
 * @param {Array} accounts - Array of account objects from SnapTrade API
 * @param {Object} holdingsMap - Optional map of accountId to holdings data (to avoid duplicate API calls)
 */
function updateAccountHistoryOnce(accounts, holdingsMap) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName('Account History') || spreadsheet.insertSheet('Account History');
  
  // Initialize sheet if empty
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'Account Name', 'Account ID', 'Cash', 'Holdings Value', 'Total Value', 'Currency', 'Total (CAD)', 'Institution']);
    formatSheetHeader(sheet);
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize to start of day
  const todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  
  // Check if we already have entries for today
  let todayStartRow = -1;
  let todayEndRow = -1;
  
  // Only check for existing entries if sheet has data beyond header
  if (sheet.getLastRow() > 1) {
    const data = sheet.getDataRange().getValues();
    
    for (let i = 1; i < data.length; i++) { // Start from 1 to skip header
      const rowDate = new Date(data[i][0]);
      rowDate.setHours(0, 0, 0, 0);
      const rowDateStr = Utilities.formatDate(rowDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      
      if (rowDateStr === todayStr) {
        if (todayStartRow === -1) {
          todayStartRow = i + 1; // +1 because array is 0-indexed but rows are 1-indexed
        }
        todayEndRow = i + 1;
      }
    }
  }
  
  const timestamp = new Date();
  const rows = [];
  
  // Use prefetched holdings if available, otherwise fetch them
  const accountHoldingsMap = holdingsMap || fetchAccountDataInParallel(accounts, 'holdings');
  
  // Fetch holdings for each account to match Accounts sheet data source
  accounts.forEach((account) => {
    const holdings = accountHoldingsMap[account.id];
    
    // Log if holdings is null or undefined, but still include the account with zero values
    if (!holdings) {
      Logger.log(`No holdings data returned for account ${account.id} (${account.name || account.number}). Including account with zero values.`);
      rows.push(createDefaultAccountRow(account, { timestamp }));
      return;
    }
    
    // Use helper function to calculate balance by currency
    const byCurrency = calculateBalanceByCurrency(holdings);
    
    // If no currencies found (empty holdings), create a default entry
    if (Object.keys(byCurrency).length === 0) {
      Logger.log(`No currency data found for account ${account.id} (${account.name || account.number}). Adding with zero values.`);
      rows.push(createDefaultAccountRow(account, { timestamp }));
      return;
    }
    
    // Create a row for each currency
    Object.keys(byCurrency).forEach((currencyCode) => {
      const cash = byCurrency[currencyCode].cash;
      const holdingsValue = byCurrency[currencyCode].holdingsValue;
      const totalValue = cash + holdingsValue;
      
      rows.push([
        timestamp,
        account.name || account.number,
        account.id || '',
        cash,
        holdingsValue,
        totalValue,
        currencyCode,
        '', // Total (CAD) - will be filled with formula
        account.institution_name || '',
      ]);
    });
  });
  
  if (rows.length > 0) {
    let startRow;
    
    if (todayStartRow !== -1) {
      // Update existing rows for today
      startRow = todayStartRow;
      // Delete old rows for today first
      sheet.deleteRows(todayStartRow, todayEndRow - todayStartRow + 1);
    } else {
      // Append new rows
      startRow = sheet.getLastRow() + 1;
    }
    
    sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
    
    // Add formulas for CAD conversion using helper function
    const cadFormula = getCADConversionFormula();
    const totalCADFormulas = Array.from({length: rows.length}, () => [cadFormula]);
    
    // Set all formulas at once
    sheet.getRange(startRow, 8, rows.length, 1).setFormulasR1C1(totalCADFormulas);
    
    // Format currency columns (Cash, Holdings Value, Total Value, Total (CAD))
    const currencyFormat = CONFIG.SHEETS.CURRENCY_FORMAT;
    const currencyCols = CONFIG.SHEETS.COLUMNS.HISTORY.CURRENCY_COLS;
    currencyCols.forEach(col => {
      sheet.getRange(startRow, col, rows.length, 1).setNumberFormat(currencyFormat);
    });
    
    // Format timestamp column to show only date
    sheet.getRange(startRow, 1, rows.length, 1).setNumberFormat(CONFIG.SHEETS.DATE_FORMAT);
  }
  
  // Auto-resize columns (9 columns: Timestamp, Account Name, Account ID, Cash, Holdings Value, Total Value, Currency, Total (CAD), Institution)
  sheet.autoResizeColumns(1, 9);
}

/**
 * Fetches transactions for a date range.
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 */
function refreshTransactions(startDate, endDate) {
  try {
    const params = {};
    if (startDate) {
      params.startDate = validateDateFormat(startDate);
    }
    if (endDate) {
      params.endDate = validateDateFormat(endDate);
    }
    
    // Ensure end >= start if both provided
    if (params.startDate && params.endDate && new Date(params.endDate) < new Date(params.startDate)) {
      throw new Error('End date must be on or after start date');
    }

    const transactions = snapTradeRequest('GET', '/api/v1/activities', params, null);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('Transactions') || spreadsheet.insertSheet('Transactions');

    sheet.clear();
    sheet.appendRow([
      'Date',
      'Amount',
      'Amount (CAD)',
      'Currency',
      'Description',
      'Category',
      'Account',
      'Symbol',
      'Units',
      'Price',
      'Fee',
      'Attachment',
      'Transaction ID',
      'Raw Data',
    ]);

    const rows = transactions.map((tx) => {
      const symbolInfo = extractSymbolInfo(tx.symbol);
      const symbol = symbolInfo.symbol === 'N/A' ? '' : symbolInfo.symbol;
      const rawDate = tx.trade_date || tx.settlement_date || '';
      const parsedDate = parseActivityDate_(rawDate);
      return [
        parsedDate || rawDate, // real Date when parseable (needed for trade-date FX), else raw
        tx.amount || 0,
        '', // Amount (CAD) - will be filled with formula
        (tx.currency && tx.currency.code) || (tx.symbol && tx.symbol.currency && tx.symbol.currency.code) || 'USD', // Try to get currency from transaction
        tx.description || '',
        tx.type,
        (tx.account && (tx.account.name || tx.account.number)) || '',
        symbol,
        tx.units || '',
        tx.price || '',
        tx.fee || '',
        '',
        tx.id || '',
        JSON.stringify(tx),
      ];
    });

    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);

      // Amount (CAD) = native Amount (col B) x the trade-date FX rate, keyed on Currency
      // (col D) and Date (col A). Uses historical (not spot) rates to match the ACB, Income,
      // and Forex sheets.
      const amountCADFormulas = [];
      for (let i = 0; i < rows.length; i++) {
        const r = i + 2;
        const fxBody = historicalCadFxFormula(`$D${r}`, `$A${r}`).substring(1); // drop leading '='
        amountCADFormulas.push([`=$B${r}*${fxBody}`]);
      }
      sheet.getRange(2, 3, rows.length, 1).setFormulas(amountCADFormulas);

      // Format date and amount/price columns
      sheet.getRange(2, 1, rows.length, 1).setNumberFormat(CONFIG.SHEETS.DATE_FORMAT); // Date
      sheet.getRange(2, 2, rows.length, 1).setNumberFormat('$#,##0.00');  // Amount
      sheet.getRange(2, 3, rows.length, 1).setNumberFormat('$#,##0.00');  // Amount (CAD)
      sheet.getRange(2, 10, rows.length, 1).setNumberFormat('$#,##0.00'); // Price
      sheet.getRange(2, 11, rows.length, 1).setNumberFormat('$#,##0.00'); // Fee
    }

    // Format header row
    formatSheetHeader(sheet);

    // Auto-resize columns for better readability (excluding Transaction ID / Raw Data)
    sheet.autoResizeColumns(1, 11);
    
    // Hide Attachment, Transaction ID, and Raw Data columns by default
    sheet.hideColumns(12, 3);

    SpreadsheetApp.getUi().alert(`Refreshed ${rows.length} transactions.`);
  } catch (error) {
    SpreadsheetApp.getUi().alert(`Error refreshing transactions: ${error.message}`);
    debugLog('refreshTransactions', 'error', error.stack || error.message);
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
    .addItem('📊 Refresh Accounts', 'refreshAccounts')
    .addItem('💰 Refresh Holdings', 'refreshHoldings')
    .addItem('🎯 Refresh Options', 'refreshOptions')
    .addItem('📜 Refresh Transactions', 'showTransactionDialog')
    .addItem('📐 Calculate ACB / Capital Gains', 'refreshACB')
    .addItem('💵 Income & Dividends', 'refreshIncome')
    .addItem('💱 Forex Gains (currency as property)', 'refreshForex')
    .addItem('🧾 Fees', 'refreshFees')
    .addSeparator()
    .addItem('📈 Track Account History', 'trackAccountHistory')
    .addSeparator()
    .addSubMenu(
      SpreadsheetApp.getUi()
        .createMenu('⚙️ Settings')
        .addItem('Configure API Keys', 'showApiKeyDialog')
        .addItem('Register User', 'showRegisterDialog')
        .addItem('Broker Capabilities', 'showBrokerStatusDialog')
        .addItem('🐞 Toggle Debug Mode', 'toggleDebugMode')
        .addItem('🐞 View Debug Log', 'showDebugLog')
        .addItem('🐞 Clear Debug Log', 'clearDebugLog')
        .addItem('Help & Docs', 'showHelpDialog')
        .addItem('Clear All Data', 'clearAllData')
    )
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}
