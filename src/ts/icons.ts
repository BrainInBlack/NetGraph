import {
  // Network gear
  Router, Server, HardDrive, Database, Network, EthernetPort,
  // Wireless
  Wifi, RadioTower, Antenna, SatelliteDish,
  // Cloud / services
  Cloud, Globe,
  // Devices
  Monitor, Laptop, Smartphone, Tablet, Tv, Printer, Webcam, Speaker, Gamepad2,
  // Compute
  Cpu, Box, Package, Terminal,
  // Security
  Shield, Lock, Key,
  // Misc
  Plug, Power, Home,
  // Fallback
  CircleHelp,
} from 'lucide-static';

import type { CustomIcon } from './types';
import { escapeHtml } from './util';

/** Shown when an iconId can't be resolved (lucide name renamed, custom icon deleted, etc.). */
const ICON_NOT_FOUND_SVG = CircleHelp;

export interface IconCatalogEntry {
  id: string;
  name: string;
  category: string;
  svg: string;
}

/** Curated networking-relevant subset of Lucide. */
export const ICON_LIBRARY: IconCatalogEntry[] = [
  // Network gear
  { id: 'lucide:router',         name: 'Router',         category: 'Network',  svg: Router        },
  { id: 'lucide:server',         name: 'Server',         category: 'Network',  svg: Server        },
  { id: 'lucide:hard-drive',     name: 'Hard Drive',     category: 'Network',  svg: HardDrive     },
  { id: 'lucide:database',       name: 'Database',       category: 'Network',  svg: Database      },
  { id: 'lucide:network',        name: 'Network',        category: 'Network',  svg: Network       },
  { id: 'lucide:ethernet-port',  name: 'Ethernet Port',  category: 'Network',  svg: EthernetPort  },

  // Wireless
  { id: 'lucide:wifi',           name: 'Wi-Fi',          category: 'Wireless', svg: Wifi          },
  { id: 'lucide:radio-tower',    name: 'Radio Tower',    category: 'Wireless', svg: RadioTower    },
  { id: 'lucide:antenna',        name: 'Antenna',        category: 'Wireless', svg: Antenna       },
  { id: 'lucide:satellite-dish', name: 'Satellite Dish', category: 'Wireless', svg: SatelliteDish },

  // Cloud / services
  { id: 'lucide:cloud',          name: 'Cloud',          category: 'Services', svg: Cloud         },
  { id: 'lucide:globe',          name: 'Globe',          category: 'Services', svg: Globe         },

  // Devices
  { id: 'lucide:monitor',        name: 'Monitor',        category: 'Devices',  svg: Monitor       },
  { id: 'lucide:laptop',         name: 'Laptop',         category: 'Devices',  svg: Laptop        },
  { id: 'lucide:smartphone',     name: 'Smartphone',     category: 'Devices',  svg: Smartphone    },
  { id: 'lucide:tablet',         name: 'Tablet',         category: 'Devices',  svg: Tablet        },
  { id: 'lucide:tv',             name: 'TV',             category: 'Devices',  svg: Tv            },
  { id: 'lucide:printer',        name: 'Printer',        category: 'Devices',  svg: Printer       },
  { id: 'lucide:webcam',         name: 'Webcam',         category: 'Devices',  svg: Webcam        },
  { id: 'lucide:speaker',        name: 'Speaker',        category: 'Devices',  svg: Speaker       },
  { id: 'lucide:gamepad-2',      name: 'Game Console',   category: 'Devices',  svg: Gamepad2      },

  // Compute
  { id: 'lucide:cpu',            name: 'CPU',            category: 'Compute',  svg: Cpu           },
  { id: 'lucide:box',            name: 'Container',      category: 'Compute',  svg: Box           },
  { id: 'lucide:package',        name: 'Package',        category: 'Compute',  svg: Package       },
  { id: 'lucide:terminal',       name: 'Terminal',       category: 'Compute',  svg: Terminal      },

  // Security
  { id: 'lucide:shield',         name: 'Shield',         category: 'Security', svg: Shield        },
  { id: 'lucide:lock',           name: 'Lock',           category: 'Security', svg: Lock          },
  { id: 'lucide:key',            name: 'Key',            category: 'Security', svg: Key           },

  // Misc
  { id: 'lucide:plug',           name: 'Plug',           category: 'Other',    svg: Plug          },
  { id: 'lucide:power',          name: 'Power',          category: 'Other',    svg: Power         },
  { id: 'lucide:home',           name: 'Home',           category: 'Other',    svg: Home          },
];

const LIBRARY_BY_ID = new Map(ICON_LIBRARY.map(i => [i.id, i]));

/**
 * Friendly display name for an icon - used in modals where we want to tell
 * the user which icon is selected. Falls back to the raw ID if unknown.
 */
export function iconDisplayName(iconId: string | undefined, customIcons: CustomIcon[] | undefined): string | null {
  if (!iconId) return null;
  if (iconId.startsWith('lucide:')) return LIBRARY_BY_ID.get(iconId)?.name ?? iconId.slice('lucide:'.length);
  if (iconId.startsWith('custom:')) {
    const id = iconId.slice('custom:'.length);
    return customIcons?.find(c => c.id === id)?.name ?? 'Custom icon';
  }
  return iconId;
}

/**
 * Resolve an iconId to its renderable HTML.
 * - `lucide:<name>` -> the static SVG markup (uses currentColor)
 * - `custom:<id>`   -> SVG markup or `<img>` tag, depending on the custom icon's kind
 * - unset / unknown -> the "icon not found" SVG
 */
export function renderIconHtml(iconId: string | undefined, customIcons: CustomIcon[] | undefined): string {
  if (!iconId) return ICON_NOT_FOUND_SVG;

  if (iconId.startsWith('lucide:')) {
    return LIBRARY_BY_ID.get(iconId)?.svg ?? ICON_NOT_FOUND_SVG;
  }

  if (iconId.startsWith('custom:')) {
    const id = iconId.slice('custom:'.length);
    const custom = customIcons?.find(c => c.id === id);
    if (!custom) return ICON_NOT_FOUND_SVG;
    if (custom.kind === 'svg') return custom.data;
    return `<img src="${escapeHtml(custom.data)}" alt="${escapeHtml(custom.name)}" />`;
  }

  return ICON_NOT_FOUND_SVG;
}
