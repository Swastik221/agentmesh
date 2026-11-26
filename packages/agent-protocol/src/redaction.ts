/**
 * Best-effort redaction of common secret shapes in terminal output.
 *
 * Applied by the CLI before output leaves the developer's machine and again by
 * the server before it is buffered or forwarded. It catches the well-known
 * token formats and `KEY=value` assignments for secret-looking names. It will
 * not catch everything: a secret split across two output chunks, an unusual
 * format, or a secret printed without a recognisable label will get through.
 * Sharing a terminal is still sharing what it prints.
 */

export const REDACTED = '[redacted]';

interface Rule {
  name: string;
  pattern: RegExp;
  /** Replacement; `$1` keeps a captured prefix such as `API_KEY=`. */
  replace: string;
}

const RULES: Rule[] = [
  {
    name: 'private-key-block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    replace: REDACTED,
  },
  { name: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: REDACTED },
  { name: 'github-token', pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g, replace: REDACTED },
  { name: 'slack-token', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, replace: REDACTED },
  { name: 'stripe-key', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replace: REDACTED },
  { name: 'api-key-sk', pattern: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g, replace: REDACTED },
  { name: 'google-api-key', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: REDACTED },
  { name: 'agentmesh-token', pattern: /\bamct_[A-Za-z0-9_-]{20,}\b/g, replace: REDACTED },
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replace: REDACTED,
  },
  {
    name: 'bearer',
    pattern: /(\bBearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi,
    replace: `$1${REDACTED}`,
  },
  {
    name: 'url-credentials',
    pattern: /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+(@)/gi,
    replace: `$1${REDACTED}$2`,
  },
  {
    // NAME=value or NAME: value where NAME looks secret. Keeps the name so the
    // output still makes sense to a reader.
    name: 'secret-assignment',
    pattern:
      /(\b[A-Za-z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY|API_KEY|APIKEY|ACCESS_KEY|CREDENTIAL)[A-Za-z0-9_]*\s*[=:]\s*["']?)[^\s"']{4,}/gi,
    replace: `$1${REDACTED}`,
  },
  {
    // A 64-hex-char string after something key-ish: Ethereum/Hedera private keys.
    name: 'hex-private-key',
    pattern: /(\b(?:key|private|secret)[A-Za-z_]*\s*[=:]\s*["']?)(?:0x)?[0-9a-fA-F]{64}\b/gi,
    replace: `$1${REDACTED}`,
  },
];

export interface RedactionResult {
  text: string;
  /** Names of the rules that matched, for diagnostics. Never the secrets. */
  matched: string[];
}

export function redactSecrets(text: string): RedactionResult {
  let out = text;
  const matched: string[] = [];
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(out)) {
      matched.push(rule.name);
      rule.pattern.lastIndex = 0;
      out = out.replace(rule.pattern, rule.replace);
    }
  }
  return { text: out, matched };
}
