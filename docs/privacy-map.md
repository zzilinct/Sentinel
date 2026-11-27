# Privacy map

Every way data can leave a person's device, and every place it is kept. `web/privacy.html` says the same in plain
words; when one changes, change the other. `tests/privacy-map.test.js` fails when a new outbound request appears in
the code without a line in the call-site table at the end.

Two set-ups matter:

- **Windows app (default).** The app starts its own copy of the Sentinel server on `127.0.0.1` (ports 47821 to
  47825). The app window, live scanning, download protection and a paired companion all talk to that copy. Anything
  that goes to it stays on the computer. Only the requests marked "internet" below leave it.
- **Hosted service** (`www.usesentinel.technology`, not live yet). The web app, and a companion that is not paired
  with the Windows app, talk to Sentinel's servers instead.

## 1. Requests that leave the computer: Windows app

| What is sent | Where | Why | When | Can it be turned off |
|---|---|---|---|---|
| The app's version, your IP address (as for any download) | GitHub Releases (`github.com`, `objects.githubusercontent.com`) | Find and download updates | 20 s after start, then every 2 hours; the installer only when a newer version exists | No switch. Choosing a model in Settings stops downloads; checks go on |
| Your IP address | `api.github.com` releases list | List the versions (models) you can choose | At most every 6 hours, only when Settings or your account asks which versions exist | No switch |
| Your IP address | GitHub Releases | Download an older model's installer | Only when you choose that model in Settings | Do not choose one |
| Nothing about you (a plain download) | Public threat lists: `openphish.com`, `data.phishtank.com`, `feodotracker.abuse.ch`, `hole.cert.pl`, `malware-filter.gitlab.io`, `raw.githubusercontent.com` | Keep the threat lists current | Each list every 6 to 24 hours | No switch |
| A site's name (for example `example.com`), never the full link; your IP address | The domain registry IANA lists for that ending (via `data.iana.org`, once a day), or `rdap.org` | How old the site is | Delicate live scanning only, never for a private window. Delicate is off until chosen | Choose Fast (the default) |
| A site's name | Your own DNS resolver | Does the site exist, does it have mail servers | Delicate live scanning only | Choose Fast |
| A game's place number only | `apis.roblox.com`, `games.roblox.com` (public game pages) | Know which game is being played, so ordinary game talk is not mistaken for danger | Chat safety on and a Roblox game in front. Chat safety is off until turned on | Turn chat safety off |
| The first 5 of the 40 characters of a password's SHA-1 hash, never the rest (k-anonymity; the answer is padded) | `api.pwnedpasswords.com` (Have I Been Pwned) | Warn when a new password is in a known breach | At sign-up, a password reset and a password change | No switch |
| The messages you type to an assistant, with your own key | OpenAI, Anthropic, Google or DeepSeek | The optional AI assistants | Only when you connect a key and send a message | Do not connect one, or disconnect it |
| Everything the app's own server would see | A Sentinel server you name in the app | Use a hosted Sentinel instead of the one on your computer | Only if you set a server address | Leave it unset |

Never sent from the Windows app: page contents, what you type, chat messages, texts, emails, screenshots, file
contents, clipboard text, your history, the addresses you visit (outside delicate scanning's site name), crash
reports or analytics. There are none of the last two. The app never opens a suspicious page from your computer
(`RESEARCH_ENABLED=0` in `desktop/src/server.js`).

## 2. Requests that leave the browser: companion

| What is sent | Where | Why | When | Can it be turned off |
|---|---|---|---|---|
| The site and path of each page you open. The part after `?` only when local signs say the site may not be what it seems (a raw IP, a punycode name, a name and password in the address, another address in the query, or an earlier flagged verdict for the site), never from a private window. The part after `#` never (`sendable()` and `looksOff()` in `extension/src/background.js`) | Your scanner: the Windows app on `127.0.0.1` once paired, otherwise Sentinel's servers | Check the page | Signed in, live scanning on | Live scanning switch in the companion |
| The addresses of search results, links in web chats, a link your pointer rests on, trimmed the same way. For the link your pointer rests on, also the words shown on that link (up to 120 characters), never from a private window | Your scanner | Marks beside them; a link whose words name a different site gets a warning | Signed in, live scanning on | Live scanning switch |
| For a page whose address already looks suspect (on a free hosting service, or scored 8 or more), after it has loaded: four facts read on your computer, namely whether the page has a password box, whether the form holding it sends it to another site, whether the page is one window-sized frame, and the name of the protected brand its title says (one of Sentinel's own list of company names, or none). Only when the page shows at least one of them, never from a private window | Your scanner | A page that asks for a password under another company's name on a free service gets a warning; the server never opens the page | Signed in, live scanning on | Live scanning switch |
| `mode: fast` or `mode: delicate` | Your scanner | Which checks to run | Every check | Fast is the default; Delicate is a choice in Settings |
| Sender, reply-to, subject, a text excerpt (an opened email: up to 6,000 characters), link addresses, attachment names | Your scanner | Masks in Gmail and Outlook on the web | Email protection on (off until turned on), Pro and up, also in a private window the companion is allowed in. The scanner keeps nothing from any email it checks this way | Email protection switch |
| A link you choose to scan or report, or a site you trust or block | Your scanner | What you asked for | Only when you ask | Do not ask |
| Your sign-in token | Your scanner | Know your plan and allowances | Every 15 minutes while signed in; the threat list every hour | Sign out |
| Nothing about you is sent. The companion downloads one public file, the threat list: every host on the lists Sentinel reads, as a sorted file the same for everybody (`threats.bin` on the `threat-list` branch of Sentinel's repository, made daily by `.github/workflows/threat-list.yml`). The request carries no cookie, no account and nothing about you; it asks again only whether the file changed (an `If-None-Match` header holding the file's own tag) | `raw.githubusercontent.com` (GitHub) | Check a listed site or a copy of a well-known brand on this device, with no scanner. An address found this way is answered there and is not sent to a scanner. A listed site you open by hand can still receive your browser's own request before the block page replaces it, as any site you visit does | The hourly alarm, signed in or not | Live scanning switch |
| Nothing (asks for the look) | `127.0.0.1:47821` | Use the theme chosen in the Windows app | When one of the companion's own pages opens | No switch, never leaves the computer |

Never sent from the companion: page text, the page's title (it is matched on your computer against a list of company names, and only a matched name goes), what you type, passwords (the password alarm keeps a salted hash on the
computer), web chat messages, copied text, your browsing history.

## 3. Requests from the website and web app

Every request goes to the site it was loaded from (`/api/v1/...`, its own fonts, scripts and 3D models), with one
exception: the download page asks `api.github.com` for the newest version number. No analytics, trackers, ads,
crash reporters, third-party fonts or third-party scripts. GitHub Pages, which serves the public site, logs visitors'
IP addresses under GitHub's own policy.

## 4. Requests from the hosted service (Sentinel's servers)

| What is sent | Where | Why | When |
|---|---|---|---|
| The page's address without the part after `?` (live scanning) or as given (a pasted link) | The site being checked | Research: read the page | Delicate scans only. From Sentinel's servers, never from your device. Nothing from your browser session |
| A site's name | Its domain registry, DNS | How old it is, does it resolve | Delicate scans |
| The address being checked | Google Safe Browsing | A second opinion | Delicate scans only, and only if the operator sets a key; capped per day. Never in a fast scan, never in the Windows app |
| Your email address and the message | Resend | Account emails (confirm, reset) | When one is sent |
| A one-time sign-in code | Google | "Continue with Google" | Only when you choose it |
| As in section 1 | Threat lists, Have I Been Pwned, AI providers | As in section 1 | As in section 1 |

## 5. What is kept, where, and for how long

On the person's own computer (Windows app, `%APPDATA%\Sentinel`), never sent:

| What | How long |
|---|---|
| Account, settings, scan history, trusted and blocked sites (the app's own server database) | As in the hosted table below; the database never leaves the computer |
| `logs/watch.log`: time, browser, verdict and address of each checked page, without the part after `?` or `#`. Never a private window, never a hovered link | Rolling, emptied past 512 KB |
| `logs/app.log`, the server's log | Rolling, 1 MB and 2 MB |
| Exposure alerts: a keyed hash of each site and calendar day | 14 days; alerts 30 days. Off until turned on |
| Your sites: a hashed day count per site, then the plain site name after three days in a month | Until removed. On by default, only on the computer's own server, never sent |
| Week counters (numbers only) | 35 days |
| Which minutes live scanning ran (no addresses) | 8 days |
| Accounts file repair copies | 7 days |

On the hosted service (when live), tied to an account:

| What | Why | How long |
|---|---|---|
| Email, name, password hash, theme and accent | The account | Until deleted |
| Scan history (what was checked, when, the result; flagged live results only) | History page | 30 days |
| Which minutes live scanning ran (no addresses) | Weekly allowance | 8 days |
| Weekly usage counters, Your week counters | Allowances, Your week | 35 days |
| Sessions (browser name, IP, last use) | Signed-in devices | Until ended, 12 hours to 90 days idle |
| Security log with IP | Misuse | 180 days |
| Reports | Shared threat confirmation | Linked to you until the account is deleted |
| Exposure alert hashes | Exposure alerts (opt-in) | 14 and 30 days |
| AI keys, encrypted | Assistants | Until disconnected |

Not tied to anyone: research cache by hashed address (3 days), verdict cache by site name, file fingerprints, threat
lists.

Server logs: no access log (`deploy/Caddyfile` has none). The server writes only error lines with the method and the
path, never the part after `?`, a request body, an address being checked, a message or an email address
(`server/index.js`, `server/routes/scan.routes.js`, `server/lib/mailer.js`). Docker keeps at most 3 files of 5 MB per
service (`deploy/docker-compose.yml`), oldest dropped first. `SENTINEL_LOG=1` adds one line per request with the path
only; it is off by default.

## 6. Defaults that were changed for 1.21.1

- Companion: live checks are Fast unless Delicate is chosen in its Settings (before: Delicate for every Pro plan).
- Companion: email protection is off until turned on (before: on).
- Companion: sends a page's site and path only; the part after `?` only when local signs say the site may not be what it seems; the part after `#` never.
- Companion: choosing Delicate shows, while it is chosen, that Sentinel's servers open the page and the address may be checked with Google Safe Browsing.
- Server: Google Safe Browsing is asked only in a delicate scan (before: every scan, when a key was set).
- Server: a client that names no mode gets Fast (before: Delicate for Pro and up).
- Server: which minutes live scanning ran is kept 8 days (before: 21).
- Hosted: no access log (before: every request's address, IP and browser, kept without limit); logs capped at 15 MB per service.
- Scan history is kept 30 days (before: 90), on the hosted service and on the computer.
- Companion: once, after this update, the popup tells someone who never chose that email checking is now off, with a button to turn it back on.
- Windows app: `watch.log` no longer keeps the part of an address after `?` or `#`.
- The server's "email not configured" log line no longer names the recipient; a failed scan's log line no longer
  carries the query.

## 7. Call sites

Every outbound request in the code, as a fingerprint: the file, the function it sits in, the call, and its target
(the URL constant up to its first variable part, or the expression the address comes from). `tests/lib/request-sites.js`
finds them: `fetch`, `http(s).get`, `.request`, `dns` lookups, `WebSocket`, `sendBeacon`, `XMLHttpRequest` and the
update check. A new request, or one swapped, moved or pointed elsewhere, fails `tests/privacy-map.test.js` until this
table and the tables above say where it goes.

| File | Function | Call | Target | Goes to |
|---|---|---|---|---|
| `desktop/src/chatwatch.js` | `getJson` | `https.get` | `url` | Roblox public game pages, by place number (chat safety on) |
| `desktop/src/main.js` | `apiOnce` | `fetch` | `${ORIGIN}${pathname}` | The app's own server on 127.0.0.1, or a server address you set |
| `desktop/src/main.js` | `requestDeviceToken` | `fetch` | `${ORIGIN}/api/v1/auth/device` | The app's own server on 127.0.0.1 (this computer's account) |
| `desktop/src/models.js` | `getJson` | `fetch` | `url` | GitHub API: the releases list (a model you choose) |
| `desktop/src/models.js` | `install` | `fetch` | `exe.browser_download_url` | GitHub Releases: a model's manifest and installer (a model you choose) |
| `desktop/src/models.js` | `install` | `fetch` | `manifest.browser_download_url` | GitHub Releases: a model's manifest and installer (a model you choose) |
| `desktop/src/updater.js` | `check` | `autoUpdater.checkForUpdates` | `(none)` | GitHub Releases: update checks, every 2 hours |
| `extension/src/background.js` | `appLook` | `fetch` | `${APP_ORIGIN}/api/v1/look` | 127.0.0.1:47821, the Windows app (the look, and whether the app is here for the companion's sign-in links) |
| `extension/src/lib/device.js` | `refreshList` | `fetch` | `listUrl` | `raw.githubusercontent.com`: the public threat list file, hourly, only whether it changed (the companion keeps the file in the browser's cache) |
| `extension/src/lib/api.js` | `apiFetch` | `fetch` | `${apiBase}${path}` | The companion's scanner: 127.0.0.1 paired, or Sentinel's servers |
| `server/lib/auth.js` | `googleExchange` | `fetch` | `https://oauth2.googleapis.com/token` | Google (only "Continue with Google") |
| `server/lib/mailer.js` | `send` | `fetch` | `https://api.resend.com/emails` | Resend (hosted account emails) |
| `server/lib/models.js` | `refresh` | `fetch` | `https://api.github.com/repos/` | GitHub API: releases list, at most every 6 hours |
| `server/lib/scan/feeds.js` | `refreshFeed` | `fetch` | `feed.url` | Public threat lists |
| `server/lib/scan/netguard.js` | `guardedLookup` | `dns.lookup` | `hostname` | DNS, for the page being researched (hosted only) |
| `server/lib/scan/netguard.js` | `requestOnce` | `lib.request` | `target` | The page being researched (hosted only; off in the Windows app) |
| `server/lib/scan/research.js` | `dnsRecord` | `dns[method]` | `host` | DNS: the site name (delicate only) |
| `server/lib/scan/research.js` | `fetchRdap` | `fetch` | `${await rdapBase(registrable)}domain/${e` | The domain registry for the site name (delicate only) |
| `server/lib/scan/research.js` | `rdapBase` | `fetch` | `https://data.iana.org/rdap/dns.json` | IANA: which registry answers for each ending (once a day) |
| `server/lib/scan/safebrowsing.js` | `lookup` | `fetch` | `https://safebrowsing.googleapis.com/v4/threatMatches:find` | Google Safe Browsing (hosted, only with a key) |
| `server/lib/security.js` | `breachedPassword` | `fetch` | `https://api.pwnedpasswords.com/range/` | Have I Been Pwned: 5 of the 40 characters of a SHA-1 hash |
| `server/routes/ai.routes.js` | `callUpstream` | `fetch` | `url` | The AI provider you connected |
| `web/assets/js/app.js` | `fetchOnce` | `fetch` | `src` | The site's own scripts (is it offline?) |
| `web/assets/js/app/settings.js` | `whatsNewBlock` | `fetch` | `/assets/release-note.json` | The site's own release note |
| `web/assets/js/download.js` | `(top level)` | `fetch` | `https://api.github.com/repos/` | api.github.com (newest version number) |
| `web/assets/js/home.js` | `(top level)` | `fetch` | `/api/v1/demo/examples` | The site's own /api/v1/demo |
| `web/assets/js/home.js` | `(top level)` | `fetch` | `/api/v1/demo/scan` | The site's own /api/v1/demo |
| `web/assets/js/look-app.js` | `sync` | `fetch` | `/api/v1/account/look` | The site's own /api/v1/account/look |
| `web/assets/js/site.js` | `(top level)` | `fetch` | `/api/v1/auth/me` | The site's own /api/v1 |
| `web/assets/js/site.js` | `(top level)` | `fetch` | `/api/v1/threat-stats` | The site's own /api/v1 |
| `web/assets/js/ui.js` | `api` | `fetch` | `/api/v1` | The site's own /api/v1 |

Bundles, held by their count of calls (their minified names change with each build):

| Bundle | Calls | Goes to |
|---|---|---|
| `web/assets/js/mask3d.js` | 3 | The site's own 3D models (three.js loaders) |
