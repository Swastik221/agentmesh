/**
 * @agentmesh/ui
 *
 * Shared presentational primitives for the AgentMesh workspace. Everything
 * here is style-only and framework-agnostic beyond React — no data fetching,
 * no app state. Import the stylesheet once per app:
 *
 *   @import '@agentmesh/ui/styles.css';
 */
export const UI_PACKAGE_NAME = '@agentmesh/ui';

export { colors } from './tokens';
export type { ColorToken } from './tokens';

export { truncateHash } from './truncate';

export { HexGrid } from './HexGrid';
export type { HexGridProps } from './HexGrid';

export { WindowDots } from './WindowDots';
export type { WindowDotsProps } from './WindowDots';

export { StatusBadge } from './StatusBadge';
export type { StatusBadgeProps, BadgeTone } from './StatusBadge';

export { Pill } from './Pill';
export type { PillProps } from './Pill';

export { TruncatedAddress } from './TruncatedAddress';
export type { TruncatedAddressProps } from './TruncatedAddress';
