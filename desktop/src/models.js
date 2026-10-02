'use strict';
/**
 * Switching models: installing a chosen release of Sentinel (server/lib/models.js names them).
 *
 * The page only says which version; everything else is looked up here, from GitHub itself: the release with that
 * tag, its installer and the latest.yml published beside it, whose SHA-512 the downloaded installer must match
 * byte for byte before it runs. The installer then runs exactly as an update does (updater.js).
 *
 * A chosen model that is not the newest is kept: the updater stops downloading newer versions until the newest is
 * chosen again. Versions older than 1.9.2 predate this and update themselves to the newest on their own.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = 'zzilinct/Sentinel';
const GITHUB = /^https:\/\/github\.com\/zzilinct\/Sentinel\/releases\/download\//;

let busy = false;

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Sentinel' }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(res.status === 404 ? 'That version is not published' : `GitHub answered ${res.status}`);
  return res.json();
}

/** The SHA-512 latest.yml gives for a file name. */
function shaFor(yml, file) {
  const lines = String(yml).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === `- url: ${file}` || lines[i].trim() === `url: ${file}`) {
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const m = /^\s*sha512:\s*(\S+)/.exec(lines[j]);
        if (m) return m[1];
      }
    }
  }
  const top = /^sha512:\s*(\S+)/m.exec(yml);   // older manifests name one file at the top level
  return top && new RegExp(`^path:\\s*${file.replace(/\./g, '\\.')}\\s*$`, 'm').test(yml) ? top[1] : null;
}

/**
 * Download and check the installer for `version`, then hand it to the updater to run.
 * @param {{ version: string, dir: string, updater: object, store: object, newest: boolean, log: Function }} o
 */
async function install({ version, dir, updater, store, newest, log, onProgress }) {
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) return { ok: false, error: 'Not a version' };
  if (busy) return { ok: false, error: 'A model is already being installed' };
  busy = true;
  try {
    const release = await getJson(`https://api.github.com/repos/${REPO}/releases/tags/v${version}`);
    const name = `Sentinel-Setup-${version}.exe`;
    const asset = (n) => (release.assets || []).find((a) => a.name === n);
    const exe = asset(name);
    const manifest = asset('latest.yml');
    if (!exe || !manifest) return { ok: false, error: `Sentinel ${version} has no installer to switch to` };
    if (!GITHUB.test(exe.browser_download_url) || !GITHUB.test(manifest.browser_download_url)) return { ok: false, error: 'Unexpected download address' };

    const yml = await (await fetch(manifest.browser_download_url, { signal: AbortSignal.timeout(15000) })).text();
    const expected = shaFor(yml, name);
    if (!expected) return { ok: false, error: 'The release does not publish a checksum for its installer' };

    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    const res = await fetch(exe.browser_download_url, { signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!res.ok || !res.body) return { ok: false, error: `The download failed (${res.status})` };
    const total = Number(res.headers.get('content-length')) || exe.size || 0;
    const hash = crypto.createHash('sha512');
    const out = fs.createWriteStream(file);
    let got = 0;
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (onProgress && total) onProgress(Math.round((got / total) * 100));
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    if (hash.digest('base64') !== expected) {
      fs.rmSync(file, { force: true });
      log(`models: ${name} did not match its published checksum; not installing it`);
      return { ok: false, error: 'The download did not match its published checksum' };
    }
    // Keep the choice (unless it is the newest, which is simply following updates again).
    store.set('modelPin', newest ? undefined : version);
    log(`models: switching to ${version}${newest ? ' (the newest: following updates again)' : ' and keeping it'}`);
    return updater.installFile({ version, file, sha512: expected });
  } catch (err) {
    return { ok: false, error: String(err && err.message || err).slice(0, 200) };
  } finally {
    busy = false;
  }
}

module.exports = { install, _test: { shaFor } };
