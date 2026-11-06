# Bar 12: 3D masks

Paused at the owner's request. Everything is pushed; last commit ba27722 (CI was running when paused, not read).

Done this round (grader's three asks):
- Grain on the live brow: the normal and occlusion maps are softened by 1 and 1.6 px after the bake (masks.py soften()), models rebaked, QA passes.
- Gold wire too wide and bright live: the gold's glow now lights only upward faces (pow(saturate(normal.y), 2)), lift 1.2, floor 0.22.
- Diff tool: scratchpad m12/diff.py (still, live, out). Before: mean abs diff 17.3, 15.7% of pixels off by more than 24 (handover-diff-before.png).

Next:
1. Read CI on ba27722: all runs, the mask-rest dispatch (42144074823), handover-still/live jpgs.
2. Run diff.py on the new hand-over, look at the brow and the wire; name before and after files.
3. Note: part of the remaining difference is pose, not shading (the live mask drifts while photographed; the still is turned a little more). Consider freezing drift for the capture, or matching POSES.lay rest to the still.
4. Delete PROGRESS.md before the final commit, report in a few lines.
