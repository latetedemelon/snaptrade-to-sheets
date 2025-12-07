/**
 * UI dialog handlers for SnapTrade Sheets add-on.
 */

/**
 * Shows dialog for entering SnapTrade API credentials.
 */
function showApiKeyDialog() {
  const html = HtmlService.createHtmlOutputFromFile('ApiKeyDialog')
    .setWidth(420)
    .setHeight(360);
  SpreadsheetApp.getUi().showModalDialog(html, 'Configure SnapTrade API Keys');
}

/**
 * Persists API credentials to script properties.
 * @param {string} clientId
 * @param {string} consumerKey
 */
function saveApiKeys(clientId, consumerKey) {
  validateApiCredentials(clientId, consumerKey);
  PropertiesService.getScriptProperties().setProperties({
    SNAPTRADE_CLIENT_ID: clientId.trim(),
    SNAPTRADE_CONSUMER_KEY: consumerKey.trim(),
  });
}

/**
 * Shows dialog for registering a new SnapTrade user.
 */
function showRegisterDialog() {
  const html = HtmlService.createHtmlOutputFromFile('RegisterDialog')
    .setWidth(420)
    .setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(html, 'Register SnapTrade User');
}

/**
 * Registers the user with SnapTrade using provided ID or generated UUID.
 * @param {string} userId
 * @returns {{userId: string, userSecret: string}}
 */
function registerUserFromDialog(userId) {
  const id = userId && userId.trim() ? userId.trim() : generateUserId();
  return registerSnapTradeUser(id);
}

/**
 * Shows connection dialog for brokerage linking.
 */
function showConnectBrokerageDialog() {
  const accounts = listUserAccounts();
  const template = HtmlService.createTemplateFromFile('ConnectBrokerageDialog');
  template.previousCount = accounts.length;
  SpreadsheetApp.getUi().showModalDialog(template.evaluate().setWidth(520).setHeight(520), 'Connect Brokerage');
}

/**
 * Generates a portal URL for optional broker filtering.
 * @param {string} broker
 * @returns {string}
 */
function getPortalUrl(broker) {
  const options = broker ? { broker: broker } : {};
  return generateConnectionPortalUrl(options);
}

/**
 * Returns brokerage metadata for UI rendering.
 * @returns {Array}
 */
function getBrokerageMetadata() {
  return getBrokerages();
}

/**
 * Shows sidebar with connected accounts.
 */
function showAccountsSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('AccountsSidebar')
    .setTitle('Connected Accounts');
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Shows transaction import dialog.
 */
function showTransactionDialog() {
  const html = HtmlService.createHtmlOutputFromFile('TransactionDialog')
    .setWidth(420)
    .setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(html, 'Import Transactions');
}

/**
 * Shows broker capability dialog.
 */
function showBrokerStatusDialog() {
  const html = HtmlService.createHtmlOutputFromFile('BrokerStatusDialog')
    .setWidth(520)
    .setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, 'Brokerage Capabilities');
}

/**
 * Shows built-in help dialog.
 */
function showHelpDialog() {
  const html = HtmlService.createHtmlOutputFromFile('HelpDialog')
    .setWidth(520)
    .setHeight(520);
  SpreadsheetApp.getUi().showModalDialog(html, 'SnapTrade Help');
}

/**
 * Helper to include HTML partials inside templates.
 * @param {string} filename
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
