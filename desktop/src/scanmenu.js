'use strict';
/**
 * "Scan with Sentinel" in the Windows right-click menu for files (under "Show more options" on Windows 11).
 *
 * Registered for this Windows user only (HKCU, no administrator) on every start of the installed copy, so it always
 * points at that copy; taken away by the switch in the app and by the uninstaller (build/installer.nsh).
 * Choosing it starts Sentinel.exe with --scan-file=<the file>; a Sentinel already running gets that as a second
 * instance, and the app's Virus & malware scan checks the file with the scanner on this computer.
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

module.exports = { KEY, LABEL, command, fileFrom, register, unregister };
