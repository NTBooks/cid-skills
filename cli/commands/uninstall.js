const { ensureDataDir, readFileData, loadSettings, updateDsoulJson } = require('../../lib/storage');
const { doDeleteFile } = require('../../lib/storage');
const { parseCID, doDeactivateFile } = require('../../lib/skills');
const { resolveShortname } = require('../../lib/dsoul-api');

async function runCliUninstall(target, ui) {
  const t0 = Date.now();
  ui.header('Uninstalling ' + ui.name(target));
  await ensureDataDir();
  let cid = parseCID(target);
  if (!cid) {
    ui.step('Resolving shortname');
    const resolved = await resolveShortname(target);
    if (!resolved.success) { ui.fail(resolved.error); return false; }
    cid = resolved.cid;
    ui.ok('Resolved to ' + ui.cid(cid));
  }
  const existing = await readFileData(cid).catch(() => null);
  if (!existing) { ui.fail('Not installed: ' + target); return false; }

  const skillName = existing.skillMetadata?.name || target;

  ui.step('Removing from dsoul.json');
  const uninstallBaseFolder = existing.activatedSkillsFolder || (await loadSettings()).skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '';
  try { if (uninstallBaseFolder) await updateDsoulJson(uninstallBaseFolder, 'remove', { cid }); } catch (_) { }

  ui.step('Deactivating');
  const deactivateResult = await doDeactivateFile(cid);
  if (!deactivateResult.success && existing.active) {
    ui.warn('Could not deactivate: ' + deactivateResult.error);
  }

  ui.step('Deleting local data');
  const deleteResult = await doDeleteFile(cid);
  if (!deleteResult.success) { ui.fail(deleteResult.error || 'Failed to remove'); return false; }

  ui.removed(skillName);
  ui.detail('cid', ui.cid(cid));
  ui.timing('Done', Date.now() - t0);
  return true;
}

module.exports = { runCliUninstall };
