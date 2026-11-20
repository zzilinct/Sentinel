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
| The first 5 characters of a password's SHA-1 hash | `api.pwnedpasswords.com` (Have I Been Pwned) | Warn when a new password is in a known breach | When a password is set or changed | No switch |
| The messages you type to an assistant, with your own key | OpenAI, Anthropic, Google or DeepSeek | The optional AI assistants | Only when you connect a key and send a message | Do not connect one, or disconnect it |
| Everything the app's own server would see | A Sentinel server you name in the app | Use a hosted Sentinel instead of the one on your computer | Only if you set a server address | Leave it unset |

Never sent from the Windows app: page contents, what you type, chat messages, texts, emails, screenshots, file
contents, clipboard text, your history, the addresses you visit (outside delicate scanning's site name), crash
reports or analytics. There are none of the last two. The app never opens a suspicious page from your computer
(`RESEARCH_ENABLED=0` in `desktop/src/server.js`).

## 2. Requests that leave the browser: companion

| What is sent | Where | Why | When | Can it be turned off |
|---|---|---|---|---|
| The address of each page you open (without the part after `#`; from a private window also without the part after `?`) | Your scanner: the Windows app on `127.0.0.1` once paired, otherwise Sentinel's servers | Check the page | Signed in, live scanning on | Live scanning switch in the companion |
| The addresses of search results, links in web chats, a link your pointer rests on | Your scanner | Marks beside them | Signed in, live scanning on | Live scanning switch |
| `mode: fast` or `mode: delicate` | Your scanner | Which checks to run | Every check | Fast is the default; Delicate is a choice in Settings |
| Sender, reply-to, subject, a text excerpt (an opened email: up to 6,000 characters), link addresses, attachment names | Your scanner | Masks in Gmail and Outlook on the web | Email protection on (off until turned on), Pro and up | Email protection switch |
| A link you choose to scan or report, or a site you trust or block | Your scanner | What you asked for | Only when you ask | Do not ask |
| Your sign-in token | Your scanner | Know your plan and allowances | Every 15 minutes while signed in; the threat list every hour | Sign out |
| Nothing (asks for the look) | `127.0.0.1:47821` | Use the theme chosen in the Windows app | When one of the companion's own pages opens | No switch, never leaves the computer |

Never sent from the companion: page text, what you type, passwords (the password alarm keeps a salted hash on the
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
| The address being checked | Google Safe Browsing | A second opinion | Only if the operator sets a key; capped per day |
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
| Scan history (what was checked, when, the result; flagged live results only) | History page | 90 days |
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
- Companion: the part of an address after `#` is never sent.
- Server: a client that names no mode gets Fast (before: Delicate for Pro and up).
- Server: which minutes live scanning ran is kept 8 days (before: 21).
- Hosted: no access log (before: every request's address, IP and browser, kept without limit); logs capped at 15 MB.
- Windows app: `watch.log` no longer keeps the part of an address after `?` or `#`.
- The server's "email not configured" log line no longer names the recipient; a failed scan's log line no longer
  carries the query.

## 7. Call sites

Every outbound request in the code, by file and count. A new `fetch`, `http(s).get/request`, `dns` lookup,
`WebSocket`, `sendBeacon`, `XMLHttpRequest` or update check changes a count here, and the test fails until this
table and the tables above say where it goes.

| File | Calls | Goes to |
|---|---|---|
| `desktop/src/main.js` | 2 | The app's own server on `127.0.0.1` (or a server address you set) |
| `desktop/src/updater.js` | 1 | GitHub Releases (updates) |
| `desktop/src/models.js` | 3 | GitHub API and Releases (a model you choose) |
| `desktop/src/chatwatch.js` | 1 | Roblox public game pages, by place number |
| `extension/src/lib/api.js` | 1 | The companion's scanner (`127.0.0.1` paired, or Sentinel's servers) |
| `extension/src/background.js` | 1 | `127.0.0.1:47821` (the look) |
| `server/lib/models.js` | 1 | GitHub API (releases list) |
| `server/lib/scan/feeds.js` | 1 | Public threat lists |
| `server/lib/scan/research.js` | 3 | IANA, domain registries, DNS (delicate only) |
| `server/lib/scan/netguard.js` | 2 | DNS and the page being checked (hosted research only; off in the Windows app) |
| `server/lib/scan/safebrowsing.js` | 1 | Google Safe Browsing (hosted, only with a key) |
| `server/lib/security.js` | 1 | Have I Been Pwned (5 hash characters) |
| `server/lib/mailer.js` | 1 | Resend (hosted account emails) |
| `server/lib/auth.js` | 1 | Google (only "Continue with Google") |
| `server/routes/ai.routes.js` | 1 | The AI provider you connected |
| `web/assets/js/download.js` | 1 | `api.github.com` (newest version number) |
| `web/assets/js/ui.js` | 1 | The site's own `/api/v1` |
| `web/assets/js/site.js` | 2 | The site's own `/api/v1` |
| `web/assets/js/home.js` | 2 | The site's own `/api/v1/demo` |
| `web/assets/js/look-app.js` | 1 | The site's own `/api/v1/account/look` |
| `web/assets/js/app.js` | 1 | The site's own scripts (is it offline?) |
| `web/assets/js/app/settings.js` | 1 | The site's own release note |
| `web/assets/js/mask3d.js` | 3 | The site's own 3D models (three.js loaders) |
