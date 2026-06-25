import type { Device } from '../types';

const SNAP = 24; // Must match $grid-sm in _variables.scss
const CARD_WIDTH = 204;
const CARD_HEIGHT = 140;
const GAP_X = 120;
const GAP_Y = 120;
const STEP_X = Math.ceil((CARD_WIDTH + GAP_X) / SNAP) * SNAP;   // 336
const STEP_Y = Math.ceil((CARD_HEIGHT + GAP_Y) / SNAP) * SNAP;  // 264
const START_X = Math.ceil(300 / SNAP) * SNAP;                     // 312
const START_Y = Math.ceil(200 / SNAP) * SNAP;                     // 216

/** Position new devices in a grid, avoiding overlap with existing ones. */
export function autoPosition(newDevices: Device[], existing: Device[]): Device[] {
  const occupied = new Set(
    existing.map(d => `${Math.round(d.x / STEP_X)},${Math.round(d.y / STEP_Y)}`)
  );

  let col = 0;
  let row = 0;
  const maxCols = 6;

  return newDevices.map(device => {
    // Find next free grid cell
    while (occupied.has(`${col},${row}`)) {
      col++;
      if (col >= maxCols) { col = 0; row++; }
    }

    const x = START_X + col * STEP_X;
    const y = START_Y + row * STEP_Y;
    occupied.add(`${col},${row}`);

    col++;
    if (col >= maxCols) { col = 0; row++; }

    return { ...device, x, y };
  });
}
