/**
 * Shorten an address- or hash-like value to `0x1a2b...9f3c`.
 *
 * Values already short enough to read in full are returned untouched, so this
 * is safe to call on anything hash-shaped without checking length first.
 */
export function truncateHash(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 3) return value;
  return `${value.slice(0, lead)}...${value.slice(-tail)}`;
}
