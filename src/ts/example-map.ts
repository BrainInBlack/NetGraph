/**
 * Curated example network used as:
 *   - the first-run default on a fresh install
 *   - the seed when "Include example devices" is checked in the New Map dialog
 *
 * Deliberately exercises every feature so a first-run user sees what's possible:
 *   - all seven device types
 *   - the full range of "shapes" (sparse → fully-populated) so optional fields are obvious
 *   - a wide switch to demo the side-by-side card layout
 *   - all three icon sources: type defaults, `lucide:` overrides (pihole shield,
 *     desktop monitor), and a user `custom:` upload (the Raspberry Pi glyph on
 *     the home-server box — also deletable in the Icon Manager)
 *   - both link types (wired + wireless)
 *   - explicit attach sides, numeric jacks, and named ports (WAN/LINK/POE/LAN)
 *   - connection labels rendered on the line (ISP, Uplink, PoE, 5 GHz)
 *   - a VM hosted on the NAS (hostId)
 */

import { generateId } from './util';
import type { CustomIcon, NetworkMap } from './types';

/** Stable id of the seeded example custom icon, referenced by the home-server device. */
export const EXAMPLE_PI_ICON_ID = 'example-rpi';

// A hand-authored Raspberry Pi / single-board-computer glyph in the same line
// style as the Lucide defaults (stroke, currentColor, 24px box). Demonstrates a
// user-uploaded SVG icon and survives sanitization (only allow-listed tags/attrs).
const PI_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="3" y="5" width="18" height="14" rx="2"/>' +
  '<rect x="9" y="11" width="6" height="5" rx="1"/>' +
  '<line x1="6.5" y1="8" x2="17.5" y2="8"/>' +
  '</svg>';

/**
 * Custom icons seeded on a fresh install. Currently just the example Pi, which
 * the home-server device points at. Deletable in the Icon Manager like any
 * user upload — deleting it clears the reference and the card reverts to the
 * default glyph.
 */
export function exampleCustomIcons(): CustomIcon[] {
  return [{
    id: EXAMPLE_PI_ICON_ID,
    name: 'Raspberry Pi',
    kind: 'svg',
    data: PI_ICON_SVG,
    createdAt: new Date().toISOString(),
  }];
}

/**
 * Return a customIcons list guaranteed to contain the example map's icons,
 * appending any that are missing (matched by id). Idempotent. Call this
 * whenever an example map is created for an existing library — a user whose
 * storage predates the seeded icon would otherwise see the missing-icon glyph
 * on the example's home-server card.
 */
export function withExampleIcons(customIcons: CustomIcon[] | undefined): CustomIcon[] {
  const icons = customIcons ? [...customIcons] : [];
  const have = new Set(icons.map(c => c.id));
  for (const icon of exampleCustomIcons()) {
    if (!have.has(icon.id)) icons.push(icon);
  }
  return icons;
}

export function createExampleMap(name: string): NetworkMap {
  const now = new Date().toISOString();

  const modem = generateId();
  const gateway = generateId();
  const sw = generateId();
  const ap = generateId();
  const nas = generateId();
  const vm = generateId();
  const desktop = generateId();
  const laptop = generateId();
  const homeServer = generateId();

  return {
    id: generateId(),
    name,
    createdAt: now,
    updatedAt: now,
    devices: [
      // Modem — minimal: ISP-managed, often no user-facing details
      { id: modem, name: 'isp-modem', type: 'modem',
        tags: ['internet'], notes: '',
        x: 408, y: 216 },

      // Gateway — fully populated, the heart of the network
      { id: gateway, name: 'gateway', type: 'gateway',
        ip: '192.168.1.1', domain: 'router.home',
        tags: ['core', 'dhcp', 'dns'],
        notes: 'Main router. DHCP range 192.168.1.100–200.',
        x: 408, y: 336 },

      // Switch — wide so it has room for several downstream connections
      { id: sw, name: 'sw-main', type: 'switch',
        ip: '192.168.1.2',
        tags: ['core'], notes: '',
        x: 408, y: 504, width: 408 },

      // Access point — sits to the right of the gateway
      { id: ap, name: 'ap-living', type: 'ap',
        ip: '192.168.1.3',
        tags: ['wireless'], notes: '',
        x: 768, y: 336 },

      // Server — heavy: ip, port, domain, mac, multiple tags, notes
      { id: nas, name: 'nas-01', type: 'server',
        ip: '192.168.1.10', port: 5000,
        domain: 'nas.home', mac: '00:11:22:33:44:55',
        tags: ['storage', 'media'],
        notes: 'Backups + media. SMB shares enabled.',
        x: 288, y: 672 },

      // VM — hosted on the NAS; references hostId. Icon overridden to a Lucide
      // shield to show the per-device icon override (default for 'vm' is a box).
      { id: vm, name: 'pihole', type: 'vm', hostId: nas,
        ip: '192.168.1.11', iconId: 'lucide:shield',
        tags: ['adblock', 'dns'], notes: '',
        x: 48, y: 672 },

      // Wired client — ip + mac filled. Icon overridden to a Lucide monitor
      // (the default for 'client' is a laptop), demoing the override on a
      // device whose default doesn't quite fit.
      { id: desktop, name: 'desktop', type: 'client',
        ip: '192.168.1.42', mac: 'aa:bb:cc:dd:ee:ff', iconId: 'lucide:monitor',
        tags: ['workstation'], notes: '',
        x: 528, y: 672 },

      // Wireless client — intentionally sparse: just a name, nothing else
      { id: laptop, name: 'laptop', type: 'client',
        tags: [], notes: '',
        x: 768, y: 672 },

      // Home server — references a user-uploaded custom icon (custom:example-rpi).
      // Deleting that icon in the Icon Manager clears this reference, and the card
      // falls back to the default 'server' glyph. Sits left of the switch, on the
      // switch's row (the side link auto-straightens since the cards overlap).
      { id: homeServer, name: 'home-asst', type: 'server', iconId: `custom:${EXAMPLE_PI_ICON_ID}`,
        ip: '192.168.1.12', domain: 'ha.home',
        tags: ['smarthome'], notes: 'Home Assistant on a Raspberry Pi.',
        x: 48, y: 504 },
    ],
    // Sides + ports are explicit on the seed so the example demonstrates those
    // features and the layout stays predictable through future renderer changes
    // (auto-routing would produce the same shape for this layout). Between them
    // the links cover numeric jacks and the named ports (WAN/LINK/POE/LAN),
    // on-line labels, and a couple of bare links for contrast.
    links: [
      // ISP uplink → the gateway's WAN port
      { id: generateId(), sourceId: modem,   targetId: gateway,
        type: 'wired',    sourceSide: 'bottom', targetSide: 'top',  sourcePort: 1, targetPort: 'WAN',  label: 'ISP' },
      // Gateway → switch uplink
      { id: generateId(), sourceId: gateway, targetId: sw,
        type: 'wired',    sourceSide: 'bottom', targetSide: 'top',  sourcePort: 1, targetPort: 'LINK', label: 'Uplink' },
      // PoE-powered access point
      { id: generateId(), sourceId: gateway, targetId: ap,
        type: 'wired',    sourceSide: 'right',  targetSide: 'left', sourcePort: 8, targetPort: 'POE',  label: 'PoE' },
      // Numbered switch ports
      { id: generateId(), sourceId: sw,      targetId: nas,
        type: 'wired',    sourceSide: 'bottom', targetSide: 'top',  sourcePort: 2, targetPort: 1     },
      { id: generateId(), sourceId: sw,      targetId: desktop,
        type: 'wired',    sourceSide: 'bottom', targetSide: 'top',  sourcePort: 1, targetPort: 'LAN' },
      // Side link to the home server (left of the switch) — straightens via the
      // overlap rule since both cards sit on the same row.
      { id: generateId(), sourceId: sw,      targetId: homeServer,
        type: 'wired',    sourceSide: 'left',   targetSide: 'right', sourcePort: 3, targetPort: 1     },
      // Wireless client with an on-line label
      { id: generateId(), sourceId: ap,      targetId: laptop,
        type: 'wireless', sourceSide: 'bottom', targetSide: 'top',  label: '5 GHz' },
      // VM host relationship — same shape as user-created host links
      { id: generateId(), sourceId: vm,      targetId: nas,
        type: 'wired',    sourceSide: 'right',  targetSide: 'left'                 },
    ],
  };
}
