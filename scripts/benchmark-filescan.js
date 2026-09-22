'use strict';
// Local, inert fixtures only. Reports warm single-file CPU time and how long a
// ready timer waits for the synchronous scan. This does not contact any service.
const { performance } = require('node:perf_hooks');
const { scanFile } = require('../server/lib/scan/filescan');

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const round = (number) => Math.round(number * 100) / 100;

async function main() {
  for (const kind of ['text', 'executable-shaped']) {
    for (const mib of [1, 10, 25]) {
      const pattern = kind === 'text' ? 'This is harmless benchmark text.\n'
        : Buffer.from(Array.from({ length: 65536 }, (_, i) => (i * 73 + (i >>> 8)) & 255));
      const buffer = Buffer.alloc(mib * 1024 * 1024, pattern);
      // The marker selects executable checks; these bytes contain no program.
      if (kind === 'executable-shaped') buffer.write('MZ');
      const name = kind === 'text' ? 'fixture.txt' : 'fixture.exe';
      const scan = () => scanFile(buffer, name, { lookupHash: () => null });
      scan();
      const durations = [];
      const timerDelays = [];
      for (let i = 0; i < 7; i++) {
        const start = performance.now();
        const timer = new Promise((resolve) => setTimeout(() => resolve(performance.now() - start), 0));
        scan();
        durations.push(performance.now() - start);
        timerDelays.push(await timer);
      }
      console.log(JSON.stringify({ kind, mib, medianMs: round(median(durations)), timerDelayMs: round(median(timerDelays)) }));
    }
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
