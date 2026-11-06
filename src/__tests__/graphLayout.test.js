import { describe, expect, it } from 'vitest';
import { layout } from '../components/research/KnowledgeGraph';

const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const edges = [{ source: 'a', target: 'b', weight: 3 }, { source: 'b', target: 'c', weight: 1 }];

describe('knowledge graph layout', () => {
  it('is deterministic and keeps every node inside the canvas', () => {
    const one = layout(nodes, edges);
    const two = layout(nodes, edges);
    for (const n of nodes) {
      const p = one.get(n.id);
      expect(p).toEqual(two.get(n.id));
      expect(p.x).toBeGreaterThanOrEqual(40); expect(p.x).toBeLessThanOrEqual(720);
      expect(p.y).toBeGreaterThanOrEqual(24); expect(p.y).toBeLessThanOrEqual(436);
    }
  });

  it('pulls linked nodes closer than unlinked ones', () => {
    const l = layout(nodes, edges);
    const d = (x, y) => Math.hypot(l.get(x).x - l.get(y).x, l.get(x).y - l.get(y).y);
    expect(d('a', 'b')).toBeLessThan(d('a', 'd'));
  });
});
