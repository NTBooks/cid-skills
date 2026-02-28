#!/usr/bin/env node
/**
 * prepdeploy: ensure version bump is committed, then push branch and tag.
 * - Refuses to run if package.json version is not committed (avoids tagging a commit that has the old version).
 * - Pushes current branch first so the tagged commit is on the remote.
 * - Creates and pushes tag v{version}. Exits with code 1 if version was not updated or on error.
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

function getCommittedVersion() {
  try {
    const out = execSync('git show HEAD:package.json', {
      cwd: rootDir,
      encoding: 'utf-8'
    });
    const pkg = JSON.parse(out);
    const v = pkg && pkg.version;
    return typeof v === 'string' ? v.trim() : null;
  } catch (_) {
    return null;
  }
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

function getCurrentBranch() {
  try {
    const out = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: rootDir,
      encoding: 'utf-8'
    });
    const branch = out.trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch (_) {
    return null;
  }
}

function main() {
  const version = getPackageVersion();
  const committedVersion = getCommittedVersion();
  const tagName = `v${version}`;
  const latestTag = getLatestTag();

  if (committedVersion !== version) {
    console.error(`Version in package.json (${version}) is not committed. Current HEAD has version ${committedVersion || 'unknown'}.`);
    console.error('Commit the version bump, then run prepdeploy so the tag points at the right build.');
    process.exit(1);
  }

  if (latestTag) {
    const latestVersion = latestTag.replace(/^v/, '');
    if (latestVersion === version) {
      console.error(`Version in package.json (${version}) was not updated. Latest tag is already ${latestTag}.`);
      console.error('Bump the version in package.json before running prepdeploy.');
      process.exit(1);
    }
  }

  const branch = getCurrentBranch();
  if (branch) {
    console.log(`Pushing ${branch} so the tagged commit is on the remote...`);
    try {
      execSync(`git push origin ${branch}`, { cwd: rootDir, stdio: 'inherit' });
    } catch (e) {
      console.error('Push failed:', e.message || e);
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
