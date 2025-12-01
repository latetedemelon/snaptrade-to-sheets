What's Included
FilePurposeCode.gsMain application - authentication, API calls, data importDialogs.gsAll UI dialog handlersApiKeyDialog.htmlConfigure SnapTrade credentialsRegisterDialog.htmlUser registration interfaceConnectBrokerageDialog.htmlBroker selection with cards for each brokerAccountsSidebar.htmlView connected accounts in sidebarTransactionDialog.htmlTransaction import with date filtersBrokerStatusDialog.htmlView broker capabilitiesHelpDialog.htmlBuilt-in documentationREADME.mdComplete setup instructions
Broker-Specific Features
FeatureQuestrade 🍁Wealthsimple 💚IBKR 🌐Holdings✅✅✅Balances✅✅✅Transactions✅✅✅Orders✅✅❌Trading✅✅❌ (Read-only)ConnectionOAuthCredentialsFlex Query
Quick Setup

Create script files in Google Sheets → Extensions → Apps Script
Copy contents of each file into corresponding script/HTML files
Save and refresh your spreadsheet
Configure API Keys via the new SnapTrade menu
Register a user (generates unique ID automatically)
Connect your brokerage - dedicated buttons for each broker

Key Notes

Questrade requires SnapTrade to approve your application first
Interactive Brokers is read-only (uses Flex Query, no trading)
Wealthsimple works out of the box with full trading support
All credentials are securely stored in Google Apps Script properties
Includes built-in rate limit handling with exponential backoff
