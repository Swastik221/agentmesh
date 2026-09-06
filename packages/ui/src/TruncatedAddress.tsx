import { truncateHash } from './truncate';

export interface TruncatedAddressProps {
  /** Full value. Only ever rendered truncated; the full string goes in the title. */
  address: string;
  /** Optional human-readable name shown above the address (e.g. an ENS name). */
  label?: string;
  lead?: number;
  tail?: number;
  className?: string;
}

/**
 * Renders an address the way an explorer does: the readable name first, the
 * raw value beneath it in monospace and always truncated. Hovering reveals the
 * full value via the native tooltip, so nothing is lost.
 */
export function TruncatedAddress({ address, label, lead, tail, className }: TruncatedAddressProps) {
  return (
    <span className={className ? `am-addr ${className}` : 'am-addr'} title={address}>
      {label ? <span className="am-addr__label">{label}</span> : null}
      <span className="am-addr__hash">{truncateHash(address, lead, tail)}</span>
    </span>
  );
}
