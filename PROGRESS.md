# Bar 15, practice inbox: paused

Code is final at d2a8be5 (origin/main 1.19.4 merged, main had not moved). Full CI was started on d2a8be5, not read yet.
This note is a separate [skip ci] commit. Delete it before the report. The code is unchanged since d2a8be5.

What d2a8be5 fixed, after full CI on e527d4d:
- The practice check crashed at line 223. The text-message picture step closed and reopened too fast and the history back raced. It now waits 400 ms, and finishRun reads the open card's own data-id.
- /practice CLS was 0.21 mobile (performance 86, floor 95). The empty list now reserves 770 px.

Failures not in my diff (my diff is only the practice files, review-shots.js and llms.txt):
- auth-shell slow sign-in (2 checks), on e527d4d.
- desktop core (use) pay-pause-leaves-with-page, on 4ca5aad and e527d4d.
- guest double press, on 4ca5aad only.

Next:
1. Read CI on d2a8be5: practice checks, perf-a11y /practice (want 95 or more, CLS 0).
2. Download the verify-web artifact. Look at practice-*-text.png (the text sender note) and a few of the others.
3. Delete this note, push, report against the bar.
