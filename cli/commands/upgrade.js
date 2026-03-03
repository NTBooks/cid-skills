const path = require('path');
const { ensureDataDir, loadSettings, readDsoulJson, updateDsoulJson, doDeleteFile } = require('../../lib/storage');
const { fetchUpgradeGraph, interpretGraphForUpgrade } = require('../../lib/dsoul-api');
const { doDeactivateFile, sameResolvedDir } = require('../../lib/skills');
const { runCliInstall } = require('./install');
async function runCliUpgrade(cliArgs, blocklist, ui) {
  const t0 = Date.now();
  ui.header('Upgrading skills');
  await ensureDataDir();
  const settings = await loadSettings();
  const globalFolder = (settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '').trim();
  const folderName = (settings.skillsFolderName != null && String(settings.skillsFolderName).trim() !== '') ? String(settings.skillsFolderName).trim() : 'skills';
  const localFolder = path.join(process.cwd(), folderName);
  const folders = [];
  if (cliArgs.globalOnly && globalFolder) folders.push({ dir: globalFolder, label: 'global' });
  else if (cliArgs.localOnly) folders.push({ dir: localFolder, label: 'local' });
  else {
    if (globalFolder) folders.push({ dir: globalFolder, label: 'global' });
    if (!globalFolder || !sameResolvedDir(globalFolder, localFolder)) folders.push({ dir: localFolder, label: 'local' });
  }

  ui.step('Scanning for upgrades');
  const toUpgrade = [];
  for (const { dir, label } of folders) {
    let data;
    try { data = await readDsoulJson(dir); } catch (e) { ui.fail('Failed to read ' + label + ' dsoul.json: ' + e.message); continue; }
    const skills = Array.isArray(data.skills) ? data.skills : [];
    for (const skill of skills) {
      const cidStr = skill.cid || '';
      const skillName = skill.shortname || cidStr || '?';
      const postIdOrLink = skill.num != null ? skill.num : (skill.src && String(skill.src).trim()) || (skill.post_id != null ? skill.post_id : (skill.post_link && String(skill.post_link).trim()) || null);
      if (postIdOrLink == null) continue;
      const result = await fetchUpgradeGraph(postIdOrLink);
      if (!result.success) continue;
      const { upgradeAvailable, latestCid } = interpretGraphForUpgrade(result.data, cidStr);
      if (upgradeAvailable && latestCid && (!blocklist || !blocklist.has(latestCid))) {
        toUpgrade.push({ currentCid: cidStr, latestCid, name: skillName, dir, label });
      }
    }
  }

  if (toUpgrade.length === 0) {
    ui.ok('All skills are up to date');
    ui.timing('Done', Date.now() - t0);
    return true;
  }

  ui.info(toUpgrade.length + ' upgrade(s) to apply');
  ui.raw('');
  let hadError = false;
  let upgraded = 0;

  for (let i = 0; i < toUpgrade.length; i++) {
    const { currentCid, latestCid, name: skillName, dir, label } = toUpgrade[i];
    ui.step(`[${i + 1}/${toUpgrade.length}] Upgrading ${ui.name(skillName)}`, `${label}`);
    ui.detail('from', ui.cid(currentCid));
    ui.detail('to', ui.cid(latestCid));

    ui.dim('  removing old version...');
    try { await updateDsoulJson(dir, 'remove', { cid: currentCid }); } catch (e) { ui.fail('update dsoul.json: ' + e.message); hadError = true; continue; }
    const deactivateResult = await doDeactivateFile(currentCid);
    if (!deactivateResult.success) ui.warn(`deactivate: ${deactivateResult.error}`);
    const deleteResult = await doDeleteFile(currentCid);
    if (!deleteResult.success) { ui.fail('delete failed:', deleteResult.error); hadError = true; continue; }

    ui.dim('  installing new version...');
    const ok = await runCliInstall(latestCid, { skillsFolder: dir, autoPickOldest: true }, latestCid, ui);
    if (ok) upgraded++; else hadError = true;
  }

  ui.raw('');
  ui.summary({ updated: upgraded, failed: hadError ? toUpgrade.length - upgraded : undefined });
  ui.timing('Upgrade complete', Date.now() - t0);
  return !hadError;
}

module.exports = { runCliUpgrade };
