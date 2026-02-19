#!/usr/bin/env node
/**
 * prepdeploy: check package.json version vs latest git tag, then tag and push.
 * Exits with code 1 if version was not updated (or on error).
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const pkgPath = path.join(rootDir, 'package.json');

function getPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const v = pkg.version;
  if (!v || typeof v !== 'string') {
    console.error('package.json has no valid "version" field.');
    process.exit(1);
  }
  return v.trim();
}

function getLatestTag() {
  try {
    const out = execSync('git tag -l "v*" --sort=-version:refname', {
      cwd: rootDir,
      encoding: 'utf-8'
    });
    const tags = out.trim().split(/\r?\n/).filter(Boolean);
    return tags.length ? tags[0] : null;
  } catch (_) {
    return null;
  }
}

function main() {
  const version = getPackageVersion();
  const tagName = `v${version}`;
  const latestTag = getLatestTag();

  if (latestTag) {
    const latestVersion = latestTag.replace(/^v/, '');
    if (latestVersion === version) {
      console.error(`Version in package.json (${version}) was not updated. Latest tag is already ${latestTag}.`);
      console.error('Bump the version in package.json before running prepdeploy.');
      process.exit(1);
    }
  }

  console.log(`Tagging ${tagName} and pushing...`);
  try {
    execSync(`git tag ${tagName}`, { cwd: rootDir, stdio: 'inherit' });
    execSync(`git push origin ${tagName}`, { cwd: rootDir, stdio: 'inherit' });
  } catch (e) {
    console.error('Tag or push failed:', e.message || e);
    process.exit(1);
  }
  console.log(`Done. Tag ${tagName} pushed.`);
}

main();
