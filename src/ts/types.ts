// -- Device types ----------------------------------------------

export type DeviceType =
  | 'modem'
  | 'gateway'
  | 'switch'
  | 'ap'
  | 'server'
  | 'vm'
  | 'client';

export interface Device {
  id: string;
  name: string;
  type: DeviceType;
  ip?: string;
  port?: number;
  domain?: string;
  mac?: string;
  tags: string[];
  notes: string;
  /** Canvas position */
  x: number;
  y: number;
  /** For VMs/containers - id of the host device */
  hostId?: string;
  /**
   * Optional icon override.
   * Format: `lucide:<name>` for built-in icons, `custom:<id>` for user-uploaded ones.
   * If unset, the device type's default emoji is used.
   */
  iconId?: string;
  /**
   * Optional card width override (px). Lets hub-like devices stretch wider so
   * many fanned-out connections have room. Unset = CSS default (204px).
   */
  width?: number;
}

// -- Custom icons ----------------------------------------------

export interface CustomIcon {
  id: string;
  name: string;
  /** 'svg' = inline SVG markup; 'image' = base64 data URL (PNG/JPG) */
  kind: 'svg' | 'image';
  data: string;
  createdAt: string;
}

// -- Connections -----------------------------------------------

export type LinkType = 'wired' | 'wireless';

export type LinkSide = 'top' | 'bottom' | 'left' | 'right';

/**
 * Named ports for connection endpoints. Anything outside this set must be
 * numeric (stored as a number). Free-form strings are intentionally not
 * supported - keeps labels short and the visual language consistent.
 */
export const NAMED_PORTS = ['WAN', 'LAN', 'LINK', 'SFP', 'POE', 'MGMT', 'TRUNK'] as const;
export type NamedPort = typeof NAMED_PORTS[number];

/** A port is either a positive integer (jack number) or one of NAMED_PORTS. */
export type LinkPort = number | NamedPort;

export interface Link {
  id: string;
  sourceId: string;
  targetId: string;
  type: LinkType;
  label?: string;
  /** Override the auto-picked attach side at the source. */
  sourceSide?: LinkSide;
  /** Override the auto-picked attach side at the target. */
  targetSide?: LinkSide;
  /** Numeric jack or a named port (e.g. WAN, SFP) at the source. */
  sourcePort?: LinkPort;
  /** Numeric jack or a named port at the target. */
  targetPort?: LinkPort;
}

// -- Network map -----------------------------------------------

export interface NetworkMap {
  id: string;
  name: string;
  devices: Device[];
  links: Link[];
  createdAt: string;
  updatedAt: string;
}

// -- App state -------------------------------------------------

export interface AppState {
  activeMapId: string;
  maps: NetworkMap[];
  /** Globally available custom icons, shared across maps. */
  customIcons?: CustomIcon[];
}
