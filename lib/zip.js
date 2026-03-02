const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const yauzl = require('yauzl');
const archiver = require('archiver');

function listZipEntryNames(zipPath) {
  return new Promise((resolve, reject) => {
    const names = [];
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.on('entry', (entry) => {
        names.push(entry.fileName.replace(/\\/g, '/'));
        zipfile.readEntry();
      });
      zipfile.on('end', () => {
        zipfile.close();
        resolve(names);
      });
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  });
}

function readAllZipFileEntries(zipPath) {
  return new Promise((resolve, reject) => {
    const entries = [];
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      const next = () => zipfile.readEntry();
      zipfile.on('entry', (entry) => {
        const fileName = entry.fileName.replace(/\\/g, '/');
        if (/\/$/.test(fileName)) { next(); return; }
        zipfile.openReadStream(entry, (readErr, readStream) => {
          if (readErr) { zipfile.close(); return reject(readErr); }
          const chunks = [];
          readStream.on('data', (chunk) => chunks.push(chunk));
          readStream.on('end', () => { entries.push({ fileName, buffer: Buffer.concat(chunks) }); next(); });
          readStream.on('error', (e) => { zipfile.close(); reject(e); });
        });
      });
      zipfile.on('end', () => { zipfile.close(); resolve(entries); });
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  });
}

function getZipSingleRootFolderName(entryNames) {
  const topLevel = new Set();
  for (const n of entryNames) {
    const idx = n.indexOf('/');
    if (idx === -1) topLevel.add(n);
    else topLevel.add(n.slice(0, idx));
  }
  const roots = [...topLevel];
  if (roots.length !== 1) return null;
  const root = roots[0];
  const allUnderRoot = entryNames.every((n) => n === root || n.startsWith(root + '/'));
  if (!allUnderRoot) return null;
  const hasSubPath = entryNames.some((n) => n.includes('/'));
  return hasSubPath ? root : null;
}

function readEntryFromZip(zipPath, entryFileName) {
  return new Promise((resolve, reject) => {
    const targetName = (entryFileName || '').toString().toLowerCase();
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }
        const entryBase = path.basename(entry.fileName).replace(/\/$/, '').toLowerCase();
        if (entryBase === targetName) {
          zipfile.openReadStream(entry, (readErr, readStream) => {
            if (readErr) { zipfile.close(); return reject(readErr); }
            const chunks = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', () => { zipfile.close(); resolve(Buffer.concat(chunks).toString('utf-8')); });
            readStream.on('error', (e) => { zipfile.close(); reject(e); });
          });
        } else { zipfile.readEntry(); }
      });
      zipfile.on('end', () => { zipfile.close(); resolve(null); });
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  });
}

function readFirstEntryFromZipWhere(zipPath, predicate) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      zipfile.on('entry', (entry) => {
        if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }
        const normalized = path.basename(entry.fileName).replace(/\/$/, '').toLowerCase();
        if (predicate(entry.fileName, normalized)) {
          zipfile.openReadStream(entry, (readErr, readStream) => {
            if (readErr) { zipfile.close(); return reject(readErr); }
            const chunks = [];
            readStream.on('data', (chunk) => chunks.push(chunk));
            readStream.on('end', () => { zipfile.close(); resolve(Buffer.concat(chunks).toString('utf-8')); });
            readStream.on('error', (e) => { zipfile.close(); reject(e); });
          });
        } else { zipfile.readEntry(); }
      });
      zipfile.on('end', () => { zipfile.close(); resolve(null); });
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  });
}

async function getZipBundleInfo(zipPath) {
  const names = await listZipEntryNames(zipPath);
  const singleRootFolderName = getZipSingleRootFolderName(names);
  const skillContent = await readEntryFromZip(zipPath, 'Skill.MD');
  return {
    hasSkillMd: !!skillContent,
    singleRootFolderName,
    skillContent: skillContent || null
  };
}

function extractEntryToFileNoOverwrite(zipfile, entry, destDir, destFileNameOverride) {
  const destFileName = destFileNameOverride != null ? destFileNameOverride : entry.fileName;
  return new Promise((resolve, reject) => {
    const destPath = path.join(destDir, destFileName);
    if (/\/$/.test(entry.fileName)) {
      const dirPath = path.join(destDir, entry.fileName);
      fs.mkdir(dirPath, { recursive: true }).then(() => resolve(), reject);
      return;
    }
    fs.stat(destPath).then(() => resolve(), (e) => {
      if (e.code !== 'ENOENT') { resolve(); return; }
      fs.mkdir(path.dirname(destPath), { recursive: true }).then(() => {
        zipfile.openReadStream(entry, (err, readStream) => {
          if (err) return reject(err);
          const writeStream = fsSync.createWriteStream(destPath);
          readStream.pipe(writeStream);
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });
      }).catch(reject);
    });
  });
}

function mapZipEntryToLocalPath(entryPath, stripPrefix, skillDir) {
  let localRelative = entryPath;
  if (stripPrefix) {
    if (entryPath === stripPrefix || entryPath === stripPrefix + '/') return null;
    if (entryPath.startsWith(stripPrefix + '/')) {
      localRelative = entryPath.slice(stripPrefix.length + 1);
    }
  }
  if (!localRelative || /\/$/.test(localRelative)) return null;
  return path.join(skillDir, localRelative);
}

function isLikelyText(buffer) {
  if (!buffer || buffer.length === 0) return true;
  const len = Math.min(buffer.length, 8192);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return false;
  }
  return true;
}

function isZipMisconfigured(zipPath) {
  return new Promise((resolve) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) { resolve(false); return; }
      const names = [];
      zipfile.on('entry', (entry) => {
        names.push(entry.fileName.replace(/\\/g, '/'));
        zipfile.readEntry();
      });
      zipfile.on('end', () => {
        zipfile.close();
        const topLevel = new Set();
        for (const n of names) {
          const idx = n.indexOf('/');
          if (idx === -1) topLevel.add(n);
          else topLevel.add(n.slice(0, idx));
        }
        const roots = [...topLevel];
        const singleRootDir = roots.length === 1 && names.some((n) => n.includes('/'));
        const allUnderOneDir = singleRootDir && names.every((n) => n.startsWith(roots[0] + '/') || n === roots[0] + '/');
        resolve(!!(singleRootDir && allUnderOneDir));
      });
      zipfile.readEntry();
    });
  });
}

async function createZipFromDirectory(folderPath, outputPath) {
  const output = fsSync.createWriteStream(outputPath);
  const archive = archiver('zip', { zlib: { level: 9 } });
  await new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', (err) => reject(err));
    archive.on('warning', (err) => { if (err.code !== 'ENOENT') reject(err); });
    archive.pipe(output);
    archive.directory(folderPath, false);
    archive.finalize();
  });
}

module.exports = {
  listZipEntryNames,
  readAllZipFileEntries,
  getZipSingleRootFolderName,
  readEntryFromZip,
  readFirstEntryFromZipWhere,
  getZipBundleInfo,
  extractEntryToFileNoOverwrite,
  mapZipEntryToLocalPath,
  isLikelyText,
  isZipMisconfigured,
  createZipFromDirectory
};
