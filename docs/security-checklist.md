# Sentinel security and performance checklist (audit of 1.19.5)

Branch `work/e2e-sec-audit`, based on `main` at `c07c90a`. Every item is a statement that should be true. Status:

- **pass**: true today, with the evidence.
- **missing**: the measure is absent.
- **malfunctioning**: present, but it does not do what it claims.
- **buggy**: present and mostly right, with a hole.
- **fixed**: was missing, malfunctioning or buggy, and is fixed on this branch (commit named).
- **n/a**: does not apply to Sentinel today, with the reason.

Evidence is `file:line` at the audited commit. Line numbers in files changed on this branch refer to the new version.

## Sources

| Key | Source |
| --- | --- |
| T10 | OWASP Top 10 (2021): https://owasp.org/Top10/ |
| ASVS | OWASP Application Security Verification Standard 4.0.3: https://owasp.org/www-project-application-security-verification-standard/ |
| API | OWASP API Security Top 10 (2023): https://owasp.org/API-Security/editions/2023/en/0x11-t10/ |
| CS-SES | OWASP Session Management Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html |
| CS-CSRF | OWASP CSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html |
| CS-XSS | OWASP XSS Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html |
| CS-SSRF | OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html |
| CS-UP | OWASP File Upload Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html |
| CS-PW | OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html |
| CS-AUTH | OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html |
| CS-MFA | OWASP Multifactor Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html |
| CS-FP | OWASP Forgot Password Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html |
| CS-CSP | OWASP Content Security Policy Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html |
| CS-LOG | OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html |
| CS-NODE | OWASP Node.js Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html |
| CS-HDR | OWASP HTTP Headers Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html |
| CS-REDIR | OWASP Unvalidated Redirects Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html |
| CS-CI | OWASP CI/CD Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/CI_CD_Security_Cheat_Sheet.html |
| EL | Electron security checklist (20 items, read 2026-11-09): https://www.electronjs.org/docs/latest/tutorial/security |
| EL-FUSE | Electron fuses: https://www.electronjs.org/docs/latest/tutorial/fuses |
| CR-SEC | Chrome extensions, stay secure (read 2026-11-09): https://developer.chrome.com/docs/extensions/develop/security-privacy/stay-secure |
| CR-WAR | Chrome web_accessible_resources: https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources |
| CR-MV3 | Chrome MV3 remote hosted code rules: https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code |
| FF | Firefox add-on policies: https://extensionworkshop.com/documentation/publish/add-on-policies/ |
| NODE | Node.js security best practices: https://nodejs.org/en/learn/getting-started/security-best-practices |
| MOZ | Mozilla web security guidelines: https://infosec.mozilla.org/guidelines/web_security |
| OBS | MDN HTTP Observatory tests: https://developer.mozilla.org/en-US/observatory/docs/tests_and_scoring |
| CWE | CWE Top 25 (2024): https://cwe.mitre.org/top25/archive/2024/2024_cwe_top25.html |
| NIST | NIST SP 800-63B (rev. 4, read 2026-11-09): https://pages.nist.gov/800-63-4/sp800-63b.html |
| CISA | CISA Secure by Design: https://www.cisa.gov/securebydesign |
| GHA | GitHub Actions security hardening: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions |
| GHT | GITHUB_TOKEN permissions: https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication |
| NPM | npm audit and lockfiles: https://docs.npmjs.com/cli/commands/npm-audit , https://docs.npmjs.com/cli/configuring-npm/package-lock-json |
| SLSA | SLSA v1.0 build levels: https://slsa.dev/spec/v1.0/levels |
| MS-SIGN | Microsoft code signing and SmartScreen: https://learn.microsoft.com/en-us/windows/security/operating-system-security/virus-and-threat-protection/microsoft-defender-smartscreen/ |
| MS-PIPE | Named pipe security: https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights |
| PNA | Private Network Access (loopback from public pages): https://wicg.github.io/private-network-access/ |
| GDPR | GDPR Art. 5, 25, 32, 33: https://gdpr-info.eu/ |
| EUP | electron-updater (signature and SHA-512 checks): https://www.electron.build/auto-update |

## Summary of findings

| Severity | Finding | Status |
| --- | --- | --- |
| High | Electron runtime 44.5.1 shipped with the app is behind security fixes (GHSA-jr5w-w6x2-84p9 and Chromium patches up to 44.10.2) | fixed `08c4777` |
| High | Updates are trusted on the GitHub account alone: the installer is not code-signed, and the SHA-512 comes from the same release as the file | missing, plan below |
| Medium | Defense skipped any folder whose path merely started with Sentinel's install folder or quarantine folder (`desktop/src/defense.js:252` at `c07c90a`) | fixed `75200b8` |
| Medium | Two-factor codes could be guessed without end: each sign-in gave a fresh challenge with five tries, and wrong codes did not count toward the account lock (`server/lib/auth.js:205` at `c07c90a`) | fixed, see the commit "Sign-in: wrong two-factor codes" |
| Medium | Electron fuses are left at defaults: `RunAsNode`, `NODE_OPTIONS` and `--inspect` work on the shipped exe, so any local program can run code as Sentinel | missing, plan below |
| Medium | The release and site workflows, which hold write tokens, ran third-party actions by floating tag | fixed (pins) for the two privileged workflows; other workflows listed |
| Low | The app window let `http://127.0.0.1:47821@elsewhere/` through its own-origin check to the browser (`desktop/src/main.js:369` at `c07c90a`) | fixed |
| Low | Password rules differ from NIST SP 800-63B rev. 4: a letter and a digit are required (composition rules SHALL NOT be imposed), and the minimum is 10 (15 for a password used alone) | missing, design decision |
| Low | Desktop local pages allow `'unsafe-inline'` scripts in their CSP | missing, plan below |
| Low | Several extension worker messages (`override`, `report`, `deep-scan`, `live-batch`) accept any content script without checking where it runs | missing, plan below |
| Low | The rate-limit table in memory has no size cap; unique keys (one per email tried) live for the whole window | missing, plan below |
| Low | Build-time only: minimatch (moderate) inside electron-builder; needs a major electron-builder change | left, build machines only |

Everything else checked passes; the details follow.

## 1. Server: transport, headers, CORS and CSRF

| # | Item | Source | Status | Evidence |
| --- | --- | --- | --- | --- |
| S1 | Every response carries a CSP with `script-src 'self'`, no `unsafe-inline` or `unsafe-eval` for scripts | CS-CSP, OBS | pass | `server/lib/security.js:13-29` |
| S2 | `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` | CS-CSP, OBS | pass | `security.js:22-24` |
| S3 | `form-action` limits where forms post | CS-CSP | pass | `security.js:25` |
| S4 | `X-Content-Type-Options: nosniff` on every response, static files included | CS-HDR | pass | `security.js:34`, `server/lib/http.js:234` |
| S5 | `X-Frame-Options: DENY` as a fallback to frame-ancestors | CS-HDR | pass | `security.js:36` |
| S6 | HSTS with a long max-age when served over https | MOZ, OBS | pass | `security.js:42` |
| S7 | `Referrer-Policy` keeps reset and verify tokens out of cross-site referrers | CS-FP, OBS | pass | `security.js:35` (`strict-origin-when-cross-origin`) |
| S8 | `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` set | CS-HDR | pass | `security.js:37-38` |
| S9 | `Permissions-Policy` turns off features the site does not use | CS-HDR | pass | `security.js:39` |
| S10 | CORS reflects only a fixed allowlist of origins, never `*` with credentials | T10 A05, ASVS 14.5.3 | pass | `security.js:53-72` |
| S11 | No extension origin gets `Access-Control-Allow-Credentials` | CR-SEC | pass | `security.js:68` |
| S12 | State-changing requests require an allowed Origin or Referer, or a bearer token | CS-CSRF | pass | `security.js:83-99`, called for every API route at `server/index.js:65` |
| S13 | A request with no Origin and no Referer is refused, not waved through | CS-CSRF | pass | `security.js:98` |
| S14 | JSON bodies require `Content-Type: application/json`, so a cross-site form cannot post a "simple" request | CS-CSRF | pass | `http.js:121` |
| S15 | The one raw upload route needs a custom header (forces a CORS preflight) | CS-CSRF | pass | `server/routes/scan.routes.js:219-222` |
| S16 | Request size limits on every body | API4 | pass | `http.js:91-111` (512 KB default, 25 MB files) |
| S17 | Slow-loris limits: header and request timeouts, header count, keep-alive | CS-NODE | pass | `server/index.js:117-121` |
| S18 | Error responses never include stack traces or internal messages | T10 A05, CS-NODE | pass | `server/index.js:96-107` |
| S19 | A global per-IP API rate limit | API4 | pass | `server/index.js:64` (600 a minute) |
| S20 | Client IP is taken from `X-Forwarded-For` only when a proxy is declared | ASVS 1.4 | pass | `security.js:103-108` |
| S21 | Rate-limit state is bounded in memory | API4 | missing | `security.js:112-129`: cleared only when windows expire; unique keys (`login:email:<any text>`) grow with traffic |

## 2. Server: accounts, passwords, sessions, 2FA

| # | Item | Source | Status | Evidence |
| --- | --- | --- | --- | --- |
| A1 | Passwords are hashed with a memory-hard KDF and a per-user random salt | CS-PW, NIST | pass | `server/lib/auth.js:11,22-26` (scrypt N=32768, r=8, 16-byte salt) |
| A2 | Hash comparison is constant time | CS-PW | pass | `auth.js:34` |
| A3 | Unknown emails cost the same hashing time as known ones | CS-AUTH | pass | `auth.js:38`, `auth.js:166-174` |
| A4 | New passwords are checked against a breach corpus without sending the password | NIST | pass | `security.js:172-185` (HIBP range API, padded) |
| A5 | No composition rules are imposed | NIST ("SHALL NOT impose") | missing | `security.js:158` requires a letter and a digit |
| A6 | Minimum length 15 for a password used alone, 8 with MFA | NIST rev. 4 | missing | `security.js:156` (10) |
| A7 | At least 64 characters are accepted | NIST | pass | `security.js:157` (200) |
| A8 | Failed password attempts are rate-limited per account and per IP | NIST, CS-AUTH | pass | `server/routes/auth.routes.js:108-109`, lock after 8 at `auth.js:14,177` |
| A9 | Failed OTP attempts are rate-limited per account, and a new challenge does not reset the count | NIST ("generating a new secret does not reset the failure count"), CS-MFA | fixed | was per challenge and per IP only; now `auth.js:205-216`, test `tests/security.test.js` "wrong ones lock the account however many fresh challenges" |
| A10 | TOTP codes cannot be replayed | CS-MFA | pass | `security.js:230-241`, `auth.js` `totpUsed` |
| A11 | TOTP secrets are encrypted at rest | ASVS 2.9 | pass | `auth.js:44-57` (AES-256-GCM) |
| A12 | Turning 2FA on or off needs the password and a code | CS-MFA | pass | `server/routes/account.routes.js:144-174` |
| A13 | Session tokens are 256-bit random and stored only as hashes | CS-SES | pass | `auth.js:251-253` |
| A14 | Cookies are HttpOnly, SameSite, Secure over https and `__Host-` prefixed | CS-SES | pass | `auth.js:13`, `http.js:72-80` |
| A15 | Sessions expire on idle and have a server-side record that can be revoked | CS-SES | pass | `auth.js:236-305` |
| A16 | A user can list and sign out single sessions or all others | CS-SES | pass | `account.routes.js:176-210` (scoped by user id) |
| A17 | Changing the password ends every other session | CS-SES | pass | `account.routes.js:126` |
| A18 | A password reset ends every session and clears the lock | CS-FP | pass | `auth.routes.js:178-179` |
| A19 | Reset tokens are random, hashed at rest, single use, short-lived, and all others die when one is used | CS-FP | pass | `auth.routes.js:11-16,145-147,163-181` (30 minutes) |
| A20 | Reset requests answer the same for known and unknown emails | CS-FP | pass | `auth.routes.js:156-160` |
| A21 | Reset requests are rate-limited per IP and per email | CS-FP | pass | `auth.routes.js:139-140` |
| A22 | Email verification tokens follow the same rules as reset tokens | CS-FP | pass | `auth.routes.js:31-33,82-95` |
| A23 | Account deletion needs the password and a typed confirmation | API5 | pass | `account.routes.js:212-216` |
| A24 | Redirect targets after sign-in are same-site paths only | CS-REDIR | pass | `auth.js:351-358` |
| A25 | OAuth uses state bound to the browser by a cookie | ASVS 3.5 | pass | `auth.js:368-396` |
| A26 | OAuth ID token audience, issuer, expiry and `email_verified` are checked | ASVS 2.x | pass | `auth.js:415-422` |
| A27 | A Google sign-in to an unverified password account wipes the squatter's password, 2FA and sessions | CS-AUTH | pass | `auth.js:440-450` |
| A28 | Client tokens are issued only to a browser session, never to a bearer token or extension origin | API2 (fix from 1.19.2 held) | pass | `auth.routes.js:208-224` |
| A29 | The device account is offered only on the desktop's server, from loopback, never to an extension or the public site | 1.19.2 fix held | pass | `auth.routes.js:231-238` |
| A30 | Every scanning route checks the caller's account and plan on the server, not in the page | API1, API5 | pass | `auth.js` `requireAgreedUser`, used across `scan.routes.js` |
| A31 | Security events (sign-in, failure, reset, 2FA, session revoke) are logged without secrets | CS-LOG | pass | `security.js:133-139`, calls across routes |
| A32 | Account deletion removes the user and unlinks the audit log from them | GDPR Art. 17 | pass | `account.routes.js:217-222` |

## 3. Server: scanning, outbound requests and files

| # | Item | Source | Status | Evidence |
| --- | --- | --- | --- | --- |
| F1 | Outbound research fetches allow only http and https on ports 80 and 443 | CS-SSRF | pass | `server/lib/scan/netguard.js:99-101` |
| F2 | The resolved IP is checked against private, loopback, link-local, CGNAT, multicast and reserved ranges, v4 and v6 | CS-SSRF | pass | `netguard.js:28-67` |
| F3 | The checked address is the one the socket connects to (no DNS rebinding between check and use) | CS-SSRF | pass | `netguard.js:81-92` (custom `lookup`) |
| F4 | IP-literal hosts are checked directly | CS-SSRF | pass | `netguard.js:103-105` |
| F5 | Every redirect hop is checked again, with a hop limit | CS-SSRF | pass | `netguard.js:224-243` |
| F6 | URLs with credentials are not fetched | CS-SSRF | pass | `netguard.js:102` |
| F7 | Response size, decompressed size and total time are capped | CS-SSRF, CWE-400 | pass | `netguard.js:18-21,140-152,184` |
| F8 | The desktop app never fetches a suspicious page from the person's computer | product rule | pass | `desktop/src/server.js:117-120` |
| F9 | Uploaded file names are reduced to a safe name before any use | CS-UP | pass | `scan.routes.js:223` |
| F10 | Uploads are scanned in memory and never written where the web server serves them | CS-UP | pass | `scan.routes.js:229-234` (buffer only) |
| F11 | Archive entries are size-checked before inflating (zip bomb) and encrypted entries skipped | CS-UP, CWE-409 | pass | `server/lib/scan/filescan.js:127` |
| F12 | Archive entry names are never used as paths on disk (zip slip) | CWE-22 | pass | archives are read in memory only (`filescan.js`); nothing extracts to disk |
| F13 | Static files cannot escape the web folder, and dotfiles and partials are not served | CWE-22 | pass | `http.js:207-218` |
| F14 | Downloads are served as attachments | CS-UP | pass | `http.js:237` |
| F15 | In-memory caches in the scan engine are bounded | API4 | pass | `engine.js:57`, `research.js:118,160`, `safebrowsing.js:16`, `mysites.js:172` |
| F16 | Paid third-party calls have daily caps | API4 | pass | `server/config.js` `safeBrowsingDailyCap`, `mailDailyCap` |
| F17 | SQL is parameterised everywhere | CWE-89 | pass | all queries use `db.prepare` with `?` (sampled in `auth.js`, `account.routes.js`, `compare.js`) |

## 4. Web site and web app

| # | Item | Source | Status | Evidence |
| --- | --- | --- | --- | --- |
| W1 | Untrusted text (URLs, hosts, titles, email parts, file names, reasons) reaches the DOM escaped or as text | CS-XSS, CWE-79 | pass | full review of the HTML sinks in `web/assets/js`: escapers at `ui.js:76`, `recover.js:108`, `practice.js:190`, `download.js:97`, `home.js:16` escape all five characters; no unescaped source found |
| W2 | Links built from data have their scheme checked | CS-XSS | pass | `ui.js:450-451` (real site must match `^https://[a-z0-9.-]+/$`) |
| W3 | Nothing assigns `location` from the query or hash without validation | CS-REDIR | pass | `auth.js` (web) `next` checked client and server side |
| W4 | No inline scripts or `eval` (CSP enforced) | CS-CSP | pass | `security.js:15` |
| W5 | Third-party scripts are self-hosted, not pulled from a CDN at run time | CR-MV3, CISA | pass | `web/assets/js/vendor/` |
| W6 | A small set of fixed values go into markup unescaped (`tone`, `badge`, `c.status`) | CS-XSS (defence in depth) | pass with note | `ui.js:261,460`; values come from Sentinel's own engine, wrapping them in `esc()` would cost nothing |

## 5. Electron desktop app

| # | Item | Source | Status | Evidence |
| --- | --- | --- | --- | --- |
| E1 | Only Sentinel's own content loads in windows that have the bridge (EL 1, 20) | EL | pass | main window loads `ORIGIN` only, `desktop/src/main.js:354-366` |
| E2 | `nodeIntegration` off in every window (EL 2) | EL | pass | `main.js:344,475`, `overlay.js:66`, `chatoverlay.js:25`, `snip.js:167` |
| E3 | `contextIsolation` on in every window (EL 3) | EL | pass | same lines |
| E4 | `sandbox` on in every window (EL 4) | EL | pass | same lines |
| E5 | A permission request handler on the session denies everything but the camera for Sentinel's own page (EL 5) | EL | pass | `main.js:1957-1965` |
| E6 | `webSecurity` never turned off (EL 6) | EL | pass | `main.js:345,475` |
| E7 | Pages define a restrictive CSP (EL 7) | EL | pass for the app window (server CSP); local pages allow `'unsafe-inline'` | `desktop/src/pages/*.html` meta CSP |
| E8 | No `allowRunningInsecureContent`, experimental features or `enableBlinkFeatures` (EL 8-10) | EL | pass | none in `desktop/src` |
| E9 | No `<webview>` (EL 11-12) | EL | n/a | not used |
| E10 | Navigation is limited (EL 13) | EL | pass | `main.js:354-365`; every other window prevents navigation (`main.js:442,538,1044`, `overlay.js:74`, `snip.js:172`, `chatoverlay.js:31`) |
| E11 | New windows are denied (EL 14) | EL | pass | every window's `setWindowOpenHandler` returns deny |
| E12 | `shell.openExternal` only gets https or Sentinel's own origin, compared as an origin (EL 15) | EL | fixed | was a prefix test at `main.js:369`; now an origin comparison, test in `tests/desktop.test.js` |
| E13 | A current Electron (EL 16) | EL, NPM | fixed | 44.5.1 to 44.10.2 (`desktop/package.json`, lockfile) |
| E14 | Every IPC call checks its sender's frame origin and window (EL 17) | EL | pass | `main.js:1498-1522`; local pages use `trustedLocal` with a trailing-separator `PAGES` prefix (`main.js:47,1508-1515`) |
| E15 | IPC arguments are type-checked and bounded in the main process | EL 17, CWE-20 | pass | e.g. `main.js` `sentinel:set-token` (length and id pattern), `sentinel:scan-with` (known ids), host strings sliced |
| E16 | The preload exposes named functions only, never `ipcRenderer` itself (EL 20) | EL | pass | `desktop/src/preload.js:16-120` |
| E17 | Fuses: `RunAsNode` off, `NODE_OPTIONS` off, `--inspect` off, asar integrity on, load app only from asar (EL 19) | EL-FUSE | missing | no `electronFuses` in `desktop/package.json`; the e2e scripts depend on `--inspect` and `ELECTRON_RUN_AS_NODE` (`scripts/desktop-e2e-lib.ps1:187`, `.github/workflows/checkup-e2e.yml:59`) |
| E18 | One running copy; a second start hands its arguments over and exits | EL | pass | `main.js:310-319` |
| E19 | The session secret is in the OS keychain, or a file only this user can read | ASVS 6.4 | pass | `desktop/src/server.js:72-87` |
| E20 | Parent-lock PIN is hashed (scrypt) with a try limit and timed waits | CS-AUTH | pass | `desktop/src/parentlock.js:21-22,38-40,84-103` |
| E21 | Protection switches go through the parent lock in the main process, not the page | product rule | pass | `lock.guard` in each handler, `main.js:1553-1703` |

## 6. Local server and IPC on this computer

| # | Item | Source | Status | Evidence |
| --- | --- | --- | --- | --- |
| L1 | The embedded server listens on 127.0.0.1 only | MS-PIPE (local endpoints), PNA | pass | `desktop/src/server-host.js:41-47,62-64` |
| L2 | Requests whose Host is not this computer are refused (DNS rebinding) | PNA | pass | `server/index.js:38-47` (421) |
| L3 | Web pages cannot post to it: CSRF check and JSON content type | CS-CSRF | pass | S12-S14 |
| L4 | The public site cannot read answers with credentials: cookies are SameSite and cross-site to 127.0.0.1 | CS-SES | pass | `auth.js:262`; device route also refuses the site's origin (`auth.routes.js:238`) |
| L5 | The local device token is never readable by an extension or the public site (1.19.2 fix) | 1.19.2 history | pass | `auth.routes.js:236-238`; `sentinel:info` returns no token (`main.js:1525-1553`) |
| L6 | No named pipes or other listening endpoints besides the loopback port | MS-PIPE | pass | helpers talk over stdio (`child_process` pipes), checked in `browsers.js`, `watch.js`, `clipwatch.js` |
| L7 | Child processes are started with argument arrays, not shell strings built from data | CWE-78 | pass | `execFile`/`spawn` with arrays in `defense.js`, `updater.js:195`; PowerShell text uses a quoting helper `psq` (`defense.js`) |
| L8 | Defense never skips a file just because its path begins like Sentinel's folder | CWE-41 | fixed | `defense.js` `inside()`, test in `tests/desktop.test.js` "only Sentinel's own folder is exempt" |
| L9 | Quarantine moves files instead of deleting them, and restore never overwrites | product rule | pass | `defense.js:656-690`, `downloads.js:288-300` |

## 7. Update channel

| # | Item | Source | Status | Evidence |
| --- | --- | --- | --- | --- |
| U1 | Updates are fetched over https from the project's own GitHub releases | EUP | pass | `desktop/package.json` `publish`, `desktop/src/models.js:16-17` |
| U2 | The downloaded installer is checked against the published SHA-512 just before it runs | EUP | pass | `desktop/src/updater.js:175-182` |
| U3 | Prereleases are not installed | EUP | pass | `updater.js:108` |
| U4 | No silent downgrade: an older version only by the person's choice, behind the parent lock | EUP | pass | `main.js` `sentinel:install-model` (lock), `models.js:50-60` |
| U5 | The installer is code-signed and electron-updater verifies the publisher before running it | MS-SIGN, EUP | missing | `tests/download-page.test.js:72-77` asserts it is unsigned; the SHA-512 comes from the same release, so it proves integrity, not origin |
| U6 | Release artifacts carry provenance (SLSA build level 2: signed provenance from a hosted build) | SLSA | missing | `.github/workflows/release.yml` publishes SHA256SUMS only |

## 8. Browser companion (Chrome, Edge, Brave, Firefox)

| # | Item | Source | Status | Evidence |
| --- | --- | --- | --- | --- |
| X1 | Manifest V3, service worker background, no remote code | CR-MV3, FF | pass | `extension/manifest.json:2,29-32` |
| X2 | An explicit extension-page CSP with `script-src 'self'` and `object-src 'none'` | CR-SEC | pass | `manifest.json:226-228` |
| X3 | `externally_connectable` lists only Sentinel's origins, and the listener re-checks the origin | CR-SEC | pass | `manifest.json:219-224`, `extension/src/background.js` onMessageExternal (origin must equal `apiBase`) |
| X4 | The internal message listener rejects other extensions | CR-SEC | pass | `background.js` `sender.id !== ext.runtime.id` |
| X5 | Messages from content scripts are treated as untrusted: privileged handlers check where they come from | CR-SEC | buggy | settings, password and block-page handlers check (`fromOptions`, `fromPage`); `override`, `report`, `deep-scan`, `live-batch`, `state`, `connect`, `sign-out` do not |
| X6 | Tokens are accepted only from Sentinel's own connect pages | CR-SEC | pass | `background.js` `set-token` against `sentinelOrigins()`; `content/connect.js` checks source and origin |
| X7 | Buttons a hostile page could click by script ignore untrusted events | CR-SEC | pass | `content/alarm.js:159-166`, `content/pwalarm.js:210-213` (`isTrusted`); closed shadow roots in hover, serp, webchat |
| X8 | The block page believes nothing in its own address and refuses to render in a frame | CR-WAR | pass | `extension/src/block.js:1-12` |
| X9 | `web_accessible_resources` is the minimum | CR-WAR | pass with note | `manifest.json:209-218` (block page and mask images); any page can detect the companion through them; `use_dynamic_url` would stop that |
| X10 | Host permissions are what the features use | CR-SEC, FF | pass with note | `<all_urls>` is needed for live masks on any page and is declared |
| X11 | Password protection keeps only salted hashes, never the password | FF (data handling) | pass | `background.js` `pw-learn` |
| X12 | Firefox build has a data collection disclosure | FF | not checked | the Firefox manifest is generated by `scripts/build-extension.js`; review before the AMO listing |

## 9. CI and supply chain

| # | Item | Source | Status | Evidence |
| --- | --- | --- | --- | --- |
| C1 | Every workflow sets `permissions:` to the least it needs | GHT | pass | each workflow, e.g. `test.yml:13-14`, `release.yml:19-20` |
| C2 | Third-party actions in jobs with write tokens are pinned to a full commit SHA | GHA | fixed | `release.yml`, `pages.yml` |
| C3 | First-party actions in read-only jobs pinned to SHAs | GHA | missing | `test.yml`, `desktop-e2e.yml`, `live-e2e.yml` and the rest use `@v4` tags; low risk (read-only token, GitHub-owned) |
| C4 | No `pull_request_target` or `workflow_run` with untrusted checkout | GHA | pass | none in `.github/workflows` |
| C5 | No untrusted `${{ github.event.* }}` text interpolated into `run:` | GHA | pass | none found |
| C6 | Secrets are only the automatic token; no personal tokens | GHA | pass | `release.yml` header, `update-e2e.yml:26` |
| C7 | Lockfiles are committed and CI installs with `npm ci` | NPM | pass | `desktop/package-lock.json`, `release.yml` `npm ci`; the server and site have no dependencies |
| C8 | `npm audit` shows no runtime advisories | NPM | fixed | `npm audit --omit=dev` in `desktop/`: 0; full audit had 2 high (Electron, undici), now 6 moderate, all minimatch inside electron-builder |
| C9 | No secrets in the repository | CS-CI | pass | `git grep` for key formats finds only test fixture URLs (`tests/longlinks.test.js:28,39`, access key ids without secrets); `.env` ignored |
| C10 | Tag and package versions must agree before a release builds | CS-CI | pass | `release.yml:31-40` |

## 10. Data and privacy (where it touches security)

| # | Item | Source | Status | Evidence |
| --- | --- | --- | --- | --- |
| P1 | Data minimisation: the desktop app keeps accounts and history on the computer | GDPR Art. 5(1)(c), 25 | pass | `desktop/src/server.js:111-121` |
| P2 | Sessions show IPs truncated | GDPR Art. 5 | pass | `account.routes.js:188` |
| P3 | A deleted account leaves only a short email fingerprint in the log | GDPR Art. 17 | pass | `account.routes.js:217-222` |
| P4 | Breach password check sends only five hex characters of a SHA-1 | GDPR Art. 25 | pass | `security.js:175-178` |
| P5 | Security of processing: encryption of secrets at rest, keychain for the session secret | GDPR Art. 32 | pass | A11, E19 |
| P6 | A written breach notification procedure (72 hours to the authority) | GDPR Art. 33 | not checked | no document in the repo; the hosted service is not live yet |

## 11. Desktop performance on modest computers

Measured, not estimated. CI numbers are from the GitHub Windows runner in live-e2e run 42540586111 (1.19.5, 2026-11-09).

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| R1 | Started in the tray, no window or renderer is made until opened | pass | `main.js:1986` |
| R2 | Footprint after start | measured | 7 processes, 549 MB working set (357 MB private), 1.6 s CPU |
| R3 | Footprint after browsing with live scanning | measured | 721 MB (499 MB private); server utility process 143 MB, the two PowerShell readers 107 MB and 146 MB |
| R4 | Idle minute | measured | 3.1 s CPU in 60 s, 5.2% of one core, `reg.exe` started 0 times |
| R5 | Embedded server alone, offline, fresh database, no feed refresh (this PC, Node 24) | measured | listening in 398 ms, 172 ms CPU to start, 63 MB RSS, 6.9 MB heap, 31 ms CPU in 20 s idle |
| R6 | No polling of `tasklist` or `reg.exe` | pass | removed in 1.6.17; R4 shows 0 `reg.exe` starts |
| R7 | Heavy work off the main thread | pass | file hashing and analysis in workers (`defense.js` comment at `inspectFile`, `filescan-worker.js`, `regread-worker.js`) |
| R8 | Timers are few and unref'd | pass | `main.js:1977,2005,2016`, `updater.js:139` |
| R9 | Web app bundle | measured | `app.html` loads 10 scripts; `app.js` 235 KB; the 3D masks (`mask3d.js`, 627 KB) load only on the marketing pages, never in the app |
| R10 | Biggest remaining cost: two PowerShell helper processes | open | about 250 MB of the 743 MB after an idle minute (R3); see plan P-PERF-1 |
| R11 | The CI CPU profile trigger did not fire in that run (`cpu profile written: False`) | open | live-e2e log; without it the idle 5.2% cannot be split by function |

## Plans for what is left

**P-SIGN (High), code-sign the installer.** Buy an OV certificate or use Azure Trusted Signing, sign in `release.yml` with a secret held in a protected environment, set `win.publisherName` so electron-updater refuses an installer signed by anyone else, and change `tests/download-page.test.js:72-77` and the download page together. Until then, the only thing protecting updates is the GitHub account: turn on 2FA with a hardware key and tag protection rules for `v*`.

**P-FUSE (Medium), Electron fuses.** Add `build.electronFuses` (`runAsNode: false`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `enableEmbeddedAsarIntegrityValidation: true`, `onlyLoadAppFromAsar: true`) for release builds. The e2e workflows attach with `--inspect` and `ELECTRON_RUN_AS_NODE`, so they need their own unfused build (an environment switch in the build step) or a CDP-only harness. Doing this blind would break every desktop e2e run, so it is left for a change that moves both together.

**P-CSP (Low), local page CSP.** Move the inline scripts of `warn.html`, `guard.html`, `filescan.html`, `error.html`, `overlay.html`, `snip.html` into files and drop `'unsafe-inline'` and bare `file:` from `script-src`. `chat.html` is being edited by another builder; do it there afterwards.

**P-EXT (Low), extension message senders.** `override` and `report` from a content script should be accepted only when `sender.url` is one of the search pages `serp.js` runs on, or the block page; `deep-scan`, `state`, `connect`, `sign-out`, `refresh` only from extension pages (`fromOptions`). Today an attacker needs code running in the content script's world first.

**P-PW (Low), NIST password rules.** Drop the letter-and-digit rule, raise the minimum to 15 (or 8 when 2FA is on), keep the breach check. Changes sign-up copy and tests.

**P-RL (Low), rate-limit table.** Cap the map (for example drop the oldest keys past 50,000) and key email limits by a hash of a normalised address.

**P-CI (Low), pin the remaining workflows** to SHAs and add Dependabot for `github-actions` so pins are kept current.

**P-PERF-1, one helper instead of two.** The two PowerShell processes (the browser address reader and the running-browsers and Run key watcher) each load the .NET runtime and UI Automation; merging them into one host, or moving the watcher into the existing worker, would save roughly the smaller one's working set (107 MB in R3). It is a design change in `watch.js` and `browsers.js`, so it is listed, not done.

**P-PERF-2, fix the CI CPU profile trigger** so the idle 5.2% can be attributed before anything is optimised blind.
