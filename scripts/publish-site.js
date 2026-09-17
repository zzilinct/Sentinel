'use strict';
/**
 * Publishes the static site into the repository GitHub Pages serves it from.
 *
 *   node scripts/publish-site.js
 *   node scripts/publish-site.js --repo wyattbombara/sentinel --site https://wyattbombara.github.io/sentinel
 *
 * The site's source lives in this repository; the Pages repository only ever
 * receives build output. This script builds web/ with scripts/build-static.js,
 * clones the Pages repository, replaces its contents with the build (keeping
 * its workflow and notes), and pushes one commit that names the source
 * revision. Pushing uses whatever git credentials this machine already has;
 * nothing is stored here.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const REPO = argOf('--repo', 'wyattbombara/sentinel');
const BRANCH = argOf('--branch', 'main');
const SITE = argOf('--site', 'https://wyattbombara.github.io/sentinel').replace(/\/$/, '');
// Files in the Pages repository that are its own, not build output.
const KEEP = new Set(['.git', '.github', 'README.md', 'SERVER-REPORT.md', 'tests']);

const NOTE = `<!-- built-from -->
> **This repository holds build output.** The site is generated from
> [zzilinct/Sentinel](https://github.com/zzilinct/Sentinel) (\`web/\`) by
> \`scripts/publish-site.js\`. Edit the source there; changes made here are
> overwritten on the next publish.

`;

const git = (cwd, ...cmd) => execFileSync('git', cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

function main() {
  const source = git(ROOT, 'rev-parse', '--short', 'HEAD');
  if (git(ROOT, 'status', '--porcelain')) console.warn('  note: publishing with uncommitted local changes');

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'sentinel-publish-'));
  const build = path.join(work, 'build');
  const clone = path.join(work, 'pages');

  console.log(`  building site for ${SITE}`);
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-static.js'), '--out', build, '--origin', SITE], { cwd: ROOT, stdio: 'inherit' });

  console.log(`  cloning ${REPO}`);
  git(work, 'clone', '--quiet', '--depth', '1', '--branch', BRANCH, `https://github.com/${REPO}.git`, clone);

  for (const entry of fs.readdirSync(clone)) {
    if (!KEEP.has(entry)) fs.rmSync(path.join(clone, entry), { recursive: true, force: true });
  }
  fs.cpSync(build, clone, { recursive: true });

  const readme = path.join(clone, 'README.md');
  const existing = fs.existsSync(readme) ? fs.readFileSync(readme, 'utf8') : '';
  if (!existing.includes('<!-- built-from -->')) fs.writeFileSync(readme, NOTE + existing);

  git(clone, 'add', '-A');
  if (!git(clone, 'status', '--porcelain')) { console.log('  nothing to publish: the site is already current'); return; }

  git(clone, '-c', 'user.name=Sentinel publish', '-c', 'user.email=publish@usesentinel.technology',
    'commit', '--quiet', '-m', `Publish site from zzilinct/Sentinel@${source}`);
  git(clone, 'push', '--quiet', 'origin', BRANCH);
  console.log(`  pushed to ${REPO}:${BRANCH} (source ${source})`);
  console.log(`  Pages will redeploy shortly: ${SITE}/`);
}

main();
