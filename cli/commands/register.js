const readline = require('readline');
const { loadWpCredentials, saveWpCredentials, clearWpCredentials } = require('../../lib/credentials');
const { runCliBalance } = require('./balance');
const log = require('../log');

function askLine(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => { rl.close(); resolve(answer != null ? String(answer).trim() : ''); });
  });
}

async function runCliRegister(cliArgs) {
  try {
    if (cliArgs && cliArgs.statusOnly) {
      const existing = await loadWpCredentials();
      if (existing) {
        log.ok(`Registered as ${log.name(existing.username)}`);
      } else {
        log.info('No username registered.');
      }
      return true;
    }

    log.header('Register credentials');
    let username = (cliArgs && cliArgs.username) || (process.env.DSOUL_USER || '').trim();
    let applicationKey = (cliArgs && cliArgs.token) || (process.env.DSOUL_TOKEN || process.env.DSOUL_APPLICATION_KEY || '').trim();
    if (!username || !applicationKey) {
      if (!process.stdin.isTTY) {
        log.fail('No interactive terminal.');
        log.info('Provide username and token: dsoul register <username> <token>');
        return false;
      }
      username = await askLine(`  ${log.c.cyan}?${log.c.reset} WordPress username: `);
      if (!username) { log.fail('Username is required.'); return false; }
      applicationKey = await askLine(`  ${log.c.cyan}?${log.c.reset} Application key: `);
      if (!applicationKey) { log.fail('Application key is required.'); return false; }
    }

    log.step('Saving credentials');
    const result = await saveWpCredentials({ username, applicationKey });
    if (!result.success) { log.fail('Register failed:', result.error); return false; }
    log.ok('Credentials saved');

    log.step('Verifying with balance check');
    const balanceOk = await runCliBalance();
    if (!balanceOk) { log.warn('Registration saved but verification failed.'); return false; }
    return true;
  } catch (err) { log.fail('Register failed:', err.message || String(err)); return false; }
}

async function runCliUnregister() {
  try {
    log.step('Clearing credentials');
    await clearWpCredentials();
    log.ok('Credentials cleared');
    return true;
  } catch (err) { log.fail('Unregister failed:', err.message || String(err)); return false; }
}

module.exports = { runCliRegister, runCliUnregister };
