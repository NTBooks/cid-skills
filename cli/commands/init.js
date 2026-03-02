const path = require('path');
const fs = require('fs').promises;
const { loadWpCredentials } = require('../../lib/credentials');
const log = require('../log');

function buildInitSkillMdContent(authorUsername) {
  const authorLine = typeof authorUsername === 'string' && authorUsername.trim() ? 'author: ' + authorUsername.trim() : 'author: ';
  return ['---', 'name: ', 'description: ', authorLine, '---', '', ''].join('\n');
}

async function runCliInit(directoryArg) {
  try {
    const resolved = path.resolve(process.cwd(), directoryArg);
    log.header('Initializing skill project');
    log.detail('directory', resolved);

    const stat = await fs.stat(resolved).catch(() => null);
    if (stat) {
      if (!stat.isDirectory()) { log.fail('Path exists and is not a directory:', resolved); return false; }
      const entries = await fs.readdir(resolved, { withFileTypes: true });
      if (entries.length > 0) { log.fail('Directory is not empty:', resolved); return false; }
      log.dim('  directory exists, using it');
    } else {
      log.step('Creating directory');
      await fs.mkdir(resolved, { recursive: true });
    }

    const credentials = await loadWpCredentials();
    const skillMdContent = buildInitSkillMdContent(credentials ? credentials.username : null);

    log.step('Writing files');
    await fs.writeFile(path.join(resolved, 'skill.md'), skillMdContent, 'utf-8');
    log.added('skill.md' + (credentials ? ` (author: ${credentials.username})` : ''));
    await fs.writeFile(path.join(resolved, 'license.txt'), 'No License', 'utf-8');
    log.added('license.txt');

    console.log('');
    log.ok(`Skill project initialized at ${log.c.underline}${resolved}${log.c.reset}`);
    return true;
  } catch (err) { log.fail('Init failed:', err.message || String(err)); return false; }
}

module.exports = { runCliInit };
