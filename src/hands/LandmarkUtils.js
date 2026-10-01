import { clamp } from '../utils/Math.js';

// MediaPipe hand landmark indices (21 points).
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_PIP: 6,
  INDEX_DIP: 7,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_PIP: 10,
  MIDDLE_DIP: 11,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_PIP: 14,
  RING_DIP: 15,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
};

/** Fingers as [mcp, pip, tip] chains, thumb handled separately. */
export const FINGERS = [
  { name: 'thumb', mcp: LM.THUMB_MCP, tip: LM.THUMB_TIP },
  { name: 'index', mcp: LM.INDEX_MCP, pip: LM.INDEX_PIP, tip: LM.INDEX_TIP },
  { name: 'middle', mcp: LM.MIDDLE_MCP, pip: LM.MIDDLE_PIP, tip: LM.MIDDLE_TIP },
  { name: 'ring', mcp: LM.RING_MCP, pip: LM.RING_PIP, tip: LM.RING_TIP },
  { name: 'pinky', mcp: LM.PINKY_MCP, pip: LM.PINKY_PIP, tip: LM.PINKY_TIP },
];

const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

/** Distance from wrist to middle-finger MCP — the palm scale, used to normalise. */
export function palmScale(lm) {
  return Math.max(dist3(lm[LM.WRIST], lm[LM.MIDDLE_MCP]), 1e-4);
}

/**
 * Palm centre as the mean of wrist + the four finger MCPs.
 * Far steadier than any single landmark, which matters a lot for the dolly.
 */
export function palmCenter(lm) {
  const ids = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let x = 0;
  let y = 0;
  let z = 0;
  for (const id of ids) {
    x += lm[id].x;
    y += lm[id].y;
    z += lm[id].z ?? 0;
  }
  const n = ids.length;
  return { x: x / n, y: y / n, z: z / n };
}

/**
 * Per-finger extension in [0,1], normalised by palm size so it is
 * distance-invariant.
 */
export function fingerExtensions(lm) {
  const scale = palmScale(lm);
  const out = {};
  for (const f of FINGERS) {
    if (f.name === 'thumb') {
      // Thumb does not have a usable pip in our chain: measure how far the tip
      // strays from the index MCP, sideways from the palm line.
      const tip = lm[f.tip];
      const mcp = lm[f.mcp];
      const wrist = lm[LM.WRIST];
      const palmDir = { x: mcp.x - wrist.x, y: mcp.y - wrist.y };
      const palmLen = Math.hypot(palmDir.x, palmDir.y) || 1e-4;
      const ux = palmDir.x / palmLen;
      const uy = palmDir.y / palmLen;
      const vx = tip.x - wrist.x;
      const vy = tip.y - wrist.y;
      // Projection along the palm axis, plus a sideways component bonus.
      const along = (vx * ux + vy * uy) / scale;
      const sideways = Math.abs(-vx * uy + vy * ux) / scale;
      out.thumb = clamp((along - 0.55) / 0.75 + (sideways - 0.32) * 0.75, 0, 1);
    } else {
      // Straightness of the mcp->pip->tip chain.
      const span = dist3(lm[f.mcp], lm[f.tip]);
      const bend = dist3(lm[f.pip], lm[f.tip]);
      // span/bend is 1 when perfectly straight, ~1.35 when folded.
      const ratio = span / Math.max(bend, 1e-4);
      out[f.name] = clamp((ratio - 1.04) / 0.3, 0, 1);
    }
  }
  return out;
}

/** How flat the palm is — a hard requirement to avoid gripping the camera. */
export function palmFlatness(lm) {
  const scale = palmScale(lm);
  const fingertips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
  const mcpIds = [LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
  let above = 0;
  for (let i = 0; i < fingertips.length; i += 1) {
    const tip = lm[fingertips[i]];
    const mcp = lm[mcpIds[i]];
    // Video coords: Y grows downward, so an extended finger has smaller Y.
    if (tip.y < mcp.y - scale * 0.18) above += 1;
  }
  return above / fingertips.length;
}

/** Screen-space distance between two landmark sets (aspect-corrected). */
export function handDistance(a, b, aspect = 16 / 9) {
  const dx = (a.x - b.x) * aspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

/** Index fingertip position, used for the "point/aim" style interactions. */
export function indexTip(lm) {
  return lm[LM.INDEX_TIP];
}

/** Angle of the palm axis in degrees, 0 = pointing up. */
export function palmAngle(lm) {
  const wrist = lm[LM.WRIST];
  const mid = lm[LM.MIDDLE_MCP];
  return Math.atan2(mid.x - wrist.x, -(mid.y - wrist.y));
}

export const HAND_BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
