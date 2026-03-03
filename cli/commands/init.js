const path = require('path');
const fs = require('fs').promises;
const { loadWpCredentials } = require('../../lib/credentials');

const PKG_ROOT = path.resolve(__dirname, '..', '..');

function buildInitSkillMdContent(authorUsername) {
  const authorLine = typeof authorUsername === 'string' && authorUsername.trim() ? 'author: ' + authorUsername.trim() : 'author: ';
  return ['---', 'name: ', 'description: ', authorLine, '---', '', ''].join('\n');
}

function findCursorRootFromPath(p) {
  const normalized = path.resolve(p);
  const parts = normalized.split(path.sep);
  const idx = parts.indexOf('.cursor');
  if (idx >= 0) {
    const joined = parts.slice(0, idx + 1).join(path.sep);
    return joined || path.sep;
  }
  return null;
}

async function deployDsoulCliSkill(cursorRoot, ui) {
  const dsoulCliDir = path.join(cursorRoot, 'skills', 'dsoul-cli');

  const existing = await fs.stat(dsoulCliDir).catch(() => null);
  if (existing) {
    ui.dim('  dsoul-cli skill already present at ' + dsoulCliDir);
    return;
  }

  const srcSkillMd = path.join(PKG_ROOT, 'SKILL.md');
  const srcLicense = path.join(PKG_ROOT, 'LICENSE');

  const [skillMdStat, licenseStat] = await Promise.all([
    fs.stat(srcSkillMd).catch(() => null),
    fs.stat(srcLicense).catch(() => null),
  ]);

  if (!skillMdStat || !licenseStat) {
    ui.dim('  (dsoul-cli skill source not found; skipping auto-deploy)');
    return;
  }

  ui.step('Deploying dsoul-cli skill to .cursor/skills/dsoul-cli');
  await fs.mkdir(dsoulCliDir, { recursive: true });

  const [skillMdContent, licenseContent] = await Promise.all([
    fs.readFile(srcSkillMd, 'utf-8'),
    fs.readFile(srcLicense, 'utf-8'),
  ]);

  await Promise.all([
    fs.writeFile(path.join(dsoulCliDir, 'SKILL.md'), skillMdContent, 'utf-8'),
    fs.writeFile(path.join(dsoulCliDir, 'license.txt'), licenseContent, 'utf-8'),
  ]);

  ui.added('dsoul-cli SKILL.md → ' + dsoulCliDir);
  ui.added('dsoul-cli license.txt → ' + dsoulCliDir);
}

async function runCliInit(directoryArg, ui) {
  try {
    const resolved = path.resolve(process.cwd(), directoryArg);
    ui.header('Initializing skill project');
    ui.detail('directory', resolved);

    const stat = await fs.stat(resolved).catch(() => null);
    if (stat) {
      if (!stat.isDirectory()) { ui.fail('Path exists and is not a directory: ' + resolved); return false; }
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      if (entries.length > 0) { ui.fail('Directory is not empty: ' + resolved); return false; }
      ui.dim('  directory exists, using it');
    } else {
      ui.step('Creating directory');
      await fs.mkdir(resolved, { recursive: true });
    }

    const credentials = await loadWpCredentials();
    const skillMdContent = buildInitSkillMdContent(credentials ? credentials.username : null);

    ui.step('Writing files');
    await fs.writeFile(path.join(resolved, 'skill.md'), skillMdContent, 'utf-8');
    ui.added('skill.md' + (credentials ? ' (author: ' + credentials.username + ')' : ''));
    await fs.writeFile(path.join(resolved, 'license.txt'), 'No License', 'utf-8');
    ui.added('license.txt');

    const cursorRoot = findCursorRootFromPath(resolved) || findCursorRootFromPath(process.cwd());
    if (cursorRoot) {
      ui.raw('');
      await deployDsoulCliSkill(cursorRoot, ui);
    }

    ui.raw('');
    const c = ui.c || {};
    ui.ok('Skill project initialized at ' + (c.underline || '') + resolved + (c.reset || ''));
    return true;
  } catch (err) { ui.fail('Init failed: ' + (err.message || String(err))); return false; }
}

module.exports = { runCliInit };
