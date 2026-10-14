'use strict';
/**
 * "Scan with Sentinel" in the Windows right-click menu for files (under "Show more options" on Windows 11).
 *
 * Registered for this Windows user only (HKCU, no administrator) on every start of the installed copy, so it always
 * points at that copy; taken away by the switch in the app and by the uninstaller (build/installer.nsh).
 * Choosing it starts Sentinel.exe with --scan-file=<the file>; a Sentinel already running gets that as a second
 * instance, and the app's Virus & malware scan checks the file with the scanner on this computer.
 * Signed out, there is no account to scan with: the file is checked by the on-device file scanner (the one download
 * protection uses) and the verdict shown in a small window of its own (pages/filescan.html). Nothing about the file
 * leaves the computer then.
 */
const path = require('path');
const { execFile } = require('child_process');

const KEY = 'HKCU\\Software\\Classes\\*\\shell\\SentinelScan';
const ARG = '--scan-file=';
const LABEL = 'Scan with Sentinel';

/** The command Windows runs. One quoted argument, so a file name with spaces stays whole. */
function command(exe) { return `"${exe}" "${ARG}%1"`; }

/** The file a right-click asked for, from a command line: a full path, or null. */
function fileFrom(argv) {
  const arg = (argv || []).find((a) => typeof a === 'string' && a.startsWith(ARG));
  if (!arg) return null;
  const file = arg.slice(ARG.length).trim();
  return file && path.win32.isAbsolute(file) ? file : null;
}

/** reg.exe, resolved to true when it succeeded. Never throws. */
function reg(args) {
  return new Promise((resolve) => execFile('reg', args, { windowsHide: true, timeout: 10000 }, (err) => resolve(!err)));
}

async function register(exe) {
  return await reg(['add', KEY, '/ve', '/d', LABEL, '/f'])
    && await reg(['add', KEY, '/v', 'Icon', '/d', `${exe},0`, '/f'])
    && reg(['add', `${KEY}\\command`, '/ve', '/d', command(exe), '/f']);
}

function unregister() { return reg(['delete', KEY, '/f']); }

/**
 * What the small result window shows for a file checked on this computer: its name (never its folder), the verdict in
 * download protection's words (downloads.summarize), and up to four things found when it is not clean. problem: 'big' (over the 25 MB the
 * scanner reads) or 'unreadable', when it was not checked at all.
 */
function offlineResult(file, size, summary, report, problem) {
  // A clean verdict lists nothing: "No threats found" over "Contains the classic process-injection API trio" (Google's
  // own chrome.exe) left a person unsure which to believe.
  const found = report && !problem && summary.badge
    ? report.checks.filter((c) => c.status === 'fail' || c.status === 'warn').sort((a, b) => b.points - a.points).slice(0, 4).map((c) => c.detail)
    : [];
  return {
    name: path.win32.basename(String(file)),
    size: String(Number(size) || 0),
    badge: problem ? 'none' : summary.badge || 'green',
    label: problem ? 'Not checked' : summary.label,
    problem: problem || '',
    found: found.join('\n')
  };
}

module.exports = { KEY, LABEL, command, fileFrom, register, unregister, offlineResult };
