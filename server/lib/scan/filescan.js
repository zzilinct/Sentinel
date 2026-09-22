'use strict';
/**
 * Static virus & malware analysis of a single file.
 *
 * Nothing is ever executed, unpacked to disk or stored: the file is inspected in
 * memory and only its SHA-256 is kept. Archives are listed from their central
 * directory and only small entries are inflated, with a hard ratio cap against
 * zip bombs.
 *
 *   virus   - malicious or disguised program files (signatures, known hashes,
 *             executables pretending to be documents, executables inside archives)
 *   malware - hostile behaviour inside other files (macros, droppers, stealers,
 *             weaponised PDFs, shortcut and HTML payloads)
 */
const crypto = require('crypto');
const zlib = require('zlib');
const L = require('./lists');

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_INFLATE = 8 * 1024 * 1024;

// SHA-256 of the industry-standard EICAR antivirus test file. The file itself
// is deliberately not embedded in this source, so no scanner quarantines us.
const EICAR_SHA256 = '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f';
const EICAR_MARKER = ['EICAR', '-STANDARD-ANTIVIRUS-TEST-FILE!'].join('');

// The server looks hashes up in its database; the desktop app passes its own lookup.
let defaultLookup = null;
function dbLookup(sha) {
  if (!defaultLookup) {
    const { db } = require('../db');
    const stmt = db.prepare('SELECT threat, name, source FROM file_hashes WHERE sha256 = ?');
    defaultLookup = (h) => stmt.get(h) || null;
  }
  return defaultLookup(sha);
}

const fail = (points, detail) => ({ status: 'fail', points, detail });
const warn = (points, detail) => ({ status: 'warn', points, detail });
const pass = (detail) => ({ status: 'pass', points: 0, detail });
const skip = (detail) => ({ status: 'skip', points: 0, detail });

/* ------------------------------------------------------------ file types */

function sniff(buf) {
  const hex = buf.subarray(0, 8).toString('hex');
  const ascii = buf.subarray(0, 8).toString('latin1');
  if (buf.length >= 2 && buf[0] === 0x4d && buf[1] === 0x5a) return 'pe';
  if (hex.startsWith('7f454c46')) return 'elf';
  if (['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe'].includes(hex.slice(0, 8))) return 'macho';
  if (hex.startsWith('504b0304') || hex.startsWith('504b0506')) return 'zip';
  if (hex.startsWith('d0cf11e0a1b11ae1')) return 'ole';
  if (ascii.startsWith('%PDF')) return 'pdf';
  if (buf.length >= 76 && buf.subarray(0, 20).toString('hex') === '4c0000000114020000000000c000000000000046') return 'lnk';
  if (hex.startsWith('526172211a07')) return 'rar';
  if (hex.startsWith('377abcaf271c')) return '7z';
  if (hex.startsWith('1f8b')) return 'gzip';
  if (buf.length > 0x8006 && buf.subarray(0x8001, 0x8006).toString('latin1') === 'CD001') return 'iso';
  const head = buf.subarray(0, 512).toString('utf8').toLowerCase();
  if (/<!doctype html|<html|<script|<form/.test(head)) return 'html';
  if (/^\s*(\{|\[)/.test(head) && buf.length < MAX_INFLATE) return 'json';
  // Printable enough to be a text/script file?
  const sample = buf.subarray(0, 2048);
  let printable = 0;
  for (const b of sample) if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127)) printable++;
  if (sample.length && printable / sample.length > 0.92) return 'text';
  return 'binary';
}

function entropy(buf) {
  if (!buf.length) return 0;
  const counts = new Array(256).fill(0);
  const sample = buf.length > 4 * 1024 * 1024 ? buf.subarray(0, 4 * 1024 * 1024) : buf;
  // Indexed reads avoid iterator overhead across a multi-megabyte sample.
  for (let i = 0; i < sample.length; i++) counts[sample[i]]++;
  let e = 0;
  for (const n of counts) {
    if (!n) continue;
    const p = n / sample.length;
    e -= p * Math.log2(p);
  }
  return e;
}

/* ------------------------------------------------------------------- zip */

/** List zip entries from the central directory (no extraction). */
function zipEntries(buf) {
  const entries = [];
  const minEocd = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return entries;
  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && n < 5000 && ptr + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(ptr + 8);
    const method = buf.readUInt16LE(ptr + 10);
    const compressed = buf.readUInt32LE(ptr + 20);
    const size = buf.readUInt32LE(ptr + 24);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString('utf8');
    entries.push({ name, flags, encrypted: Boolean(flags & 1), method, compressed, size, localOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buf, entry) {
  if (entry.encrypted || entry.size > MAX_INFLATE) return null;
  if (entry.compressed && entry.size / entry.compressed > 200) return null;        // zip bomb
  const o = entry.localOffset;
  if (o + 30 > buf.length || buf.readUInt32LE(o) !== 0x04034b50) return null;
  const start = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const data = buf.subarray(start, start + entry.compressed);
  try {
    if (entry.method === 0) return data;
    if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_INFLATE });
  } catch { /* corrupt entry */ }
  return null;
}

/* ---------------------------------------------------------------- checks */

function extOf(name) {
  const parts = String(name || '').toLowerCase().split('.');
  return parts.length > 1 ? parts.slice(1) : [];
}

const SCRIPT_DROPPER = /(powershell(\.exe)?\s+[^\n]{0,80}-(e|enc|encodedcommand)\b|invoke-expression|\biex\s*\(|downloadstring|downloadfile|frombase64string|wscript\.shell|activexobject|certutil(\.exe)?\s+-urlcache|bitsadmin\s+\/transfer|mshta(\.exe)?\s+http|regsvr32\s+\/s\s+\/n\s+\/u\s+\/i:http|start-bitstransfer|net\.webclient)/gi;
const STEALER = [/\\login data/i, /wallet\.dat/i, /telegram desktop\\tdata/i, /discord\\local storage/i, /\\cookies\b.*chrome/i, /exodus\\exodus\.wallet/i, /metamask/i, /\\mozilla\\firefox\\profiles/i];
const INJECTION = ['VirtualAllocEx', 'WriteProcessMemory', 'CreateRemoteThread'];
const KEYLOG = ['GetAsyncKeyState', 'SetWindowsHookExA', 'SetWindowsHookExW'];

function scanFile(buf, name = 'upload', { lookupHash = dbLookup } = {}) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('scanFile expects a Buffer');
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const type = sniff(buf);
  const exts = extOf(name);
  const ext = exts[exts.length - 1] || '';
  const latin = buf.length <= MAX_INFLATE ? buf.toString('latin1') : buf.subarray(0, MAX_INFLATE).toString('latin1');
  // Windows scripts and shortcut strings are commonly stored as UTF-16.
  const sample = buf.subarray(0, MAX_INFLATE);
  let text = latin;
  if (sample[0] === 0xff && sample[1] === 0xfe) text = sample.subarray(2).toString('utf16le');
  else if (sample[0] === 0xfe && sample[1] === 0xff) {
    text = Buffer.from(sample.subarray(2, sample.length - sample.length % 2)).swap16().toString('utf16le');
  } else if (type === 'lnk') text += '\n' + sample.toString('utf16le');
  const lower = text.toLowerCase();
  const evidence = { virus: null, malware: null };
  const checks = [];
  const add = (id, threat, title, result) => checks.push({ id, threat, group: 'File analysis', title, ...result });

  // F01 - known hashes
  const known = sha256 === EICAR_SHA256 ? { threat: 'virus', name: 'EICAR-Test-File', source: 'eicar' } : lookupHash(sha256);
  if (known) {
    evidence[known.threat] = `Known ${known.threat}: ${known.name || 'malicious file'}`;
    add('F01', known.threat, 'File is not a known malicious sample', fail(100, `SHA-256 matches ${known.name || 'a known sample'} (${known.source})`));
  } else {
    add('F01', 'virus', 'File is not a known malicious sample', pass('Hash not in any threat list'));
  }

  // F02 - EICAR signature inside the content (e.g. wrapped in another file)
  if (latin.includes(EICAR_MARKER)) {
    evidence.virus = evidence.virus || 'EICAR antivirus test signature';
    add('F02', 'virus', 'No antivirus test signature', fail(100, 'Contains the EICAR test-virus signature'));
  } else {
    add('F02', 'virus', 'No antivirus test signature', pass('Not present'));
  }

  // F03 / F04 - executables and disguise
  const executable = ['pe', 'elf', 'macho'].includes(type);
  const claimsDocument = L.DOC_EXT.has(ext);
  if (executable && claimsDocument) {
    add('F03', 'virus', 'File is what its name says it is', fail(55, `Named ".${ext}" but is actually a ${type.toUpperCase()} program`));
  } else if (!executable && L.EXECUTABLE_EXT.has(ext) && claimsDocument) {
    add('F03', 'virus', 'File is what its name says it is', fail(30, 'Name and contents disagree'));
  } else {
    add('F03', 'virus', 'File is what its name says it is', pass(`Detected type: ${type}`));
  }
  add('F04', 'virus', 'Not a program file', executable
    ? warn(18, `${type.toUpperCase()} executable - only run programs from publishers you trust`)
    : pass('Not an executable'));

  // F05 - double extension
  if (exts.length >= 2 && L.DOC_EXT.has(exts[exts.length - 2]) && (L.EXECUTABLE_EXT.has(ext) || L.ARCHIVE_EXT.has(ext))) {
    add('F05', 'virus', 'No disguised double extension', fail(45, `"${name}" hides a .${ext} behind .${exts[exts.length - 2]}`));
  } else {
    add('F05', 'virus', 'No disguised double extension', pass('Single, honest extension'));
  }

  // F06 - packed executable
  if (executable) {
    const e = entropy(buf);
    add('F06', 'malware', 'Program is not packed to hide its code', e > 7.3 ? warn(14, `Very high entropy (${e.toFixed(2)} bits/byte) - packed or encrypted`) : pass(`Entropy ${e.toFixed(2)}`));
  } else {
    add('F06', 'malware', 'Program is not packed to hide its code', skip('Not an executable'));
  }

  // F07 - stealer / injection / keylogger strings in programs
  if (executable) {
    const stealer = STEALER.filter((rx) => rx.test(latin)).length;
    const inject = INJECTION.every((s) => latin.includes(s));
    const keylog = KEYLOG.some((s) => latin.includes(s)) && /keylog|keystroke/i.test(latin);
    if (stealer >= 2) add('F07', 'malware', 'No password or wallet stealing behaviour', fail(70, `References ${stealer} browser/wallet credential stores`));
    else if (inject) add('F07', 'malware', 'No password or wallet stealing behaviour', warn(22, 'Contains the classic process-injection API trio'));
    else if (keylog) add('F07', 'malware', 'No password or wallet stealing behaviour', fail(40, 'Keylogger behaviour'));
    else add('F07', 'malware', 'No password or wallet stealing behaviour', pass('No stealer indicators'));
  } else {
    add('F07', 'malware', 'No password or wallet stealing behaviour', skip('Not an executable'));
  }

  // F08 - script droppers (text, scripts, HTA, shortcuts, documents)
  const droppers = [...new Set((lower.match(SCRIPT_DROPPER) || []).map((s) => s.trim().slice(0, 40)))];
  const scriptFile = ['js', 'jse', 'vbs', 'vbe', 'ps1', 'bat', 'cmd', 'hta', 'wsf', 'lnk'].includes(ext);
  if (droppers.length >= 2 || (droppers.length && scriptFile)) {
    const points = droppers.length >= 2 && scriptFile ? 65 : 50;
    add('F08', 'malware', 'Does not download and run hidden code', fail(points, `Download-and-execute commands: ${droppers.slice(0, 3).join(', ')}`));
  } else if (droppers.length) {
    add('F08', 'malware', 'Does not download and run hidden code', warn(18, `Suspicious command: ${droppers[0]}`));
  } else {
    add('F08', 'malware', 'Does not download and run hidden code', pass('No dropper commands'));
  }

  // F09 - Office macros
  let entries = [];
  if (type === 'zip') entries = zipEntries(buf);
  const ooxmlMacro = entries.some((e) => /vbaproject\.bin$/i.test(e.name));
  const oleMacro = type === 'ole' && /_vba_project|vba\x00|macros\//i.test(latin);
  let macroText = latin;
  if (ooxmlMacro) {
    const vba = readZipEntry(buf, entries.find((e) => /vbaproject\.bin$/i.test(e.name)));
    if (vba) macroText = vba.toString('latin1');
  }
  if (ooxmlMacro || oleMacro) {
    const autoRun = /auto_?open|document_open|workbook_open|autoexec|auto_close/i.test(macroText);
    add('F09', 'malware', 'Document has no auto-running macros', autoRun
      ? fail(55, 'Contains macros set to run as soon as the document opens')
      : fail(36, 'Contains VBA macros - only enable them for documents you expected'));
  } else {
    add('F09', 'malware', 'Document has no auto-running macros', ['zip', 'ole'].includes(type) ? pass('No macros') : skip('Not an Office document'));
  }

  // F10 - weaponised PDF
  if (type === 'pdf') {
    const js = /\/javascript|\/js\s*[(<]/i.test(latin);
    const launch = /\/launch/i.test(latin);
    const openAction = /\/openaction|\/aa\s*<</i.test(latin);
    const embedded = /\/embeddedfile/i.test(latin);
    if (launch || (js && openAction)) add('F10', 'malware', 'PDF does not run code when opened', fail(45, launch ? 'PDF tries to launch a program' : 'PDF runs JavaScript on open'));
    else if (js || embedded) add('F10', 'malware', 'PDF does not run code when opened', warn(16, js ? 'PDF contains JavaScript' : 'PDF carries an embedded file'));
    else add('F10', 'malware', 'PDF does not run code when opened', pass('Plain PDF'));
  } else {
    add('F10', 'malware', 'PDF does not run code when opened', skip('Not a PDF'));
  }

  // F11 - archives
  if (type === 'zip') {
    const risky = entries.filter((e) => {
      const x = extOf(e.name);
      return L.EXECUTABLE_EXT.has(x[x.length - 1]) || L.MACRO_DOC_EXT.has(x[x.length - 1]);
    });
    const encrypted = entries.some((e) => e.encrypted);
    const isOffice = entries.some((e) => /^\[content_types\]\.xml$/i.test(e.name));
    const isApk = entries.some((e) => e.name === 'AndroidManifest.xml');
    const disguised = risky.filter((e) => {
      const x = extOf(e.name.split('/').pop());
      return x.length >= 2 && L.DOC_EXT.has(x[x.length - 2]);
    });
    if (!isOffice && !isApk && disguised.length) {
      add('F11', 'virus', 'Archive holds no programs', fail(55, `Hides the program "${disguised[0].name}" behind a document-style name`));
    } else if (!isOffice && !isApk && risky.length) {
      add('F11', 'virus', 'Archive holds no programs', fail(encrypted ? 45 : 32, `Contains ${risky.slice(0, 3).map((e) => e.name).join(', ')}${encrypted ? ' in a password-protected archive' : ''}`));
    } else if (encrypted) {
      add('F11', 'virus', 'Archive holds no programs', warn(20, 'Password-protected archive - a common trick to get past email scanners'));
    } else {
      add('F11', 'virus', 'Archive holds no programs', pass(`${entries.length} entries, none executable`));
    }

    // F12 - Android banking-trojan permissions
    if (isApk) {
      const manifest = readZipEntry(buf, entries.find((e) => e.name === 'AndroidManifest.xml'));
      const text = manifest ? manifest.toString('utf16le') + manifest.toString('latin1') : '';
      const perms = ['BIND_ACCESSIBILITY_SERVICE', 'RECEIVE_SMS', 'READ_SMS', 'SYSTEM_ALERT_WINDOW', 'BIND_DEVICE_ADMIN', 'REQUEST_INSTALL_PACKAGES'].filter((perm) => text.includes(perm));
      add('F12', 'malware', 'Android app does not request takeover permissions', perms.length >= 3
        ? fail(45, `Requests ${perms.join(', ')} - the banking-trojan combination`)
        : perms.length ? warn(12, `Requests ${perms.join(', ')}`) : pass('Ordinary permissions'));
    }
  } else {
    add('F11', 'virus', 'Archive holds no programs', ['rar', '7z', 'gzip'].includes(type) ? warn(8, `${type.toUpperCase()} archive contents cannot be listed - open with care`) : skip('Not an archive'));
  }

  // F13 - shortcut and disk-image delivery tricks
  if (type === 'lnk') {
    add('F13', 'malware', 'Not a shortcut that launches commands', /powershell|cmd\.exe|mshta|wscript|rundll32/i.test(buf.toString('utf16le') + latin)
      ? fail(50, 'Shortcut file that launches a command interpreter')
      : warn(16, 'Shortcut file sent as a download'));
  } else if (type === 'iso') {
    add('F13', 'malware', 'Not a disk image used to bypass security warnings', warn(20, 'Disk images skip Windows "downloaded from the internet" protections'));
  } else {
    add('F13', 'malware', 'Not a shortcut or disk-image delivery trick', pass('Not applicable'));
  }

  // F14 - HTML attachments (phishing pages and smuggled payloads)
  if (type === 'html') {
    const smuggle = /new\s+blob\s*\(/i.test(latin) && /createobjecturl|mssaveoropenblob/i.test(latin) && /[A-Za-z0-9+/]{2000,}={0,2}/.test(latin);
    const phish = /type\s*=\s*["']?password/i.test(latin);
    add('F14', 'malware', 'Not an HTML file carrying a payload or login form', smuggle
      ? fail(45, 'HTML file that assembles and downloads a hidden file')
      : phish ? fail(35, 'Offline HTML page asking for a password') : pass('Plain HTML'));
  } else {
    add('F14', 'malware', 'Not an HTML file carrying a payload or login form', skip('Not HTML'));
  }

  return { sha256, size: buf.length, type, name, checks, evidence };
}

module.exports = { scanFile, MAX_FILE_BYTES };
