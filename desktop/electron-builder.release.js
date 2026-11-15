'use strict';
// The release build: package.json's own build, with the Electron fuses that stop any other program on the computer from
// running its code as Sentinel (ELECTRON_RUN_AS_NODE, NODE_OPTIONS, --inspect). The e2e builds (npm run dist:win)
// keep them on: they attach with --inspect. scripts/desktop-fuses-e2e.ps1 proves the release build on CI.
module.exports = {
  ...require('./package.json').build,
  electronFuses: {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false
  }
};
