/**
 * Which extension builds this site is allowed to talk to.
 *
 * Chrome derives an unpacked extension's ID from the folder it was loaded from,
 * so the ID differs per machine until the extension is published. Add your own
 * during development: chrome://extensions -> Sentinel -> ID.
 *
 * The extension only accepts messages from origins listed in its manifest's
 * "externally_connectable" block, so this list cannot be abused by other sites.
 */
window.SENTINEL_EXTENSION_IDS = [
  // Chrome Web Store build (filled in at publish time):
  // 'abcdefghijklmnopabcdefghijklmnop',
];

// Allow a locally loaded build to register itself for this browser only.
try {
  const local = localStorage.getItem('sentinel.extensionId');
  if (local) window.SENTINEL_EXTENSION_IDS.push(local);
} catch { /* storage blocked - fine */ }
