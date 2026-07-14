import type { DeviceType } from './types';
import { Router, Network, Wifi, Server, Box, Laptop, RadioTower } from 'lucide-static';

// -- Device type metadata -------------------------------------

/**
 * Default icon for each device type. Rendered when `device.iconId` is unset.
 * Values are inline SVG strings (Lucide) using `currentColor`, so they pick up
 * the surrounding text color from CSS.
 */
export const DEVICE_ICONS: Record<DeviceType, string> = {
  modem:   RadioTower,
  gateway: Router,
  switch:  Network,
  ap:      Wifi,
  server:  Server,
  vm:      Box,
  client:  Laptop,
};

export const TYPE_LABELS: Record<DeviceType, string> = {
  modem:   'Modem',
  gateway: 'Gateway / Router',
  switch:  'Network Switch',
  ap:      'Access Point',
  server:  'Server / NAS',
  vm:      'VM / Container',
  client:  'Client',
};

/** Order used for the type select in the device modal. */
export const DEVICE_TYPES: DeviceType[] = [
  'gateway',
  'switch',
  'ap',
  'server',
  'modem',
  'vm',
  'client',
];

/** Maximum length of the per-device notes field. Notes are a memo, not an essay. */
export const MAX_NOTES_LENGTH = 1000;

// -- Device card sizing ---------------------------------------

/** Preset device card widths. Default (1x) is what the SCSS sets. */
export const DEVICE_WIDTH_PRESETS = [
  { value: 204, label: 'Normal' },
  { value: 408, label: 'Wide' },
  { value: 612, label: 'Extra Wide' },
] as const;

export const DEVICE_WIDTH_DEFAULT = 204;
export const DEVICE_WIDTH_MIN = 150;
export const DEVICE_WIDTH_MAX = 1000;
