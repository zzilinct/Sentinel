# Bar spot 18: warnings in the moment (branch work/e2e-bar-18, from work/e2e-bar-3)

Done in round 1:
- warn.html: one verdict, the strongest reason, the rest behind "Why" (card.js styles it, refits on toggle).
  "I know this site" (signs only) or "This is wrong" plus a plain second step (evidence) sets the scanner's own
  allow rule (sites/override) via main.js trustFromWarning; parent lock guards it; Undo; card says where it is kept.
- server: a site where anyone can publish (docs.google.com, buckets) cannot be trusted whole (shared_site).
- chat.html: cards have a close and "This is wrong"; the window takes the pointer only over cards (setShape, no hook).
  chatwatch.answer: hide per message, wrong mutes that message's signs for that sender in that chat
  (shared/chat.js `muted`), kept as HMAC hashes in settings (chatMuted), key in secure storage.
- e2e: desktop-e2e.ps1 2a (real clicks on chat cards, hit test, focus kept) and 5d2 (Why, trust, undo, re-check).

Next: read CI screenshots, fix what they show, final full run, report.
