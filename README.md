# Sentinel

Real-time scam website checker for the browser — **https://sentinelscamscan.com**

Sentinel puts a colour-coded mask next to search results:

| Mask | Meaning | Based on |
|---|---|---|
| none | nothing found | allowlist, official brand domains, low score |
| 🟡 yellow | suspicious | heuristics, score 30–54 |
| 🟠 orange | likely scam | heuristics, score 55+ |
| 🔴 red | confirmed scam | **evidence only**: blocklist, Google Safe Browsing, or 3+ user reports |

It also blocks confirmed/likely scams with a full-page warning when you open them from anywhere.

## Run it

Needs Node 22.5+ (uses the built-in `node:sqlite`). **No `npm install`: there are no dependencies.**

```bash
npm run build
```

```bash
npm start
```

Open http://localhost:8787. Copy `.env.example` to `.env` to configure Google sign-in, Safe Browsing and production settings.

## Install the extension (dev)

1. `npm run build` (writes `web/downloads/sentinel-chrome-latest.zip`)
2. `chrome://extensions` → Developer mode → **Load unpacked** → select `extension/`
3. Open the extension's **Options** and set *Sentinel server* to `http://localhost:8787`
4. Sign in from the popup

To let the website detect/pair with an unpacked build, run on the site's console:
`localStorage.setItem('sentinel.extensionId', '<id from chrome://extensions>')`

## Layout

```
server/            zero-dependency Node API + static host
  lib/scan/engine.js   scoring: evidence layer + URL heuristics
  lib/scan/lists.js    brands, risky TLDs, keywords, seed block/allow lists
  lib/auth.js          scrypt passwords, sessions, Google OAuth, AES-GCM key storage
  routes/              auth, scan/report/override/stats, AI workspace
extension/         Chrome MV3 extension
  src/background.js    service worker: scans, navigation guard, intel sync
  src/content/serp.js  mask badges on Google/Bing/DDG/Yahoo/Brave/Ecosia/Startpage/...
  src/content/guard.js full-page warning
web/               marketing site, auth pages, dashboard + AI workspace
scripts/           icon renderer and extension packager (pure Node)
```

## AI workspace

The dashboard has four tabs: ChatGPT, Claude, Gemini, DeepSeek. Each connects with an **API key from the user's own account**, verified against the provider and stored AES-256-GCM-encrypted. Sentinel never shows a login form for another company's service — that pattern is indistinguishable from phishing.

## Going to production

- Buy/point `sentinelscamscan.com` at the host, terminate TLS, set `NODE_ENV=production`, `PUBLIC_ORIGIN=https://sentinelscamscan.com`, and a random `SESSION_SECRET`.
- Google sign-in: create an OAuth web client, redirect URI `https://sentinelscamscan.com/api/v1/auth/google/callback`.
- Add `SAFE_BROWSING_API_KEY` for a real external threat feed.
- Publish the extension to the Chrome Web Store, then add its ID to `web/assets/js/config.js` and remove `http://localhost:8787/*` from the manifest.
- Back up `data/sentinel.db`.
