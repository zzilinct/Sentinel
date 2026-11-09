# Bar spot 18: warnings in the moment (branch work/e2e-bar-18, from work/e2e-bar-3)

PAUSED at the owner's request. No CI result seen yet: the first run (32862ef) sat queued and was cancelled.

## Done (commit 32862ef)
- warn.html: one verdict, the strongest reason, the rest behind "Why" (card.js styles it, refits on toggle, first
  Tab lands on the gold button). "I know this site" (signs only) or "This is wrong" plus a plain second step
  (evidence) sets the scanner's own allow rule (sites/override) via main.js trustFromWarning; parent lock guards it;
  Undo; the card says where it is kept (embedded: this computer, nothing sent).
- server: a site where anyone can publish (docs.google.com, buckets) cannot be trusted whole (shared_site), api test.
- chat.html: cards have a close and "This is wrong"; the window takes the pointer only over cards (setShape, no hook).
  chatwatch.answer: hide per message; wrong mutes that message's own signs for that sender in that chat
  (shared/chat.js `muted`, copied to extension/src/content/chat.js), kept as HMAC hashes (settings chatMuted, key in
  secure storage).
- e2e: desktop-e2e.ps1 2a (real clicks on Discord chat cards, hit test, focus kept) and 5d2 (Why, trust, undo, recheck).

## In progress (this commit, untested in CI): the coordinator's two notes
1. "Never interfere with games": inside a Roblox game and over any full-screen app the chat cards must stay
   click-through. Another way out that does not steal input: cards fold to the small mask after a few seconds, and
   hide / "This is wrong" are offered in the app and through the tray card for the last chat warning. Prove in CI that
   a click on a card over the Roblox stand-in still reaches the game.
2. A keyboard way to close chat cards without taking focus: a shortcut held only while a card shows (like the island's
   Win+Alt+I) that closes the newest card, announced in the card's label.
   Also: exercise the evidence-case ("This is wrong", red) confirm step in CI, not only by reading it.

Written so far:
- chatoverlay.js: `interactive` false in a Roblox game or when the app fills its screen; shape() then takes no click.
- chat.html: body.passive hides the buttons; cards fold into their mask after 8 s; `.key` hint and aria-label
  "Win+Alt+H hides the newest warning."
- chatwatch.latest(); main.js answerChat (shared by card, tray, app, shortcut), CHAT_KEY Super+Alt+H held only while a
  warning shows (chatChanged), chatSafetyStatus.last/canMute, trayState.chat, tray actions chat-hide/chat-wrong,
  sentinel:chat-answer + preload chatAnswer.

## Next
- tray.html: draw trayState.chat (title, detail, Hide it / This is wrong) and call trayAction('chat-hide'|'chat-wrong', n).
- web/assets/js/app.js chatSafetyPanel: the last warning with the same two buttons via desktop.chatAnswer; redraw on
  onChatSafety; panel copy: cards fold in games and Win+Alt+H.
- Unit tests: latest(), passive shape, shortcut held only while a card shows.
- desktop-e2e.ps1 Roblox section: OwnerAt(card point) is RobloxPlayerBeta, a real click keeps Roblox in front, the card
  folds after 8 s, Win+Alt+H (keybd_event 0x5B+0x12+0x48) hides it. A red warning (find one in 5c/5d) and press
  "This is wrong", check the second step's words, press "Keep the warning".
- Push, one background wait (gh run watch -i 300), read every screenshot, final report.
