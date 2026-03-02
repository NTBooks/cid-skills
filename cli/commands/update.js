const path = require('path');
const readline = require('readline');
const { loadSettings, readDsoulJson, updateDsoulJson, doDeleteFile } = require('../../lib/storage');
const { fetchUpgradeGraph, interpretGraphForUpgrade } = require('../../lib/dsoul-api');
const { doDeactivateFile, sameResolvedDir } = require('../../lib/skills');
const { getAllInstalledCids } = require('../../lib/blocklist');
const log = require('../log');

function askLine(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => { rl.close(); resolve(answer != null ? String(answer).trim() : ''); });
  });
}

async function runCliUpdate(cliArgs, blocklist) {
  const t0 = Date.now();
  log.header('Checking for updates');
  const settings = await loadSettings();
  const globalFolder = (settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '').trim();
  const folderName = (settings.skillsFolderName != null && String(settings.skillsFolderName).trim() !== '') ? String(settings.skillsFolderName).trim() : 'Skills';
  const localFolder = path.join(process.cwd(), folderName);
  const folders = [];
  if (cliArgs.globalOnly && globalFolder) folders.push({ dir: globalFolder, label: 'global' });
  else if (cliArgs.localOnly) folders.push({ dir: localFolder, label: 'local' });
  else {
    if (globalFolder) folders.push({ dir: globalFolder, label: 'global' });
    if (!globalFolder || !sameResolvedDir(globalFolder, localFolder)) folders.push({ dir: localFolder, label: 'local' });
  }

  let hadSkills = false, hadError = false;
  let upgradeCount = 0, currentCount = 0;

  for (const { dir, label } of folders) {
    let data;
    try { data = await readDsoulJson(dir); } catch (e) { log.fail(`Failed to read ${label} dsoul.json:`, e.message); hadError = true; continue; }
    const skills = Array.isArray(data.skills) ? data.skills : [];
    if (skills.length === 0) continue;
    hadSkills = true;

    log.header(`${label} (${dir})`);
    for (let i = 0; i < skills.length; i++) {
      const skill = skills[i];
      const cidStr = skill.cid || '';
      const skillName = skill.shortname || cidStr || '?';
      const postIdOrLink = skill.num != null ? skill.num : (skill.src && String(skill.src).trim()) || (skill.post_id != null ? skill.post_id : (skill.post_link && String(skill.post_link).trim()) || null);
      if (postIdOrLink == null) {
        log.dim(`  ${skillName}: no tracking info (reinstall to record)`);
        continue;
      }
      const result = await fetchUpgradeGraph(postIdOrLink);
      if (!result.success) { log.warn(`${skillName}: ${result.error}`); hadError = true; continue; }
      const { upgradeAvailable, latestCid, reason } = interpretGraphForUpgrade(result.data, cidStr);
      if (upgradeAvailable) {
        console.log(`  ${log.SYM.arrow} ${log.name(skillName)} ${log.c.yellow}upgrade available${log.c.reset} ${log.c.gray}${cidStr.slice(0, 12)}..${log.c.reset} ${log.c.green}→${log.c.reset} ${log.cid(latestCid)}`);
        upgradeCount++;
      } else {
        console.log(`  ${log.SYM.ok} ${skillName} ${log.c.gray}${reason}${log.c.reset}`);
        currentCount++;
      }
    }
  }

  if (!hadSkills) log.info('No installed skills found.');

  if (blocklist && blocklist.size > 0) {
    const installed = await getAllInstalledCids();
    const blocked = installed.filter((i) => blocklist.has(i.cid));
    if (blocked.length > 0) {
      console.log('');
      log.warn(`${blocked.length} blocked CID(s) found`);
      let yes = false;
      if (cliArgs.deleteBlocked === true) yes = true;
      else if (cliArgs.deleteBlocked === false) yes = false;
      else { const answer = await askLine(`  ${log.c.cyan}?${log.c.reset} Delete all blocked items? [y/N]: `); yes = /^y(es)?$/i.test(answer.trim()); }
      if (yes) {
        const uniqueCids = [...new Set(blocked.map((b) => b.cid))];
        for (const cid of uniqueCids) {
          const dirs = blocked.filter((b) => b.cid === cid).map((b) => b.dir);
          for (const dir of dirs) { try { await updateDsoulJson(dir, 'remove', { cid }); } catch (e) { log.fail(e.message); hadError = true; } }
          const deactivateResult = await doDeactivateFile(cid);
          if (!deactivateResult.success) log.warn(`Deactivate ${log.cid(cid)}: ${deactivateResult.error}`);
          const deleteResult = await doDeleteFile(cid);
          if (!deleteResult.success) { log.fail(`Delete ${log.cid(cid)}: ${deleteResult.error}`); hadError = true; }
          else { log.removed(`blocked: ${cid}`); }
        }
      }
    }
  }

  console.log('');
  if (upgradeCount > 0) {
    log.info(`${log.c.yellow}${upgradeCount} upgrade(s) available${log.c.reset}. Run ${log.c.bold}dsoul upgrade${log.c.reset} to apply.`);
  }
  if (currentCount > 0) log.dim(`${currentCount} skill(s) up to date`);
  log.timing('Update check complete', Date.now() - t0);
  return !hadError;
}

module.exports = { runCliUpdate };
