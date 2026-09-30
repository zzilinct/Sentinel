'use strict';
/** Tiny settings store. Secrets are encrypted with the OS keychain via safeStorage. */
const fs = require('fs');
const path = require('path');

let file = null;
let data = {};
let crypto = null;

function init(dir, safeStorage) {
  file = path.join(dir, 'settings.json');
  crypto = safeStorage;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
}

function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Written beside it and then swapped in: a crash or power cut mid-write never leaves half a file, which would
  // start Sentinel with every setting and the sign-in gone.
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

function get(key, fallback) {
  return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : fallback;
}

function set(key, value) {
  if (value === undefined) delete data[key]; else data[key] = value;
  save();
}

function setSecret(key, value) {
  if (value == null) { delete data[`secret:${key}`]; save(); return; }
  if (!crypto.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system');
  data[`secret:${key}`] = crypto.encryptString(value).toString('base64');
  save();
}

function getSecret(key) {
  const blob = data[`secret:${key}`];
  if (!blob) return null;
  try { return crypto.decryptString(Buffer.from(blob, 'base64')); } catch { return null; }
}

module.exports = { init, get, set, setSecret, getSecret };
