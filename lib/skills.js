const path = require('path');
const fs = require('fs').promises;
const yauzl = require('yauzl');
const { getFilesDir } = require('./config');
const { loadSettings, readFileData, saveFileData, updateDsoulJson } = require('./storage');
const { getZipBundleInfo, extractEntryToFileNoOverwrite } = require('./zip');
const { resolvePostIdFromEntry } = require('./dsoul-api');

function parseCID(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (trimmed.startsWith('ipfs://')) {
    return trimmed.substring(7).split('/')[0].trim() || null;
  }
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z0-9]{58,}|z[a-z0-9]+)$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

function parseSkillHeaderForCli(content) {
  if (typeof content !== 'string') return null;
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (frontmatterMatch) {
    const nameMatch = frontmatterMatch[1].match(/\bname\s*:\s*(.+?)(?:\n|$)/);
    if (nameMatch) {
      const v = nameMatch[1].trim().replace(/^["']|["']$/g, '');
      if (v) return { name: v };
    }
  }
  const h1Match = content.match(/^#+\s*(?:Persona|Skill|Agent|Assistant)?:?\s*(.+?)(?:\s*\([^)]+\))?\s*$/m)
    || content.match(/^#\s+(.+)$/m);
  if (h1Match) {
    const name = h1Match[1].trim().replace(/\s*\([^)]+\)\s*$/, '').trim();
    if (name) return { name };
  }
  return null;
}

function getFileSafeSkillName(fileData) {
  let raw = (fileData.skillMetadata?.name || fileData.dsoulEntry?.name || fileData.zipRootFolderName || fileData.cid || 'skill').trim();
  raw = raw.replace(/\.zip$/i, '').trim() || raw;
  const safe = raw.replace(/[\s\\/:*?"<>|]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'skill';
  return safe;
}

async function getSkillDirNoConflict(skillsFolder, fileSafeName) {
  let name = fileSafeName;
  let dir = path.join(skillsFolder, name);
  let n = 0;
  for (;;) {
    try {
      await fs.access(dir);
      n++;
      name = `${fileSafeName}_${n}`;
      dir = path.join(skillsFolder, name);
    } catch (e) {
      if (e.code === 'ENOENT') break;
      throw e;
    }
  }
  return { skillDir: dir, folderName: name };
}

async function doActivateFile(cid, options) {
  const dataDir = getFilesDir();
  try {
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    const fileData = JSON.parse(content);

    const settings = await loadSettings();
    const baseFolder = (options && options.skillsFolderOverride != null && options.skillsFolderOverride !== '')
      ? options.skillsFolderOverride
      : (settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '');
    if (!baseFolder) {
      return { success: false, error: 'Skills folder not set. Please configure it in Options or set DSOUL_SKILLS_FOLDER.' };
    }

    if ((fileData.is_skill_bundle || fileData.is_bundle) && !fileData.zipRootFolderName) {
      const zipPathForInfo = path.join(dataDir, `${cid}.zip`);
      try {
        const info = await getZipBundleInfo(zipPathForInfo);
        if (info.singleRootFolderName) fileData.zipRootFolderName = info.singleRootFolderName;
      } catch (_) { /* non-fatal */ }
    }

    const baseFolderResolved = path.resolve(baseFolder);
    const sameFolder = fileData.activatedFolderName && fileData.activatedSkillsFolder &&
      path.resolve(fileData.activatedSkillsFolder) === baseFolderResolved;

    let skillDir;
    let folderName;
    if (sameFolder) {
      folderName = fileData.activatedFolderName;
      skillDir = path.join(baseFolder, folderName);
      try { await fs.rm(skillDir, { recursive: true, force: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await fs.mkdir(skillDir, { recursive: true });
    } else {
      const fileSafeName = getFileSafeSkillName(fileData);
      const result = await getSkillDirNoConflict(baseFolder, fileSafeName);
      skillDir = result.skillDir;
      folderName = result.folderName;
      await fs.mkdir(skillDir, { recursive: true });
    }

    if (fileData.is_skill_bundle || fileData.is_bundle) {
      const zipPath = path.join(dataDir, `${cid}.zip`);
      let stripPrefix = fileData.zipRootFolderName || null;
      if (!stripPrefix) {
        const info = await getZipBundleInfo(zipPath);
        stripPrefix = info.singleRootFolderName;
        if (stripPrefix) fileData.zipRootFolderName = stripPrefix;
      }
      await new Promise((resolve, reject) => {
        let resolved = false;
        yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
          if (err) return reject(err);
          zipfile.on('entry', (entry) => {
            let entryPath = entry.fileName.replace(/\\/g, '/');
            let destOverride = null;
            if (stripPrefix) {
              if (entryPath.startsWith(stripPrefix + '/')) {
                destOverride = entryPath.slice(stripPrefix.length + 1);
              } else if (entryPath === stripPrefix || entryPath === stripPrefix + '/') {
                zipfile.readEntry();
                return;
              }
            }
            if (destOverride === '' || (destOverride != null && /\/$/.test(destOverride))) {
              zipfile.readEntry();
              return;
            }
            if (destOverride == null) {
              const baseLower = path.basename(entry.fileName).replace(/\/$/, '').toLowerCase();
              destOverride = baseLower === 'skill.md' ? 'skill.md' : null;
            }
            extractEntryToFileNoOverwrite(zipfile, entry, skillDir, destOverride).then(() => {
              zipfile.readEntry();
            }, (e) => {
              if (!resolved) { resolved = true; try { zipfile.close(); } catch (_) { } reject(e); }
            });
          });
          zipfile.on('end', () => {
            if (!resolved) { resolved = true; try { zipfile.close(); } catch (_) { } resolve(); }
          });
          zipfile.on('error', (e) => {
            if (e && (e.message === 'closed' || e.message === 'Closed')) return;
            if (!resolved) { resolved = true; try { zipfile.close(); } catch (_) { } reject(e); }
          });
          zipfile.readEntry();
        });
      });
    } else {
      const skillMdPath = path.join(skillDir, 'skill.md');
      await fs.writeFile(skillMdPath, fileData.content, 'utf-8');
    }

    fileData.active = true;
    fileData.activatedFolderName = folderName;
    fileData.activatedSkillsFolder = baseFolder;
    await fs.writeFile(filepath, JSON.stringify(fileData, null, 2), 'utf-8');

    try {
      const { getProviderHostname } = require('./dsoul-api');
      const { postId, postLink } = resolvePostIdFromEntry(fileData.dsoulEntry);
      const hostname = await getProviderHostname();
      await updateDsoulJson(baseFolder, 'add', { cid, shortname: null, post_id: postId, post_link: postLink || null, hostname: hostname || null });
    } catch (_) { }

    return { success: true };
  } catch (error) {
    console.error('Error activating file:', error);
    return { success: false, error: error.message };
  }
}

async function doDeactivateFile(cid) {
  const dataDir = getFilesDir();
  try {
    const filename = `${cid}.json`;
    const filepath = path.join(dataDir, filename);
    const content = await fs.readFile(filepath, 'utf-8');
    const fileData = JSON.parse(content);

    const settings = await loadSettings();
    const baseFolder = fileData.activatedSkillsFolder || settings.skillsFolder || process.env.DSOUL_SKILLS_FOLDER || '';

    try {
      if (baseFolder) await updateDsoulJson(baseFolder, 'remove', { cid });
    } catch (_) { }

    if (fileData.activatedFolderName) {
      if (!baseFolder) {
        return { success: false, error: 'Skills folder not set and activation path unknown.' };
      }
      const skillDir = path.join(baseFolder, fileData.activatedFolderName);
      try { await fs.rm(skillDir, { recursive: true, force: true }); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      delete fileData.activatedFolderName;
      delete fileData.activatedSkillsFolder;
    } else if (baseFolder) {
      if (fileData.is_skill_bundle || fileData.is_bundle) {
        const zipPath = path.join(dataDir, `${cid}.zip`);
        const entries = await new Promise((resolve, reject) => {
          const list = [];
          yauzl.open(zipPath, { lazyEntries: false }, (err, zipfile) => {
            if (err) return reject(err);
            zipfile.on('entry', (entry) => list.push(entry.fileName));
            zipfile.on('end', () => { zipfile.close(); resolve(list); });
            zipfile.on('error', reject);
          });
        });
        for (const fileName of entries) {
          if (/\/$/.test(fileName)) continue;
          const fullPath = path.join(baseFolder, fileName);
          try { await fs.unlink(fullPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        }
      } else {
        const skillsFilePath = path.join(baseFolder, `${cid}.MD`);
        try { await fs.unlink(skillsFilePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }

    fileData.active = false;
    await fs.writeFile(filepath, JSON.stringify(fileData, null, 2), 'utf-8');

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function sameResolvedDir(dirA, dirB) {
  if (!dirA || !dirB) return false;
  return path.resolve(dirA) === path.resolve(dirB);
}

module.exports = {
  parseCID,
  parseSkillHeaderForCli,
  getFileSafeSkillName,
  getSkillDirNoConflict,
  doActivateFile,
  doDeactivateFile,
  sameResolvedDir
};
