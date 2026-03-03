const { loadSettings, saveSettings } = require('../../lib/storage');

async function runCliConfig(key, value, ui) {
  const keyToSetting = { 'dsoul-provider': 'dsoulProviderUrl', 'skills-folder': 'skillsFolder', 'skills-folder-name': 'skillsFolderName' };
  const settingKey = keyToSetting[key];
  if (!settingKey) { ui.fail('Unknown config key: ' + key); return false; }
  const settings = await loadSettings();
  if (value !== undefined) {
    settings[settingKey] = value;
    const result = await saveSettings(settings);
    if (!result.success) { ui.fail(result.error || 'Failed to save settings'); return false; }
    const c = ui.c || {};
    ui.ok((c.bold || '') + key + (c.reset || '') + ' set to ' + (c.cyan || '') + value + (c.reset || ''));
  } else {
    const current = settings[settingKey] || '';
    if (current) {
      const c = ui.c || {};
      ui.detail(key, (c.cyan || '') + current + (c.reset || ''));
    } else {
      ui.dim(key + ': (not set)');
    }
  }
  return true;
}

module.exports = { runCliConfig };
