const path = require('path');
const { ensureDataDir, loadSettings, readDsoulJson, updateDsoulJson, doDeleteFile } = require('../../lib/storage');
const { fetchUpgradeGraph, interpretGraphForUpgrade } = require('../../lib/dsoul-api');
const { doDeactivateFile, sameResolvedDir } = require('../../lib/skills');
const { runCliInstall } = require('./install');
const log = require('../log');

async function runCliUpgrade(cliArgs, blocklist) {
  const t0 = Date.now();
  log.header('Upgrading skills');
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

  log.step('Scanning for upgrades');
  const toUpgrade = [];
  for (const { dir, label } of folders) {
    let data;
    try { data = await readDsoulJson(dir); } catch (e) { log.fail(`Failed to read ${label} dsoul.json:`, e.message); continue; }
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
    log.ok('All skills are up to date');
    log.timing('Done', Date.now() - t0);
    return true;
  }

  log.info(`${toUpgrade.length} upgrade(s) to apply`);
  console.log('');
  let hadError = false;
  let upgraded = 0;

  for (let i = 0; i < toUpgrade.length; i++) {
    const { currentCid, latestCid, name: skillName, dir, label } = toUpgrade[i];
    log.step(`[${i + 1}/${toUpgrade.length}] Upgrading ${log.name(skillName)}`, `${label}`);
    log.detail('from', log.cid(currentCid));
    log.detail('to', log.cid(latestCid));

    log.dim('  removing old version...');
    try { await updateDsoulJson(dir, 'remove', { cid: currentCid }); } catch (e) { log.fail('update dsoul.json:', e.message); hadError = true; continue; }
    const deactivateResult = await doDeactivateFile(currentCid);
    if (!deactivateResult.success) log.warn(`deactivate: ${deactivateResult.error}`);
    const deleteResult = await doDeleteFile(currentCid);
    if (!deleteResult.success) { log.fail('delete failed:', deleteResult.error); hadError = true; continue; }

    log.dim('  installing new version...');
    const ok = await runCliInstall(latestCid, { skillsFolder: dir, autoPickOldest: true }, latestCid);
    if (ok) upgraded++; else hadError = true;
  }

  console.log('');
  log.summary({ updated: upgraded, failed: hadError ? toUpgrade.length - upgraded : undefined });
  log.timing('Upgrade complete', Date.now() - t0);
  return !hadError;
}

module.exports = { runCliUpgrade };
