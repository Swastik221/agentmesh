import { describe, it, expect } from 'vitest';
import { decodePaymentRequired } from '../PaidCapabilityCard';

describe('x402 header decoding in the browser', () => {
  it('decodes the base64 JSON PAYMENT-REQUIRED header (it is not plain JSON)', () => {
    const requirement = {
      x402Version: 2,
      resource: { url: '/agents/a/capabilities/audit/execute', description: 'Prüfung ✓', mimeType: 'application/json' },
      accepts: [{ scheme: 'exact', network: 'hedera:testnet', amount: '1000', payTo: '0.0.5', maxTimeoutSeconds: 120, extra: { feePayer: '0.0.9' } }],
    };
    const bytes = new TextEncoder().encode(JSON.stringify(requirement));
    const header = btoa(String.fromCharCode(...bytes));
    expect(decodePaymentRequired(header)?.accepts?.[0]).toMatchObject({ payTo: '0.0.5', extra: { feePayer: '0.0.9' } });
    expect(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(header), (c) => c.charCodeAt(0)))).resource.description).toBe('Prüfung ✓');
  });

  it('returns null for something that is not a requirement header', () => {
    expect(decodePaymentRequired('not base64 json!!')).toBeNull();
  });
});
