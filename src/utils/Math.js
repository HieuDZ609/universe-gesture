export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);

export const lerp = (a, b, t) => a + (b - a) * t;

export const inverseLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

export const smoothstep = (edge0, edge1, x) => {
  const t = clamp(inverseLerp(edge0, edge1, x), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Frame-rate independent exponential smoothing factor. */
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

export const dampVec = (out, target, rate, dt) => {
  const t = damp(rate, dt);
  out.x += (target.x - out.x) * t;
  out.y += (target.y - out.y) * t;
  out.z += (target.z - out.z) * t;
  return out;
};

/** Shortest signed angular difference in radians, in (-PI, PI]. */
export const shortestAngle = (from, to) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
};

/** Symmetric deadzone: returns 0 inside [-t, t], otherwise value - sign(value)*t. */
export const deadzone = (v, t) => {
  const a = Math.abs(v);
  if (a <= t) return 0;
  return Math.sign(v) * (a - t);
};

/** Mulberry32 — small deterministic PRNG so the universe looks identical each load. */
export function makeRandom(seed = 0x9e3779b9) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller normal sample from a uniform [0,1) generator. */
export function gaussian(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v);
}
