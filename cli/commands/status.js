const { loadSettings } = require('../../lib/storage');
const { loadWpCredentials } = require('../../lib/credentials');
const { getVersion } = require('../../lib/config');

async function runCliStatus(ui) {
  const version = getVersion();
  const settings = await loadSettings();
  const creds = await loadWpCredentials();

  ui.header('Diamond Soul Status');
  ui.detail('Version',            version);
  ui.detail('Provider',           settings.dsoulProviderUrl || '(default: https://dsoul.org)');
  ui.detail('Skills folder',      settings.skillsFolder     || '(not set)');
  ui.detail('Local folder name',  settings.skillsFolderName || 'skills');
  ui.detail('Credentials',        creds ? creds.username + ' (registered)' : '(not registered)');
  return true;
}

module.exports = { runCliStatus };
