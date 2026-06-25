import { describe, it, expect } from 'vitest';
import { autoPosition } from './layout';
import type { Device } from '../types';

function device(id: string): Device {
  return { id, name: id, type: 'client', tags: [], notes: '', x: 0, y: 0 };
}

// Mirrors the constants in layout.ts.
const START_X = 312, START_Y = 216, STEP_X = 336, STEP_Y = 264;

describe('autoPosition', () => {
  it('places a single device at the start cell', () => {
    const [d] = autoPosition([device('a')], []);
    expect(d.x).toBe(START_X);
    expect(d.y).toBe(START_Y);
  });

  it('lays devices left-to-right across a row', () => {
    const out = autoPosition([device('a'), device('b'), device('c')], []);
    expect(out.map(d => d.x)).toEqual([START_X, START_X + STEP_X, START_X + 2 * STEP_X]);
    expect(out.every(d => d.y === START_Y)).toBe(true);
  });

  it('wraps to the next row after 6 columns', () => {
    const out = autoPosition(Array.from({ length: 7 }, (_, i) => device(`d${i}`)), []);
    expect(out[6].x).toBe(START_X);
    expect(out[6].y).toBe(START_Y + STEP_Y);
  });

  it('skips grid cells already occupied by existing devices', () => {
    const existing = { ...device('e'), x: 0, y: 0 }; // rounds to grid cell "0,0"
    const [d] = autoPosition([device('a')], [existing]);
    expect(d.x).toBe(START_X + STEP_X); // pushed past the occupied cell
    expect(d.y).toBe(START_Y);
  });

  it('returns new objects, leaving inputs unmutated', () => {
    const input = device('a');
    const [out] = autoPosition([input], []);
    expect(out).not.toBe(input);
    expect(input.x).toBe(0);
    expect(input.y).toBe(0);
  });
});
