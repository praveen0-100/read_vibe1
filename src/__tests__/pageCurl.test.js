import { describe, expect, it } from 'vitest';
import { clipHalfPlane, cornerAt, foldGeometry } from '../lib/pageCurl';

const W = 360; const H = 600;
const area = (p) => Math.abs(p.reduce((a, [x, y], i) => { const [x2, y2] = p[(i + 1) % p.length]; return a + (x * y2 - x2 * y); }, 0)) / 2;

describe('page curl geometry', () => {
  it('leaves a flat page alone until the corner has actually moved', () => {
    expect(foldGeometry([W, H], [W, H], W, H)).toBeNull();
  });

  it('splits the page into a staying part and a folded part that together are the whole page', () => {
    const g = foldGeometry([W, H], [200, 420], W, H);
    expect(area(g.stay) + area(g.fold)).toBeCloseTo(W * H, 3);
    expect(g.fold.length).toBeGreaterThanOrEqual(3);
  });

  it('mirrors the held corner exactly onto the finger', () => {
    const C = [W, H]; const P = [150, 380];
    const { reflect: [a, b, c, d, tx, ty] } = foldGeometry(C, P, W, H);
    const x = a * C[0] + c * C[1] + tx; const y = b * C[0] + d * C[1] + ty;
    expect(x).toBeCloseTo(P[0], 3); expect(y).toBeCloseTo(P[1], 3);
  });

  it('keeps points on the fold line where they are', () => {
    const g = foldGeometry([W, H], [100, 300], W, H);
    const [a, b, c, d, tx, ty] = g.reflect;
    const [mx, my] = g.m;
    expect(a * mx + c * my + tx).toBeCloseTo(mx, 3); expect(b * mx + d * my + ty).toBeCloseTo(my, 3);
  });

  it('turns the whole page away by the end of the path, and none of it at the start', () => {
    const start = foldGeometry([W, H], cornerAt(0.01, W, H), W, H);
    expect(area(start.stay)).toBeGreaterThan(W * H * 0.95);
    const end = foldGeometry([W, H], cornerAt(1, W, H), W, H);
    expect(end.stay.length < 3 || area(end.stay) < 1).toBe(true);
  });

  it('clips a polygon against a half-plane', () => {
    const half = clipHalfPlane([[0, 0], [10, 0], [10, 10], [0, 10]], [5, 0], [1, 0], 1);
    expect(area(half)).toBeCloseTo(50, 6);
  });
});
