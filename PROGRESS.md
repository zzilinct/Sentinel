# Bar 12: 3D masks

Done (uncommitted work now committed, not yet shippable):
- masks.py: the extruded icon is replaced by a sculpted mask (distance field, surface nets), four parts: body, trim (swept gold), liner, ember.
- mask3d.src.js: halo quads and glow texture gone, parts mapped by material name, point lights in the sockets. Not rebuilt yet.
- pose.js: lay rest pose changed. frame x, y, s still the old values.

Next:
1. Bake scam, malware, virus into web/assets/models, regenerate studio-onyx.hdr and all stills, rebuild mask3d.js.
2. Recompute POSES.lay frame so the model matches onyx.webp.
3. mask_qa.py: looks gate (parts, eye recess, horn sweep, silhouette, normal busyness), must fail on the old models. Add onyx renders, light and dark.
4. tests: mask-models (maps on body only), mask-frame (all primitives).
5. CI, read the screenshots, report.
