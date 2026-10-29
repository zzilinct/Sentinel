'use strict';
/*
 * Where each live mask stands, how far it may move, and how wide its camera sees: shared by mask3d.src.js and
 * tests/mask-frame.test.js, which turns every model through all of this motion and checks that no part of it ever
 * leaves the camera's view (so no mask is ever cut off at its canvas's edge).
 */

// Camera: this far from the pivot, seeing this many degrees top to bottom; a box narrower than MIN_ASPECT widens it.
const CAMERA = { z: 7.6, fov: 20, minAspect: 0.72 };

// rest: the holder's resting turn (Blender's lay pose, x -24, y 28, z 16 degrees, carried into glTF's axes, as the
// renders were made). frame: offset and size, so the hero's model sits exactly where its still picture (onyx.webp)
// does and takes over without a jump. zoom: the camera sees this much wider and the canvas is drawn this much larger,
// so the mask stays the same size on the page but has room to turn: the hero, tipped and turned, reached past its
// canvas while it watched the pointer, and the virus mask's spores past a plate's while it swayed.
const POSES = {
  lay: { rest: { x: -0.42, y: 0.28, z: -0.49 }, frame: { x: -0.17, y: -0.19, s: 1.15 }, zoom: 1.3 },
  plate: { rest: { x: 0, y: 0, z: 0 }, frame: { x: 0, y: 0, s: 1 }, zoom: 1.08 },
  stand: { rest: { x: 0, y: -0.18, z: 0 }, frame: { x: 0, y: 0, s: 1 }, zoom: 1 }
};

// tan of half the vertical view for a canvas of this shape.
function halfView(aspect, zoom) {
  const fov = aspect < CAMERA.minAspect ? CAMERA.fov * (CAMERA.minAspect / aspect) : CAMERA.fov;
  return Math.tan((fov * Math.PI) / 360) * zoom;
}

// The pivot's turn and lift at time t (seconds) while watching look.x, look.y (each -1 to 1) with weight look.w
// (0 to 1). sway: masks that do not watch turn slowly on their own, like a piece on a display stand.
function drift(t, look, sway, reduced) {
  const breathe = reduced ? 0 : Math.sin(t * 1.1) * 0.035 * (1 - look.w);
  const s = sway && !reduced ? { y: Math.sin(t * 0.42) * 0.34, x: Math.sin(t * 0.31) * 0.06 } : { y: 0, x: 0 };
  return {
    x: look.y * 0.45 + breathe * 0.4 + s.x,
    y: look.x * 0.6 + s.y + (reduced ? 0 : Math.sin(t * 0.55) * 0.05 * (1 - look.w)),
    z: -look.x * 0.05,
    lift: reduced ? 0 : Math.sin(t * 0.9) * 0.05
  };
}

module.exports = { CAMERA, POSES, halfView, drift };
