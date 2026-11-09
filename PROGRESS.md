# Bar 12: 3D masks

Paused at the owner's request. Everything is pushed; last code commit b42ee01 (CI running when paused: dispatch 42536766975 with mask-rest,galaxy; push runs too).

Where it stands (grader's asks: hand-over still to live, grain on the live brow, wire width):
- f4c507d: live masks use the stills' AgX look (contrast 1.2 in AgX log, ShaderChunk patch in mask3d.src.js); studio panoramas re-rendered at 2048 samples. Aligned diff after it: mean 16.6, 17.7% of pixels off by >24 (scratchpad m12/handover-diff-after.png). Brow grain still visible live.
- b42ee01: onyx clearcoatRoughness 0.03 -> 0.1 (grain suspected to be the near-mirror coat showing the 128 px panorama's pixels); GOLD_LIFT onyx 1.2 -> 0.8 so the wire is as dark as in the still.
- Pose: the rest rotation is proven equal to Blender's (scratchpad m12/posecheck.py, max screen diff 0.0). The remaining offset in the hand-over frames is the live drift (breathing and sway) at the moment of the photo; diff.py aligns by the best small shift.
- f4c507d's Website run failed only "galaxy: the spiral reads" (not touched by this work); re-checking it in the dispatch.

Next:
1. Read CI on b42ee01; run scratchpad m12/diff.py on ci handover-still/live; look at the brow and the wire.
2. If the grain remains: test a 256 px tall panorama, or check the normal map's WebP compression on the brow.
3. Delete PROGRESS.md, final commit, short report with handover-diff-before/after named.
