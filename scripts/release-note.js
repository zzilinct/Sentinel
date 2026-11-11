'use strict';
/**
 * The download page's "New in x.y.z", written from changelog/<version>.md into web/partials/release-note.html, and the
 * same note as data (web/assets/release-note.json) for What changed in the app's Settings, Help.
 * The version is package.json's, so a release writes its changelog, bumps its versions and runs this:
 *
 *   npm run build:note
 *
 * Nothing about the release is typed into web/download.html. `npm test` (which release.yml runs before it builds
 * anything) and scripts/build-static.js (which publish:site runs) refuse a partial that is out of step.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PARTIAL = path.join(ROOT, 'web', 'partials', 'release-note.html');
const JSON_NOTE = path.join(ROOT, 'web', 'assets', 'release-note.json');
const NOTES_URL = 'https://github.com/zzilinct/Sentinel/tree/main/changelog';

const esc = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lf = (text) => text.replace(/\r/g, '');

/** A changelog's title and its groups of changes. Throws rather than publish a note it could not read. */
function parseNote(text, version) {
  const lines = lf(text).split('\n').map((l) => l.trim()).filter(Boolean);
  const title = /^Sentinel (\d+\.\d+\.\d+) (\w+): (.+)$/.exec(lines[0] || '');
  if (!title) throw new Error(`changelog for ${version}: the first line must read "Sentinel ${version} <model>: <summary>"`);
  if (title[1] !== version) throw new Error(`changelog for ${version}: its title says ${title[1]}`);
  const groups = [];
  for (const line of lines.slice(1)) {
    if (/^Download \d/.test(line)) break; // The rest is the Discord footer: links and where to report problems.
    if (line.startsWith('•')) {
      if (!groups.length) throw new Error(`changelog for ${version}: a change with no group above it: ${line}`);
      groups[groups.length - 1].items.push(line.replace(/^•\s*/, ''));
    } else if (line.endsWith(':')) {
      groups.push({ title: line.slice(0, -1), items: [] });
    } else {
      throw new Error(`changelog for ${version}: not a group or a change: ${line}`);
    }
  }
  if (!groups.length || groups.some((g) => !g.items.length)) throw new Error(`changelog for ${version}: every group needs at least one change`);
  return { version, model: title[2], summary: title[3][0].toUpperCase() + title[3].slice(1), groups };
}

function renderNote(note) {
  const groups = note.groups.map((g) => `        <section>
          <h3>${esc(g.title)}</h3>
          <ul>
${g.items.map((i) => `            <li>${esc(i)}</li>`).join('\n')}
          </ul>
        </section>`).join('\n');
  return `<!-- Generated from changelog/${note.version}.md by scripts/release-note.js: npm run build:note. Do not edit. -->
<section class="section--tight relnote" aria-labelledby="relnote-title" data-release-note="${note.version}">
  <div class="wrap">
    <h2 id="relnote-title">New in Sentinel ${note.version} ${esc(note.model)}</h2>
    <p class="relnote__lead">${esc(note.summary)}.</p>
    <p class="relnote__newer" data-release-newer hidden></p>
    <details class="relnote__all">
      <summary>Every change in this version</summary>
      <div class="relnote__groups">
${groups}
      </div>
    </details>
    <a class="relnote__older" href="${NOTES_URL}">Notes for every earlier version <span class="arrow">&rarr;</span></a>
  </div>
</section>
`;
}

/** The note for the version in package.json. */
function current() {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const file = path.join(ROOT, 'changelog', `${version}.md`);
  if (!fs.existsSync(file)) throw new Error(`changelog/${version}.md does not exist. Write it, then run: npm run build:note`);
  return parseNote(fs.readFileSync(file, 'utf8'), version);
}

/** What the partial should hold. */
function expected() { return renderNote(current()); }

/** What the JSON should hold. */
function expectedJson() { return `${JSON.stringify(current(), null, 2)}
`; }

/** Throws unless the partial is what the changelog says. Line endings do not count: a Windows checkout has its own. */
function assertInStep() {
  const have = fs.existsSync(PARTIAL) ? lf(fs.readFileSync(PARTIAL, 'utf8')) : '';
  if (have !== expected()) throw new Error('web/partials/release-note.html is out of step with changelog/. Run: npm run build:note');
  const json = fs.existsSync(JSON_NOTE) ? lf(fs.readFileSync(JSON_NOTE, 'utf8')) : '';
  if (json !== expectedJson()) throw new Error('web/assets/release-note.json is out of step with changelog/. Run: npm run build:note');
}

if (require.main === module) {
  fs.writeFileSync(PARTIAL, expected());
  fs.writeFileSync(JSON_NOTE, expectedJson());
  console.log(`  release note    ${path.relative(ROOT, PARTIAL)}, ${path.relative(ROOT, JSON_NOTE)}`);
}

module.exports = { parseNote, renderNote, expected, expectedJson, assertInStep };
