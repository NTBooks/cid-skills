const path = require('path');
const fs = require('fs').promises;
const { loadWpCredentials } = require('../../lib/credentials');

function buildInitSkillMdContent(authorUsername) {
  const authorLine = typeof authorUsername === 'string' && authorUsername.trim() ? 'author: ' + authorUsername.trim() : 'author: ';
  return ['---', 'name: ', 'description: ', authorLine, '---', '', ''].join('\n');
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

    ui.raw('');
    const c = ui.c || {};
    ui.ok('Skill project initialized at ' + (c.underline || '') + resolved + (c.reset || ''));
    return true;
  } catch (err) { ui.fail('Init failed: ' + (err.message || String(err))); return false; }
}

module.exports = { runCliInit };
