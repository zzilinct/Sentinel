# Bar 12: 3D masks

Paused for the owner's usage limit. Everything is pushed on work/e2e-bar-12.

Done: sculpted models, stills, onyx studio, runtime, mask3d.js, form gate in mask_qa.py, tests. CI on 31f0d29: all green except Desktop core (use), FAIL pay-pause-leaves-with-page, which has no link to the masks (recheck on the final commit).

Last commit bakes occlusion from the body alone, to remove the black blotch beside the right cheek on the plates, and deepens the gold and the ember.

Next:
1. Read CI on the latest commit: hover-plate-spin.png (blotch gone?), hero-1366, phone-home-part1, light-home-part1, masks-qa renders, mask-rest numbers.
2. Stills use Blender's gold (1, 0.71, 0.29); live gold is (1, 0.6, 0.16). Check the hand-over from onyx.webp to the live hero for a jump.
3. Report per builder.md. Baseline at rest: 8.6 draws/s, 43% busy (bar-13). Mine on 31f0d29: 7.2 draws/s, 46% busy. Bytes: glb total was 1409 KB, stills smaller, mask3d.js 627 to 620 KB; onyx-only pages now also fetch studio-scam.hdr (20 KB).
4. Tell the owner about the stray C:\r1\scam-yellow.png (a test render; deleting it needs their approval).
