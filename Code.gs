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
  try {
    const accounts = listUserAccounts();
    return accounts.map((account) => ({
      name: account.name || account.number,
      institution: account.institution_name || 'Unknown',
      balance: (account.balance && account.balance.total && account.balance.total.amount) || 0,
      status: account.sync_status || 'Connected',
    }));
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

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const targets = ['Accounts', 'Holdings', 'Balances', 'Transactions', 'Account History'];

  targets.forEach((name) => {
    const sheet = spreadsheet.getSheetByName(name);
    if (sheet) {
      spreadsheet.deleteSheet(sheet);
    }
  });
}

/**
 * Enables or disables debug mode for verbose logging.
 * @param {boolean} enabled - True to enable debug mode, false to disable
 */
function setDebugMode(enabled) {
  const userProps = PropertiesService.getUserProperties();
  if (enabled) {
    userProps.setProperty('DEBUG_MODE', 'true');
    SpreadsheetApp.getUi().alert('Debug mode enabled. Verbose logging will appear in execution logs.');
  } else {
    userProps.deleteProperty('DEBUG_MODE');
    SpreadsheetApp.getUi().alert('Debug mode disabled.');
  }
}

/**
 * Checks if debug mode is currently enabled.
 * @returns {boolean} True if debug mode is enabled
 */
function isDebugMode() {
  const userProps = PropertiesService.getUserProperties();
  return userProps.getProperty('DEBUG_MODE') === 'true';
}

/**
 * Toggles debug mode on/off.
 */
function toggleDebugMode() {
  const currentMode = isDebugMode();
  setDebugMode(!currentMode);
}

/**
 * Formats the header row of a sheet with styling.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The sheet to format
 */
function formatSheetHeader(sheet) {
  const headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn());
  
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
      'Market Value',
      'Cost Basis',
      'Gain/Loss',
      'Currency',
    ]);

    const rows = [];
    let positionCount = 0;

    accounts.forEach((account, accountIndex) => {
      if (debug) {
        Logger.log(`[refreshHoldings] Processing account ${accountIndex + 1}/${accounts.length}: ${account.name || account.number} (ID: ${account.id})`);
      }
      
      const holdings = snapTradeRequest('GET', `/api/v1/accounts/${account.id}/holdings`, {}, null);
      
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
    }

    sheet.getRange(2, 5, Math.max(rows.length, 1), 4).setNumberFormat('$#,##0.00');
    
    // Format header row
    formatSheetHeader(sheet);
    
    // Auto-resize columns for better readability
    sheet.autoResizeColumns(1, 9);
    
    const message = `Refreshed ${rows.length} positions from ${accounts.length} accounts.`;
    if (debug) Logger.log(`[refreshHoldings] ${message}`);
    
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    const errorMsg = `Error refreshing holdings: ${error.message}`;
    Logger.log(`[refreshHoldings] ${errorMsg}`);
    Logger.log(`[refreshHoldings] Stack trace: ${error.stack}`);
    SpreadsheetApp.getUi().alert(errorMsg);
  }
}

/**
 * Creates a balances summary sheet.
 */
function refreshBalances() {
  try {
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
    
    // Format header row
    formatSheetHeader(sheet);
    
    // Auto-resize columns for better readability
    sheet.autoResizeColumns(1, 6);
    
    SpreadsheetApp.getUi().alert(`Refreshed balances for ${accounts.length} accounts.`);
  } catch (error) {
    SpreadsheetApp.getUi().alert(`Error refreshing balances: ${error.message}`);
    Logger.log(`refreshBalances error: ${error.message}`);
  }
}

/**
 * Creates an accounts summary sheet.
 */
function refreshAccounts() {
  try {
    const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('Accounts') || spreadsheet.insertSheet('Accounts');

    sheet.clear();
    sheet.appendRow([
      'Account Name',
      'Balance',
      'Currency',
      'Notes',
      'Last Update',
      'Institution',
      'Account ID',
      'Raw Data',
    ]);

    const rows = accounts.map((account) => [
      account.name || account.number,
      (account.balance && account.balance.total && account.balance.total.amount) || 0,
      (account.balance && account.balance.total && account.balance.total.currency) || '',
      '',
      (account.sync_status && account.sync_status.holdings && account.sync_status.holdings.last_successful_sync) || '',
      account.institution_name || '',
      account.id || '',
      JSON.stringify(account),
    ]);

    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
      sheet.getRange(2, 2, rows.length, 1).setNumberFormat('$#,##0.00');
    }
    
    // Format header row
    formatSheetHeader(sheet);
    
    // Auto-resize columns for better readability (excluding Raw Data column which can be very wide)
    sheet.autoResizeColumns(1, 7);
    
    SpreadsheetApp.getUi().alert(`Refreshed ${accounts.length} accounts.`);
  } catch (error) {
    SpreadsheetApp.getUi().alert(`Error refreshing accounts: ${error.message}`);
    Logger.log(`refreshAccounts error: ${error.message}`);
  }
}

/**
 * Tracks account values over time by appending current balances to a history sheet.
 * Creates a time-series record of each account's net value.
 */
function trackAccountHistory() {
  try {
    const accounts = snapTradeRequest('GET', '/api/v1/accounts', {}, null);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('Account History') || spreadsheet.insertSheet('Account History');
    
    // Initialize sheet if empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Account Name', 'Account ID', 'Balance', 'Currency', 'Institution']);
      formatSheetHeader(sheet);
    }
    
    const timestamp = new Date();
    const rows = accounts.map((account) => [
      timestamp,
      account.name || account.number,
      account.id || '',
      (account.balance && account.balance.total && account.balance.total.amount) || 0,
      (account.balance && account.balance.total && account.balance.total.currency) || '',
      account.institution_name || '',
    ]);
    
    if (rows.length > 0) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);
      
      // Format balance column as currency
      sheet.getRange(startRow, 4, rows.length, 1).setNumberFormat('$#,##0.00');
      
      // Format timestamp column
      sheet.getRange(startRow, 1, rows.length, 1).setNumberFormat('yyyy-mm-dd hh:mm:ss');
    }
    
    // Auto-resize columns
    sheet.autoResizeColumns(1, 6);
    
    SpreadsheetApp.getUi().alert(`Tracked ${accounts.length} account values at ${timestamp.toLocaleString()}.`);
  } catch (error) {
    SpreadsheetApp.getUi().alert(`Error tracking account history: ${error.message}`);
    Logger.log(`trackAccountHistory error: ${error.message}`);
  }
}

/**
 * Fetches transactions for a date range.
 * @param {string} startDate - ISO date string (YYYY-MM-DD)
 * @param {string} endDate - ISO date string (YYYY-MM-DD)
 */
function refreshTransactions(startDate, endDate) {
  try {
    const params = {};
    if (startDate) params.startDate = startDate;
    if (endDate) params.endDate = endDate;

    const transactions = snapTradeRequest('GET', '/api/v1/activities', params, null);
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = spreadsheet.getSheetByName('Transactions') || spreadsheet.insertSheet('Transactions');

    sheet.clear();
    sheet.appendRow([
      'Date',
      'Amount',
      'Description',
      'Category',
      'Account',
      'Attachment',
      'Transaction ID',
      'Raw Data',
    ]);

    const rows = transactions.map((tx) => [
      tx.trade_date || tx.settlement_date,
      tx.amount || 0,
      tx.description || '',
      tx.type,
      (tx.account && (tx.account.name || tx.account.number)) || '',
      '',
      tx.id || '',
      JSON.stringify(tx),
    ]);

    if (rows.length > 0) {
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
      sheet.getRange(2, 2, rows.length, 1).setNumberFormat('$#,##0.00');
    }
    
    // Format header row
    formatSheetHeader(sheet);
    
    // Auto-resize columns for better readability (excluding Raw Data column which can be very wide)
    sheet.autoResizeColumns(1, 7);
    
    SpreadsheetApp.getUi().alert(`Refreshed ${rows.length} transactions.`);
  } catch (error) {
    SpreadsheetApp.getUi().alert(`Error refreshing transactions: ${error.message}`);
    Logger.log(`refreshTransactions error: ${error.message}`);
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
    .addItem('💵 Refresh Balances', 'refreshBalances')
    .addItem('📜 Refresh Transactions', 'showTransactionDialog')
    .addSeparator()
    .addItem('📈 Track Account History', 'trackAccountHistory')
    .addSeparator()
    .addSubMenu(
      SpreadsheetApp.getUi()
        .createMenu('⚙️ Settings')
        .addItem('Configure API Keys', 'showApiKeyDialog')
        .addItem('Register User', 'showRegisterDialog')
        .addItem('Broker Capabilities', 'showBrokerStatusDialog')
        .addItem('Toggle Debug Mode', 'toggleDebugMode')
        .addItem('Help & Docs', 'showHelpDialog')
        .addItem('Clear All Data', 'clearAllData')
    )
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}
