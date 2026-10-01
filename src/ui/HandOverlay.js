import { HAND_BONES, FINGERS } from '../hands/LandmarkUtils.js';

const COLORS = {
  skeleton: 'rgba(110, 231, 255, 0.85)',
  rotate: 'rgba(110, 231, 255, 1)',
  zoom: 'rgba(192, 132, 252, 1)',
  point: 'rgba(255, 255, 255, 0.95)',
  label: 'rgba(234, 242, 255, 0.9)',
};

/**
 * Draws the webcam feed's landmark skeleton on a 2D canvas overlay so you can
 * see exactly what the tracker thinks your hands are doing. Also renders the
 * open/closed bars used by the finger panel.
 */
export class HandOverlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
  }

  resize(cssWidth, cssHeight) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(cssWidth * this.dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * this.dpr));
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
  }

  clear() {
    const { ctx } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** @param {object} state tracker state  @param {string} gesture active gesture */
  draw(state, gesture) {
    this.clear();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    const w = this.cssWidth ?? this.canvas.width / this.dpr;
    const h = this.cssHeight ?? this.canvas.height / this.dpr;

    for (const hand of state.hands) {
      const lm = hand.landmarks;
      // The <video> is mirrored via CSS, so mirror the overlay to match.
      const px = (p) => [(1 - p.x) * w, p.y * h];

      ctx.lineWidth = 1.6;
      ctx.strokeStyle = hand.open ? COLORS[gesture.toLowerCase()] ?? COLORS.skeleton : 'rgba(255,255,255,0.28)';
      ctx.beginPath();
      for (const [a, b] of HAND_BONES) {
        const [ax, ay] = px(lm[a]);
        const [bx, by] = px(lm[b]);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();

      // Joints: finger tips get filled dots so open fingers pop visually.
      for (const f of FINGERS) {
        const [tx, ty] = px(lm[f.tip]);
        const isOpen = hand.extensions[f.name] > 0.55;
        ctx.beginPath();
        ctx.arc(tx, ty, isOpen ? 3.1 : 1.8, 0, Math.PI * 2);
        ctx.fillStyle = isOpen ? COLORS.point : 'rgba(255,255,255,0.4)';
        ctx.fill();
      }

      const [cx, cy] = px(hand.center);
      ctx.beginPath();
      ctx.arc(cx, cy, 9, 0, Math.PI * 2);
      ctx.strokeStyle = hand.open ? COLORS[gesture.toLowerCase()] ?? COLORS.skeleton : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.font = '9px ui-monospace, monospace';
      ctx.fillStyle = COLORS.label;
      ctx.fillText(`${hand.label}${hand.open ? ' · OPEN' : ''}`, cx + 12, cy + 3);
    }

    // Baseline distance bar for the 2-hand zoom.
    if (gesture === 'ZOOM' && state.handCount >= 2) {
      const mx = (1 - state.center.x) * w;
      const my = state.center.y * h;
      const spread = state.spread;
      ctx.strokeStyle = COLORS.zoom;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(mx - 34, my);
      ctx.lineTo(mx + 34, my);
      ctx.stroke();

      const len = 34 * Math.max(-1, Math.min(1, spread));
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + len, my);
      ctx.stroke();

      ctx.fillStyle = COLORS.label;
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      const label = spread > 0.05 ? 'ZOOM IN' : spread < -0.05 ? 'ZOOM OUT' : 'HOLD';
      ctx.fillText(label, mx, my + 15);
      ctx.textAlign = 'left';
    }
  }
}
