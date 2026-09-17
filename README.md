# Sentinel

**See the scam before you click.** Real-time scam, virus and malware protection for search results, email and downloads.
Brand domain: **[usesentinel.technology](url)** (configured in [brand.json](brand.json)).

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

| | Free | Pro | Max |
|---|---|---|---|
| Link scans / week | 10 (no research, scam mask only) | 40 (researched, all masks) | 100 (researched, all masks) |
| Virus & malware scans / week | 5 | 40 | 100 |
| Live scanning / week | — | 24 h (checklist, no research) | 96 h (every result researched) |
| Email masks (Gmail/Outlook) | — | ✓ | ✓ |
| Paste-in email scans | — | — | ✓ (counts as a link scan) |
| Download protection (app) | — | ✓ | ✓ |

Prices ($6 / $14) are placeholders in [server/lib/plans.js](server/lib/plans.js).

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
deploy/            docker-compose + Caddy (automatic HTTPS for www.sentinelscan.com)
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

## Build the app and companion

```bash
npm run build
```

```bash
cd desktop && npm install && npm run dist:win
```

```bash
node scripts/publish-desktop.js
```

The installer is copied to `web/downloads/` and the download page picks it up automatically.

## Deploy to www.sentinelscan.com

```bash
cd deploy && docker compose up -d --build
```

Before that: point DNS for `sentinelscan.com` and `www.sentinelscan.com` at the server, copy `.env.example` to `.env`, and set `SESSION_SECRET`. Optional: `GOOGLE_CLIENT_ID/SECRET`, `SAFE_BROWSING_API_KEY`, `RESEND_API_KEY` (password-reset emails).

## Security

scrypt password hashing · account lockout · TOTP two-factor with replay protection · session list and revoke · password reset with single-use expiring links · HttpOnly/`__Host-` cookies · CSRF origin checks + JSON-only bodies · strict CSP, HSTS, COOP/CORP, frame denial · per-IP and per-account rate limits · SSRF-safe research fetcher (private/metadata IPs blocked, DNS pinned per hop) · path-traversal-safe static server · AES-256-GCM for stored secrets · audit log · no admin HTTP surface (`npm run admin`) · extension message-origin validation · desktop IPC origin checks, sandboxed renderer.

Operator commands:

```bash
node scripts/admin.js set-plan user@example.com max
```

## Known limits

- **sentinelscan.com is registered to someone else** (since 2017, via CSC Corporate Domains). Change `brand.json` to a domain you own before publishing the companion, because it sends browsing data to that origin.
- **No payment processing yet.** Production defaults to `BILLING_MODE=disabled` (upgrade buttons explain plans are coming). Stripe or similar must be added before charging.
- No email verification at sign-up.
- The Windows installer is unsigned, so SmartScreen will warn until it's code-signed. macOS/Linux builds are configured but untested.
- The browser companion loads unpacked until it's published to the Chrome Web Store; Gmail/Outlook selectors may need upkeep when those apps change.
