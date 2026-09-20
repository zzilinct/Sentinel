# Sentinel

**See the scam before you click.** Real-time scam, virus and malware protection for search results, email and downloads.
Brand domain: **[www.usesentinel.technology](https://www.usesentinel.technology)** (configured in [brand.json](brand.json)).

Sentinel marks risky links with three masks, each coloured by severity:

| Mask | Threat | Yellow | Orange | Red |
|---|---|---|---|---|
| Smiling mask | **Scam** | Suspicious | Likely scam | Confirmed scam |
| Mask with spores | **Virus** | Possible virus | Likely virus | Virus detected |
| Horned mask | **Malware** | Possible malware | Likely malware | Malware detected |

Red is only ever shown with **evidence** (a threat-feed match, a known scam kit on an impersonating page, a known malicious file, or unmistakable hostile behaviour). Heuristics alone top out at orange.

## How a verdict is made

1. **Knowledge**: Sentinel's own threat database, community reports (3 independent reports make a site confirmed), 15 live public lists (see Threat lists: about 430,000 listed hosts and addresses, each refreshed on its own interval) and optional Google Safe Browsing. **No record anywhere lowers the risk** (scam −20%, virus/malware −15%).
2. **Checklist**: 98 named checks (look-alikes, typosquats, combosquats, abused TLDs, free-hosting throwaways, disguised downloads, bait wording in several languages...). Every check explains itself in the UI.
3. **Compare**: domain skeleton and name-pattern matching against known scam domains; page content against 11 known scam/malware kit families and copies of confirmed scam pages.
4. **Research** (Pro/Max): RDAP registration age and status, DNS, TLS certificate, redirect chain, page forms, scripts, hidden frames, miners, ClickFix lures, forced downloads, and full file analysis of anything the link downloads.

## Plans (enforced server-side, reset Mondays 00:00 UTC)

| | Free | Pro | Max | Ultimate |
|---|---|---|---|---|
| Price / month | $0 | $15 | $40 | $100 |
| Link scans / week | 10 (no research, scam mask only) | 40 (researched, all masks) | 100 (researched, all masks) | 500 (researched, all masks) |
| Virus & malware scans / week | 5 | 40 | 100 | 500 |
| Live scanning / week | — | 24 h (checklist, no research) | 96 h (every result researched) | 24/7, no weekly cap (every result researched) |
| Email masks (Gmail/Outlook) | — | ✓ | ✓ | ✓ |
| Paste-in email scans | — | — | ✓ (counts as a link scan) | ✓ (counts as a link scan) |
| Download protection (app) | — | ✓ | ✓ | ✓ |

Prices and entitlements live in [server/lib/plans.js](server/lib/plans.js) and are enforced there — the client only renders what the server returns. Ultimate's live allowance is stored as `null`, meaning uncapped.

## What's in the repo

```
server/            Node API + web server (zero npm dependencies, built-in SQLite)
  lib/scan/        knowledge, checklist, compare, research, netguard (SSRF), filescan, email, feeds, engine
  lib/             auth (scrypt, sessions, 2FA, Google OAuth), security, plans, mailer, db (migrations)
  routes/          auth, account, scan/live, optional AI assistants
web/               marketing site, installable web app (/app), auth pages, partials, service worker
extension/         Browser companion (MV3): search masks, email masks, page warnings
desktop/           Sentinel desktop app (Electron): tray, download protection, unlocks live features
tests/             node:test suites with local scam/malware fixture sites
scripts/           evaluate, admin, icons, fonts, packaging
deploy/            docker-compose + Caddy (automatic HTTPS for www.usesentinel.technology)
```

## Run locally

Requires Node 22.5+.

```bash
npm start
```

Open http://localhost:8787. With no `.env`, billing runs in **demo mode** (plans switch instantly, no payment) and emails such as password resets are printed to the console.

```bash
npm test
```

```bash
npm run evaluate
```

`npm run evaluate` measures detection on today's live phishing feed and false alarms on 127 popular sites. At last run: **0 false alarms** on the 127 sites checklist-only and **0/32** with live research; **55%** of live phishing addresses were flagged by the checklist alone, with no list lookup at all, and listed ones are confirmed red. Details under Testing the scanner.

## The desktop app

The app ships the whole Sentinel server inside it and runs it privately on
`127.0.0.1:47821` when it starts. Accounts, scanning, threat feeds and history
all work on a computer with nothing hosted anywhere; the database and logs live
in the user's app-data folder (`%APPDATA%\Sentinel` on Windows). Set
`SENTINEL_ORIGIN=https://your-sentinel.example` before launching to use a hosted
Sentinel instead, and `npm run dev` in `desktop/` to use the dev server.

Beyond running the product, the app protects on its own, with no browser
add-on involved:

- **Live scanning, one button (Windows).** Press **Start scanning**, or **Scan
  with Chrome / Edge / Firefox...** beside a browser in *Your browsers* (it opens
  the browser if it is closed, brings it to the front maximised if it is
  minimised or behind something, and starts). A gold line crosses the screen,
  and when the tint fades Sentinel is ready. It stays on until Stop. There is no
  add-on to install and nothing to pair. `desktop/src/watch.js` asks Windows,
  through the accessibility interface screen readers use, for the address of
  the page in front, where that page is on screen, and on a results page the
  addresses of the links on screen and where they are. It reads addresses only:
  never page text, form fields or anything typed, and it takes no screenshots.
- **What you see.** `desktop/src/overlay.js` is one transparent window laid
  exactly over the page area of the browser in front. It draws the gold line and
  tint when scanning starts and whenever a search comes back, the gold Sentinel
  mask in the bottom right corner for as long as that browser is being watched
  (it turns the verdict's colour, with a line of words, on a dangerous page),
  and a mark beside every search result: a yellow, orange or red mask, or a
  quiet tick. A mark explains itself on hover. The window cannot take focus,
  and every click and key goes straight through it to the browser.
- **Only while browsing.** Chrome, Edge, Brave, Opera, Vivaldi, DuckDuckGo,
  Firefox and LibreWolf, and only while one of them is the window in front, not
  minimised, with someone at the keyboard in the last two minutes. Otherwise
  nothing is read, nothing is checked, no live time is spent and the overlay is
  gone. An open browser is never a notification.
- **Private windows.** InPrivate, Incognito and Private Browsing windows
  (recognised by their title) are protected the same way and nothing about them
  is kept: no history entry even for a flagged result, no log line, no entry in
  the app's live list, no address held in memory after the check.
- **No sign-up.** The embedded server issues the computer its own account on
  first start (`POST /api/v1/auth/device`, loopback only, enabled only by the
  desktop app), so download protection and defense are on from the first minute.
- **Defense.** `desktop/src/defense.js` watches Downloads, Desktop, Temp and
  Startup plus Run keys and scheduled tasks. A flagged program is quarantined
  at once (a move, reversible), any process running from it is ended, and the
  entries that would relaunch it are removed. No kernel driver: it runs beside
  the system antivirus. Malware-side tests run in the `sentinel-lab`
  VirtualBox VM, never on a developer's machine. Last run there (1.4.4, a
  harmless program carrying the test suite's inert marker, started and given
  a Run key, a Startup shortcut and a scheduled task): process ended, file
  quarantined, and all three ways back removed; an EICAR file was left to the
  system antivirus and its Run key removed.
- **Defense leaves trusted programs alone.** What the on-device scan finds in a
  file is a guess from its contents. A guess never outranks a valid publisher
  signature: Discord's updater contains "DownloadFile" because downloading is
  its job, and 1.4.x removed its startup entry over that. Now a program Windows
  can vouch for is only ever condemned by a known-malicious file hash; "possible"
  (yellow) findings are written down and nothing else (no notification, nothing
  ended, nothing removed); and every startup entry defense removes is recorded
  in full, so **Put back** in the defense log restores it exactly.
- **It keeps going.** A token the server refuses never switches protection
  off: background calls fall back to the computer's own account and ask for a
  fresh token if that is refused too. When the scanner is still starting,
  live scanning and download protection try again every 30 seconds. Why live
  scanning is not watching is always written to `logs/watch.log`.
- **Slow machines and big databases.** The time allowed for the scanner to
  start grows with the size of the database it has to work through, a start
  that failed is never restarted twice, and a new server waits for the old
  one to be gone.
- **Self-updating.** `desktop/src/updater.js` checks GitHub Releases, downloads
  a newer installer quietly and applies it when Sentinel quits, so nobody
  downloads the app twice.

Pre-launch builds run billing in demo mode so every plan can be exercised.

```bash
cd desktop && npm install && npm run dist:win
```

That produces `desktop/dist/Sentinel-Setup-<version>.exe`, with the server,
site and browser companion bundled in.

## Releases

Downloads come from GitHub Releases, built by `.github/workflows/release.yml`
with GitHub's own token. To ship a version, bump `desktop/package.json` and:

```bash
git tag v1.5.0 && git push origin v1.5.0
```

The workflow runs the tests, builds the installer and both companion builds,
and publishes `Sentinel-Setup.exe`, `sentinel-companion.zip`,
`sentinel-companion-firefox.zip`, `latest.yml` and `SHA256SUMS.txt`.

`latest.yml` is what installed copies read to update themselves, so a release
reaches everyone who already has the app without them downloading anything.
The download page always links to the latest release and shows its real
version and size from the GitHub API. The installer is not code-signed, so
Windows SmartScreen warns on first run until a signing certificate is bought.

## The browser companion (optional)

On Windows the app needs no add-on: live scanning above does the search marks,
the page warnings and the overlay by itself, in every browser including private
windows and the DuckDuckGo browser. The companion remains for people who are not
on the Windows app. It is no longer bundled with the installer or offered in the
app.

One codebase, two packages, built by `npm run build:ext`:

| Package | Browsers | Background |
| --- | --- | --- |
| `sentinel-companion-latest.zip` | Chrome, Edge, Brave, Opera, Vivaldi | service worker (`src/background.js`) |
| `sentinel-companion-firefox-latest.zip` | Firefox 128+, LibreWolf | event page (`src/background.firefox.js`, generated) |

Every script talks to one `ext` namespace (`browser` where it exists, otherwise
`chrome`) and uses promises, which both engines support; `tests/extension.test.js`
fails the build on a bare `chrome.*` call or a callback. Firefox has no
`externally_connectable`, so pairing runs entirely through the `/connect` page's
content script, and it grants host access on request, so the popup asks for it
the first time. Firefox also runs content scripts in a sandbox where
`globalThis` is not `window`, so shared objects are read from `globalThis`.
Sign the Firefox build with `npx web-ext sign` before distributing it outside
the app.

### What the companion's live scanning looks like

Inside the browser, the companion draws the same thing the app draws from
outside: a golden line under a faint golden tint while results are checked,
then a mark on every result (a yellow, orange or red mask exactly as the engine
returned it, or a quiet tick). Its overlay lives in a closed shadow root with
`pointer-events: none`, respects reduced motion, and only renders: verdicts
come from the background worker, and nothing in the page script can assign red.

Live hours are spent only when Sentinel actually checks something, and only
for a tab that is in use. On Max and Ultimate every result is researched as a
second pass; the plan gate is `server/lib/plans.js`.

### Browser support

| Browser | Companion add-on | Live scanning with no add-on (Windows app) | How the companion was checked |
| --- | --- | --- | --- |
| Chrome | yes | yes | `verify-companion.js`, Chrome 153: 10 of 10 results marked, overlay seen |
| Edge | yes | yes | same, Edge 153 |
| Firefox | yes (temporary add-on until signed) | yes | `verify-companion-firefox.js`, Firefox 156: 10 of 10 marked, overlay seen |
| Brave | yes, the Chromium package | yes | `verify-companion.js` in a Windows 11 virtual machine, Brave 153: 10 of 10 marked, overlay seen |
| Opera | yes, the Chromium package | yes | same, Opera (Chromium 152): 10 of 10 marked, overlay seen |
| Vivaldi | yes, the Chromium package | yes | not run; it takes the same package through the same engine |
| LibreWolf | yes, the Firefox package | yes | not run; same engine and package as Firefox |
| DuckDuckGo browser | **no** | yes (Windows) | it has no extension support at all, on any platform |

`npm run verify:companion` loads the built packages into real browsers,
headless, in throwaway profiles (DevTools pipe and `Extensions.loadUnpacked`
for Chromium, Marionette for Firefox), pairs them with the running desktop app,
and checks a results page end to end. The page is served locally at the search
engine's address; its links are honest sites and made-up scam-style addresses,
and none of them is ever opened.

## The static site

`npm run build:static` exports `web/` to `dist-static/` for hosts with no Node
server (GitHub Pages and the like). It expands the same `@include` partials the
server renders, rewrites root-absolute links so the site works from a subpath,
and bakes today's demo verdicts in, so the search demo, mask explorer and
Spot-the-scam game still run against real scan results. Anything that needs the
API - sign-in, live scans, the app - links back to the full site instead.

The public site is served from `wyattbombara/sentinel` (GitHub Pages at
wyattbombara.github.io/sentinel). That repository only ever holds build output:

```bash
npm run publish:site
```

builds `web/` for that address and pushes one commit there, using the git
credentials already on this machine. `.github/workflows/pages.yml` also
publishes a copy to this repository's own Pages site on every push that touches `web/`.
Turn it on once under **Settings -> Pages -> Source: GitHub Actions**. Keeping
the static copy as a build output is what stops it drifting from the real site.

## Deploy to www.usesentinel.technology

```bash
cd deploy && docker compose up -d --build
```

Before that: point DNS for `usesentinel.technology` and `www.usesentinel.technology` at the server, copy `.env.example` to `.env`, and set `SESSION_SECRET`. Optional: `GOOGLE_CLIENT_ID/SECRET`, `SAFE_BROWSING_API_KEY`, `RESEND_API_KEY` (password-reset emails).

## Accounts and sessions

- **Creating an account does not sign you in.** Sign-up writes the account and
  sends you to the sign-in page. An email registers once: a second sign-up
  with the same address gets a clear "already registered" (409) and the first
  account is untouched. Email is the sign-in identifier, so two accounts on
  one address would make sign-in and password reset ambiguous.
- **Stay signed in** is a box on the sign-in page. Ticked: a persistent cookie,
  and the session ends after **30 days of not using Sentinel**. Expiry is
  rolling: any authenticated request pushes it forward (`last_seen` is written
  at most once a minute), `/auth/me` re-issues the cookie so the browser's
  30 days slide too, and an hourly sweep plus a check on use end sessions that
  have sat idle. Not ticked: a session cookie with no lifetime, dropped when
  the browser closes, and a 12-hour idle limit on the server. Only an explicit
  `true` counts. The paired app and companion use their own tokens, which end
  after 90 idle days.
- **Every session is listed** under Security with how it ends, and each can be
  signed out by itself; the others are not touched.
- **The accounts file is separate and looked after.** `sentinel.db` holds
  accounts, sessions, history and settings. The threat lists, more than a
  million rows rewritten every few hours, live in `sentinel-feeds.db`, a cache
  that is deleted and downloaded again if it is ever damaged. The accounts file
  gets an integrity check on every start: damaged indexes are rebuilt, rows that
  point at accounts which no longer exist are removed, and a file that cannot
  be repaired is set aside (never deleted) while the last verified backup is
  restored. Backups are taken at start and every six hours. One server per
  database: a second one refuses to start rather than share the file. The
  claim (`server/lib/dblock.js`) is taken before the file is opened and
  records when its process and the computer started, so a claim left by a
  killed server is recognised as stale even when Windows has since given its
  process number to another program. A bare process number got that wrong and
  could stop the scanner from ever starting again after a restart. A file
  left far larger than what it holds (the threat lists used to live in it, and
  the desktop app stops its server without a clean close) is shrunk on start.
- The desktop app's device account only powers background protection. It never
  signs the window in and never replaces a person's session.

## Security

scrypt password hashing · account lockout · TOTP two-factor with replay protection · session list with per-session revoke · rolling session expiry · password reset with single-use expiring links · HttpOnly/`__Host-` cookies · CSRF origin checks + JSON-only bodies · strict CSP, HSTS, COOP/CORP, frame denial · per-IP and per-account rate limits · SSRF-safe research fetcher (private/metadata IPs blocked, DNS pinned per hop) · path-traversal-safe static server · AES-256-GCM for stored secrets · audit log · no admin HTTP surface (`npm run admin`) · extension message-origin validation · desktop IPC origin checks, sandboxed renderer.

Operator commands:

```bash
node scripts/admin.js set-plan user@example.com max
```

## Threat lists

Every scan starts by looking the address up in 15 free, keyless public lists
(`server/lib/scan/feeds.js`): OpenPhish, PhishTank, Phishing.Database, the
malware-filter phishing and URLhaus lists, CERT Polska, DurableNapkin,
Spam404, MetaMask, ScamSniffer, Polkadot.js, URLhaus, ThreatFox, Feodo Tracker
and Blackbook. A hit in any of them is evidence, and evidence means a
confirmed (red) verdict rather than a guess. A hit is: the exact address is
listed, the domain is listed, or the site's own front page is listed.

A *different* page on a host that serves a listed address is an inference, not
a listing, and it is treated as one: the verdict is "Likely" (orange) and says
so in words ("Another page on this site is listed by PhishTank; this address
is not"). It becomes red only when the address also fails checks of its own,
which is what separates a throwaway host from a large service where one tenant
misbehaved. Before 1.4.3 any such page was red, and with the lists loaded that
made `app.hubspot.com/login` a confirmed scam because of one PhishTank entry
elsewhere on the host. Services that carry other people's pages (form
builders, site builders, mail-tracking links, document shares; the lists
themselves show which: `new.express.adobe.com` alone has over a thousand
listed pages) are judged page by page. Each list refreshes on its own interval, and a verdict says how many
of them had loaded when it was made.

When nothing is listed, the name is still compared with at least ten known
scam domains by edit distance and shared distinctive tokens
(`server/lib/scan/compare.js`), and the result reports how many it was
measured against.

## Testing the scanner

Three layers, none of which download or run malware:

- `npm test` runs the fixture suite (`tests/`): a local fixture server serves fake scam kits, disguised files and an `EICAR`-style known-bad sample, so every rule is exercised against pages that never leave this machine.
- `npm run probe` checks that the address rules generalise: 69 made-up scam-style addresses that appear in no feed (fake logins, parcel fees, tech-support alerts, prize bait, crypto giveaways, clearance stores) (`walletconnect-dapp-sync.app`, `portal-hr-payroll.net/adp/login`, `x7k29q.cloudfront.net/login.html`, a login page under `/.well-known/`...) against 102 real sites that use the same words legitimately (support.com, wallet.com, verify.gov, password.com among them) (`walletconnect.com`, `www.adp.com/logins.aspx`, `outlook.live.com/owa/`, `www.dropbox.com/login`...). Research is off, so nothing is fetched. Last run: 68 of 69 flagged, 0 of 102 false alarms, both with the threat lists empty (the worst case, a fresh install) and with them loaded (about 430,000 listed hosts and addresses); the one miss is the bucket case listed under Known limits. Run it both ways: the loaded run is the one that caught the false red described under Threat lists.
- `npm run evaluate` downloads the current OpenPhish list (addresses only; no phishing page is opened) and judges each address by the checklist alone, with no list lookup and no research. Last run: 166 of 300 flagged (55.3%: 114 yellow, 52 orange, 0 red; it was 44.3% before the rules added in 1.4.3 and 1.4.4, which came from reading what that run missed), 0 of 127 legitimate sites flagged, 0 of 32 when researched. In normal use every one of those 300 is on a list and comes back red; this is what the address rules manage unaided.
- `tests/auth.test.js` proves accounts are durable: sign-in after the server process is killed and restarted, the 30-day rolling window, the session-only cookie, expiry after 30 idle days, duplicate email refused, per-session revoke, and the database repairing itself.
- `npm run verify:companion` drives real browsers (see Browser support).

What was deliberately not done: no confirmed-malicious URL was fetched, no malware sample was downloaded or placed on disk, and no protection was disabled to make a test pass.

## Known limits

- **No hosted server until launch.** The desktop app runs its own copy; the static site cannot sign people up. `brand.json` drives the origin the extension and hosted app will talk to once `www.usesentinel.technology` resolves.
- **No payment processing yet.** Production defaults to `BILLING_MODE=disabled` (upgrade buttons explain plans are coming). Stripe or similar must be added before charging.
- **The desktop app does not research.** Its embedded server runs with `RESEARCH_ENABLED=0`, so a person's computer never opens a suspicious page; scans say so in place of the research section. Research needs the hosted service.
- **Email verification needs a mail provider.** Without `RESEND_API_KEY` the server records the account and tells the person verification is unavailable; it never pretends to have sent anything.
- **The app draws over the browser, not in it.** Marks are placed from what Windows reports about where links are, about twice a second, so while a page is scrolling they trail it by a fraction of a second and come back in beside their links when it settles. They sit beside the link text, not inside the page layout.
- **Private windows are recognised by their title.** English, German, French, Spanish and Portuguese wording is known. A browser in another language is treated as an ordinary window until its wording is added.
- **Live scanning marks search results, not every link on every page.** Every page you open is checked; links inside ordinary pages are not marked.
- **The DuckDuckGo browser cannot run the companion.** It supports no extensions on any platform, so it gets page warnings from the Windows app and nothing else. (DuckDuckGo *search* in any other browser is fully supported.)
- **Chrome no longer loads extensions from the command line.** `--load-extension` is ignored by branded Chrome, so the app opens `chrome://extensions` for "Load unpacked" instead, and the test harness uses the DevTools pipe.
- **Live scanning is Windows-only.** It uses UI Automation, which macOS and Linux
  do not offer in the same form. Elsewhere the companion add-on does this job.
- **The Firefox companion is unsigned.** Firefox only installs signed add-ons
  permanently, so until it is submitted to addons.mozilla.org it loads as a
  temporary add-on (about:debugging) and goes away when Firefox closes.
- **A plain page in a storage bucket scores "caution", not "suspicious".** `storage.googleapis.com/x/index.html` with no login wording in the address gets 22 points from the address alone; the page has to be fetched (research on) for the form and script checks to add to that.
- The Windows installer is unsigned, so SmartScreen will warn until it's code-signed. macOS/Linux builds are configured but untested.
- **A page on a listed host that is not itself listed is "Likely", not "Confirmed".** That is deliberate (see Threat lists). An ordinary-looking address on a throwaway host therefore shows orange until a list names it or its domain.
- **Accounts lost before 1.4.0 cannot be brought back.** The damaged database had already lost those rows; 1.4.0 repairs the file, keeps what survived and stops it happening again, but anyone affected has to register once more.
- The browser companion loads unpacked until it's published to the Chrome Web Store; Gmail/Outlook selectors may need upkeep when those apps change.
