/**
 * Dependency-free CI checks for the Apps Script project. Run with: node test/run-tests.js
 *
 * 1. Syntax-checks every .gs file (compiled in a VM, not executed).
 * 2. Validates appsscript.json and .clasp.json.example parse as JSON.
 * 3. Runs the ACB logic test (TestValidation.gs:testAcbCalculations) against GAS stubs.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const fail = (msg) => { console.error(`✗ ${msg}`); failures++; };
const pass = (msg) => console.log(`✓ ${msg}`);

// 1. Syntax-check all .gs files.
const gsFiles = fs.readdirSync(ROOT).filter((f) => f.endsWith('.gs'));
gsFiles.forEach((file) => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  try {
    new vm.Script(src, { filename: file });
    pass(`syntax: ${file}`);
  } catch (e) {
    fail(`syntax: ${file} — ${e.message}`);
  }
});

// 2. Validate JSON config files.
[['appsscript.json', true], ['.clasp.json.example', true]].forEach(([file]) => {
  try {
    JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    pass(`json: ${file}`);
  } catch (e) {
    fail(`json: ${file} — ${e.message}`);
  }
});

// 3. Run the ACB logic test with minimal Google Apps Script stubs.
try {
  const sandbox = {
    Logger: { log() {} },
    PropertiesService: {
      getUserProperties: () => ({ getProperty: () => null }),
      getScriptProperties: () => ({ getProperty: () => null }),
    },
    console,
  };
  let src = '';
  ['Code.gs', 'ACB.gs', 'Income.gs', 'Options.gs', 'Forex.gs', 'Fees.gs', 'TestValidation.gs'].forEach((f) => {
  ['Code.gs', 'ACB.gs', 'Income.gs', 'Options.gs', 'Forex.gs', 'Pnl.gs', 'TestValidation.gs'].forEach((f) => {
  ['Code.gs', 'ACB.gs', 'Income.gs', 'Options.gs', 'Forex.gs', 'Realized.gs', 'TestValidation.gs'].forEach((f) => {
    src += fs.readFileSync(path.join(ROOT, f), 'utf8') + '\n';
  });
  src += '\nthis.__acbResult = testAcbCalculations();\n';
  src += 'this.__incomeResult = testIncomeTracker();\n';
  src += 'this.__optionsResult = testOptionsExtraction();\n';
  src += 'this.__forexResult = testForexCalculations();\n';
  src += 'this.__debugResult = testDebugLogHelper();\n';
  src += 'this.__reconResult = testReconciliationGuards();\n';
  src += 'this.__feesResult = testFees();\n';
  src += 'this.__pnlResult = testUnrealizedPnl();\n';
  src += 'this.__realizedResult = testRealizedTrades();\n';
  vm.runInNewContext(src, sandbox, { filename: 'logic-test-bundle.js' });

  const r = sandbox.__acbResult;
  if (!r || r.records !== 4) throw new Error(`ACB: expected 4 records, got ${r && r.records}`);
  if (r.aaplFinalUnits !== 70) throw new Error(`ACB: expected AAPL 70 units, got ${r.aaplFinalUnits}`);
  if (!r.flagged || r.flagged.indexOf('MSFT') === -1) throw new Error('ACB: expected MSFT to be flagged');
  pass('ACB logic test (testAcbCalculations)');

  const inc = sandbox.__incomeResult;
  if (!inc || inc.records !== 3) throw new Error(`Income: expected 3 records, got ${inc && inc.records}`);
  pass('Income logic test (testIncomeTracker)');

  if (!sandbox.__optionsResult || !sandbox.__optionsResult.ok) throw new Error('Options extraction test did not pass');
  pass('Options logic test (testOptionsExtraction)');

  const fx = sandbox.__forexResult;
  if (!fx || fx.records !== 4) throw new Error(`Forex: expected 4 records, got ${fx && fx.records}`);
  pass('Forex logic test (testForexCalculations)');

  if (!sandbox.__debugResult || !sandbox.__debugResult.ok) throw new Error('Debug-log helper test did not pass');
  pass('Debug-log logic test (testDebugLogHelper)');

  if (!sandbox.__reconResult || !sandbox.__reconResult.ok) throw new Error('Reconciliation guard test did not pass');
  pass('Reconciliation logic test (testReconciliationGuards)');

  const fees = sandbox.__feesResult;
  if (!fees || fees.records !== 3) throw new Error(`Fees: expected 3 records, got ${fees && fees.records}`);
  if (fees.tradeFees !== 2) throw new Error(`Fees: expected 2 trade fees, got ${fees.tradeFees}`);
  if (fees.accountFees !== 1) throw new Error(`Fees: expected 1 account fee, got ${fees.accountFees}`);
  pass('Fees logic test (testFees)');
  const pnl = sandbox.__pnlResult;
  if (!pnl || pnl.symbols !== 2) throw new Error(`P/L: expected 2 pooled symbols, got ${pnl && pnl.symbols}`);
  if (pnl.aaplUnits !== 150) throw new Error(`P/L: expected AAPL 150 units, got ${pnl.aaplUnits}`);
  if (pnl.aaplGainLoss !== 650) throw new Error(`P/L: expected AAPL gain/loss 650, got ${pnl.aaplGainLoss}`);
  pass('Unrealized P/L logic test (testUnrealizedPnl)');
  const realized = sandbox.__realizedResult;
  if (!realized || realized.legs !== 6) throw new Error(`Realized: expected 6 legs, got ${realized && realized.legs}`);
  if (realized.equityCloses !== 1) throw new Error(`Realized: expected 1 equity close, got ${realized.equityCloses}`);
  if (realized.optionCloses !== 1) throw new Error(`Realized: expected 1 option close (roll), got ${realized.optionCloses}`);
  if (realized.optionContracts !== 2) throw new Error(`Realized: expected 2 option contracts, got ${realized.optionContracts}`);
  pass('Realized trades logic test (testRealizedTrades)');
} catch (e) {
  fail(`logic test — ${e.message}`);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
