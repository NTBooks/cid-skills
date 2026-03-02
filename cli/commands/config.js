const { loadSettings, saveSettings } = require('../../lib/storage');
const log = require('../log');

async function runCliConfig(key, value) {
  const keyToSetting = { 'dsoul-provider': 'dsoulProviderUrl', 'skills-folder': 'skillsFolder', 'skills-folder-name': 'skillsFolderName' };
  const settingKey = keyToSetting[key];
  if (!settingKey) { log.fail('Unknown config key:', key); return false; }
  const settings = await loadSettings();
  if (value !== undefined) {
    settings[settingKey] = value;
    const result = await saveSettings(settings);
    if (!result.success) { log.fail(result.error || 'Failed to save settings'); return false; }
    log.ok(`${log.c.bold}${key}${log.c.reset} set to ${log.c.cyan}${value}${log.c.reset}`);
  } else {
    const current = settings[settingKey] || '';
    if (current) {
      log.detail(key, log.c.cyan + current + log.c.reset);
    } else {
      log.dim(`${key}: (not set)`);
    }
  }
  return true;
}

module.exports = { runCliConfig };
