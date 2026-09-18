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

1. **Knowledge**: Sentinel's own threat database, community reports (3 independent reports make a site confirmed), live public feeds (OpenPhish, URLhaus, Phishing.Database: ~400k entries, refreshed every 6h) and optional Google Safe Browsing. **No record anywhere lowers the risk** (scam −20%, virus/malware −15%).
2. **Checklist**: 89 named checks (look-alikes, typosquats, combosquats, abused TLDs, free-hosting throwaways, disguised downloads, bait wording in several languages...). Every check explains itself in the UI.
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

`npm run evaluate` measures detection on today's live phishing feed and false alarms on 127 popular sites. At last run: **0 false alarms** on the 127 sites checklist-only, **0/32** with live research, and **0/381** pages with all live feeds loaded; **35%** of never-before-seen live phishing URLs were flagged by the checklist alone, and feed-listed ones are confirmed red.

## The desktop app

The app ships the whole Sentinel server inside it and runs it privately on
`127.0.0.1:47821` when it starts. Accounts, scanning, threat feeds and history
all work on a computer with nothing hosted anywhere; the database and logs live
in the user's app-data folder (`%APPDATA%\Sentinel` on Windows). Set
`SENTINEL_ORIGIN=https://your-sentinel.example` before launching to use a hosted
Sentinel instead, and `npm run dev` in `desktop/` to use the dev server.

Beyond running the product, the app protects on its own, with no browser
add-on involved:

- **Page watch (Windows).** It asks Windows which page the browser in front is
  showing, through the same accessibility interface screen readers use, and
  checks that address. A dangerous page gets a notification and a warning
  window. It reads the address only, never page content or anything typed.
  `desktop/src/watch.js`.
- **Browser awareness.** `desktop/src/browsers.js` reports which browsers are
  installed and which are running, so the app can say "Chrome just opened" and
  hand that browser the right companion build.
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
git tag v1.2.0 && git push origin v1.2.0
```

The workflow runs the tests, builds the installer and both companion builds,
and publishes `Sentinel-Setup.exe`, `sentinel-companion.zip`,
`sentinel-companion-firefox.zip`, `latest.yml` and `SHA256SUMS.txt`.

`latest.yml` is what installed copies read to update themselves, so a release
reaches everyone who already has the app without them downloading anything.
The download page always links to the latest release and shows its real
version and size from the GitHub API. The installer is not code-signed, so
Windows SmartScreen warns on first run until a signing certificate is bought.

## The browser companion

One codebase, two packages, built by `npm run build:ext`:

| Package | Browsers | Background |
| --- | --- | --- |
| `sentinel-companion-latest.zip` | Chrome, Edge, Brave | service worker (`src/background.js`) |
| `sentinel-companion-firefox-latest.zip` | Firefox 128+ | event page (`src/background.firefox.js`, generated) |

Every script talks to one `ext` namespace (`browser` where it exists, otherwise
`chrome`) and uses promises, which both browsers support. Firefox has no
`externally_connectable`, so pairing runs entirely through the `/connect` page's
content script, and it grants host access on request, so the popup asks for it
the first time. Sign the Firefox build with `npx web-ext sign` before
distributing it outside the app.

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

## Security

scrypt password hashing · account lockout · TOTP two-factor with replay protection · session list and revoke · password reset with single-use expiring links · HttpOnly/`__Host-` cookies · CSRF origin checks + JSON-only bodies · strict CSP, HSTS, COOP/CORP, frame denial · per-IP and per-account rate limits · SSRF-safe research fetcher (private/metadata IPs blocked, DNS pinned per hop) · path-traversal-safe static server · AES-256-GCM for stored secrets · audit log · no admin HTTP surface (`npm run admin`) · extension message-origin validation · desktop IPC origin checks, sandboxed renderer.

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
confirmed (red) verdict rather than a guess; a host that serves a listed
malicious address is confirmed too, because the whole site is dangerous while
it does. Each list refreshes on its own interval, and a verdict says how many
of them had loaded when it was made.

When nothing is listed, the name is still compared with at least ten known
scam domains by edit distance and shared distinctive tokens
(`server/lib/scan/compare.js`), and the result reports how many it was
measured against.

## Testing the scanner

Three layers, none of which download or run malware:

- `npm test` runs the fixture suite (`tests/`): a local fixture server serves fake scam kits, disguised files and an `EICAR`-style known-bad sample, so every rule is exercised against pages that never leave this machine.
- `npm run probe` checks that the address rules generalise: 58 made-up scam-style addresses that appear in no feed (fake logins, parcel fees, tech-support alerts, prize bait, crypto giveaways, clearance stores) (`walletconnect-dapp-sync.app`, `portal-hr-payroll.net/adp/login`, `x7k29q.cloudfront.net/login.html`, a login page under `/.well-known/`...) against 87 real sites that use the same words legitimately (support.com, wallet.com, verify.gov, password.com among them) (`walletconnect.com`, `www.adp.com/logins.aspx`, `outlook.live.com/owa/`, `www.dropbox.com/login`...). Research is off, so nothing is fetched. Last run: 57 of 58 flagged, 0 of 87 false alarms; the one miss is the bucket case listed under Known limits.
- `npm run evaluate` scores the seeded examples end to end (`--research-safe` keeps fetches to the local fixtures).

What was deliberately not done: no confirmed-malicious URL was fetched, no malware sample was downloaded or placed on disk, and no protection was disabled to make a test pass.

## Known limits

- **No hosted server until launch.** The desktop app runs its own copy; the static site cannot sign people up. `brand.json` drives the origin the extension and hosted app will talk to once `www.usesentinel.technology` resolves.
- **No payment processing yet.** Production defaults to `BILLING_MODE=disabled` (upgrade buttons explain plans are coming). Stripe or similar must be added before charging.
- **The desktop app does not research.** Its embedded server runs with `RESEARCH_ENABLED=0`, so a person's computer never opens a suspicious page; scans say so in place of the research section. Research needs the hosted service.
- **Email verification needs a mail provider.** Without `RESEND_API_KEY` the server records the account and tells the person verification is unavailable; it never pretends to have sent anything.
- **Page watch is Windows-only.** It uses UI Automation, which macOS and Linux
  do not offer in the same form. Elsewhere the companion add-on does this job.
- **The Firefox companion is unsigned.** Firefox only installs signed add-ons
  permanently, so until it is submitted to addons.mozilla.org it loads as a
  temporary add-on (about:debugging) and goes away when Firefox closes.
- **A plain page in a storage bucket scores "caution", not "suspicious".** `storage.googleapis.com/x/index.html` with no login wording in the address gets 22 points from the address alone; the page has to be fetched (research on) for the form and script checks to add to that.
- The Windows installer is unsigned, so SmartScreen will warn until it's code-signed. macOS/Linux builds are configured but untested.
- The browser companion loads unpacked until it's published to the Chrome Web Store; Gmail/Outlook selectors may need upkeep when those apps change.
