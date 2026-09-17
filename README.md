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

The workflow runs the tests, builds the installer and the companion, and
publishes `Sentinel-Setup.exe`, `sentinel-companion.zip` and `SHA256SUMS.txt`.
The download page always links to the latest release and shows its real
version and size from the GitHub API. The installer is not code-signed, so
Windows SmartScreen warns on first run until a signing certificate is bought.

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

## Known limits

- **Point DNS before publishing the companion.** `brand.json` drives the origin the extension and desktop app talk to, so `www.usesentinel.technology` must resolve to the server before either is distributed.
- **No payment processing yet.** Production defaults to `BILLING_MODE=disabled` (upgrade buttons explain plans are coming). Stripe or similar must be added before charging.
- No email verification at sign-up.
- The Windows installer is unsigned, so SmartScreen will warn until it's code-signed. macOS/Linux builds are configured but untested.
- The browser companion loads unpacked until it's published to the Chrome Web Store; Gmail/Outlook selectors may need upkeep when those apps change.
