const readline = require('readline');
const { loadWpCredentials, saveWpCredentials, clearWpCredentials } = require('../../lib/credentials');
const { runCliBalance } = require('./balance');

function askLine(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => { rl.close(); resolve(answer != null ? String(answer).trim() : ''); });
  });
}

async function runCliRegister(cliArgs, ui) {
  try {
    if (cliArgs && cliArgs.statusOnly) {
      const existing = await loadWpCredentials();
      if (existing) {
        ui.ok('Registered as ' + ui.name(existing.username));
      } else {
        ui.info('No username registered.');
      }
      return true;
    }

    ui.header('Register credentials');
    let username = (cliArgs && cliArgs.username) || (process.env.DSOUL_USER || '').trim();
    let applicationKey = (cliArgs && cliArgs.token) || (process.env.DSOUL_TOKEN || process.env.DSOUL_APPLICATION_KEY || '').trim();
    if (!username || !applicationKey) {
      if (!process.stdin.isTTY) {
        ui.fail('No interactive terminal.');
        ui.info('Provide username and token: dsoul register <username> <token>');
        return false;
      }
      const c = ui.c || {};
      username = await askLine('  ' + (c.cyan || '') + '?' + (c.reset || '') + ' WordPress username: ');
      if (!username) { ui.fail('Username is required.'); return false; }
      applicationKey = await askLine('  ' + (c.cyan || '') + '?' + (c.reset || '') + ' Application key: ');
      if (!applicationKey) { ui.fail('Application key is required.'); return false; }
    }

    ui.step('Saving credentials');
    const result = await saveWpCredentials({ username, applicationKey });
    if (!result.success) { ui.fail('Register failed: ' + result.error); return false; }
    ui.ok('Credentials saved');

    ui.step('Verifying with balance check');
    const balanceOk = await runCliBalance(ui);
    if (!balanceOk) { ui.warn('Registration saved but verification failed.'); return false; }
    return true;
  } catch (err) { ui.fail('Register failed: ' + (err.message || String(err))); return false; }
}

async function runCliUnregister(ui) {
  try {
    ui.step('Clearing credentials');
    await clearWpCredentials();
    ui.ok('Credentials cleared');
    return true;
  } catch (err) { ui.fail('Unregister failed: ' + (err.message || String(err))); return false; }
}

module.exports = { runCliRegister, runCliUnregister };
