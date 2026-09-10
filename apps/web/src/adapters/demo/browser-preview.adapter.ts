import type { BrowserPreviewAdapter } from '../types';

export class DemoBrowserPreviewAdapter implements BrowserPreviewAdapter {
  async getPreview(url: string): Promise<{ title: string; type: 'html' | 'json'; content: string }> {
    const normalized = url.toLowerCase();

    if (normalized.includes('api') || normalized.includes('docs') || normalized.includes('schema')) {
      return {
        title: 'Payment API Schema · OpenAPI 3.0',
        type: 'json',
        content: JSON.stringify(
          {
            openapi: '3.0.0',
            info: {
              title: 'Checkout Payment Protocol API',
              version: '1.0.0',
              description: 'Coordinated endpoint shared between Orion (Codex) and Vega (Claude).',
            },
            endpoints: {
              'POST /api/v1/checkout/intent': {
                request: {
                  amount: '0.35 ETH',
                  recipient: '0x1a2b…9f3c (dev1.eth)',
                  escrowContract: '0x8b6f…36b3',
                },
                response: {
                  status: 'INTENT_CREATED',
                  hash: '0x7fb2…91cd',
                  approvalRequired: true,
                },
              },
            },
          },
          null,
          2
        ),
      };
    }

    return {
      title: 'AgentMesh Checkout · Live Preview',
      type: 'html',
      content: `
        <div style="font-family: var(--am-font-sans, system-ui); padding: 24px; color: #1E2B26;">
          <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #D6D8C9; padding-bottom: 14px; margin-bottom: 18px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <div style="width: 14px; height: 14px; border-radius: 4px; background: #2F7D5C;"></div>
              <strong style="font-size: 15px;">Checkout Protocol Sandbox</strong>
            </div>
            <span style="font-size: 11px; background: #DDF4E8; color: #2F7D5C; padding: 3px 8px; border-radius: 12px; font-weight: 600;">v1.0-DEMO</span>
          </div>

          <div style="background: #FFFDF7; border: 1px solid #D6D8C9; border-radius: 12px; padding: 18px; margin-bottom: 16px;">
            <div style="font-size: 12px; color: #68746D; margin-bottom: 6px;">Total Checkout Spend</div>
            <div style="font-size: 26px; font-weight: 700; color: #1E2B26; font-family: var(--am-font-mono, monospace);">0.35 ETH <span style="font-size: 14px; font-weight: 400; color: #68746D;">≈ $1,180.00</span></div>
            <div style="margin-top: 12px; font-size: 12px; display: flex; align-items: center; gap: 6px; color: #177E89;">
              <span>• Connected Identity:</span>
              <code style="background: #EEF1E8; padding: 2px 6px; border-radius: 4px; font-family: var(--am-font-mono, monospace);">dev1.eth (0x1a2b…9f3c)</code>
            </div>
          </div>

          <div style="background: #FFFBEB; border: 1px solid #D99A32; border-radius: 10px; padding: 12px 14px; font-size: 12px; color: #8A5800; display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: 700;">⚠ Human Gated:</span>
            <span>Contract deployment requires owner signature via Web3 wallet approval gate.</span>
          </div>
        </div>
      `,
    };
  }
}
