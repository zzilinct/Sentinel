# Changelog

## 1.6.1 — scanning reliability

- Fresh threat-feed imports now invalidate old scan verdicts.
- Research results stay separate for URLs with different query strings or protocols.
- Repeat scans of downloads without filename extensions retain their file checks.
- Interrupted downloads are marked incomplete instead of being fingerprinted as whole files. Failed and partial research results are not cached as completed scans.
- Shortcut headers and UTF-16 script text are checked correctly by the existing file rules.
- Email scans check pasted links and up to 60 linked addresses, with clear reporting when checks fail or hit the limit.
- Redirect checks cover intermediate and same-site destinations, with points assigned to the correct threat type.
- Research network restrictions consistently reject private and reserved IPv6 destinations.

Validation: 113 automated tests passed. These are bug fixes; no new scanning mode or archive-scanning capability is included.

The shared scanner fixes apply to the embedded desktop server and the server-backed web app. Full page fetching remains disabled on desktop. The marketing website remains static; this update does not deploy a hosted scanning API.

See [the code review](CODE_REVIEW.md) for suggested future improvements. A version entry describes the prepared source; published installers are listed on [GitHub Releases](https://github.com/zzilinct/Sentinel/releases).
