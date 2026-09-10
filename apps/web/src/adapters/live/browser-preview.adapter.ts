import { BrowserPreviewAdapter } from '../types';

export const liveBrowserPreviewAdapter: BrowserPreviewAdapter = {
  async getPreview(url: string): Promise<{ title: string; type: 'html' | 'json'; content: string }> {
    try {
      const response = await fetch(url);
      const text = await response.text();
      const isJson = response.headers.get('content-type')?.includes('application/json');

      return {
        title: url,
        type: isJson ? 'json' : 'html',
        content: text,
      };
    } catch {
      return {
        title: url,
        type: 'html',
        content: `<div style="padding: 24px; color: #fff; background: #0f172a;"><h3>Live Preview Proxy</h3><p>Connecting to ${url}</p></div>`,
      };
    }
  },
};
