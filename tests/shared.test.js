'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

require('../desktop/scripts/sync-shared.js');
const SHARED = path.join(__dirname, '..', 'desktop', 'shared');

// The app loads these at startup: one missing neighbour (email.js needing qr.js) kept the whole app from starting.
test('every file the desktop app copies into shared/ finds the files it requires there', () => {
  for (const name of fs.readdirSync(SHARED).filter((f) => f.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(SHARED, name), 'utf8');
    for (const m of src.matchAll(/require\('\.\/([\w.-]+)'\)/g)) {
      const want = m[1].endsWith('.js') || m[1].endsWith('.json') ? m[1] : `${m[1]}.js`;
      assert.ok(fs.existsSync(path.join(SHARED, want)), `${name} requires ./${m[1]}, which is not copied into desktop/shared`);
    }
  }
});
