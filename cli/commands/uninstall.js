const { ensureDataDir, readFileData, loadSettings, updateDsoulJson } = require('../../lib/storage');
const { doDeleteFile } = require('../../lib/storage');
const { parseCID, doDeactivateFile } = require('../../lib/skills');
const { resolveShortname } = require('../../lib/dsoul-api');
const log = require('../log');

async function runCliUninstall(target) {
  const t0 = Date.now();
  log.header(`Uninstalling ${log.name(target)}`);
  await ensureDataDir();
  let cid = parseCID(target);
  if (!cid) {
    log.step('Resolving shortname');
    const resolved = await resolveShortname(target);
    if (!resolved.success) { log.fail(resolved.error); return false; }
    cid = resolved.cid;
    log.ok(`Resolved to ${log.cid(cid)}`);
  }
  const existing = await readFileData(cid).catch(() => null);
  if (!existing) { log.fail(`Not installed: ${target}`); return false; }

  const skillName = existing.skillMetadata?.name || target;

  log.step('Removing from dsoul.json');
  const uninstallBaseFolder = existing.activatedSkillsFolder || (await loadSettings()).skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '';
  try { if (uninstallBaseFolder) await updateDsoulJson(uninstallBaseFolder, 'remove', { cid }); } catch (_) { }

  log.step('Deactivating');
  const deactivateResult = await doDeactivateFile(cid);
  if (!deactivateResult.success && existing.active) {
    log.warn(`Could not deactivate: ${deactivateResult.error}`);
  }

  log.step('Deleting local data');
  const deleteResult = await doDeleteFile(cid);
  if (!deleteResult.success) { log.fail(deleteResult.error || 'Failed to remove'); return false; }

  log.removed(skillName);
  log.detail('cid', log.cid(cid));
  log.timing('Done', Date.now() - t0);
  return true;
}

module.exports = { runCliUninstall };
