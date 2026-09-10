import { BrowserPreviewAdapter } from '../types';

export class LiveBrowserPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveBrowserPreviewError';
  }
}

export const liveBrowserPreviewAdapter: BrowserPreviewAdapter = {
  async getPreview(url: string): Promise<{ title: string; type: 'html' | 'json'; content: string }> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new LiveBrowserPreviewError(`Browser preview fetch failed with HTTP ${response.status}: ${response.statusText}`);
      }
      const text = await response.text();
      const isJson = response.headers.get('content-type')?.includes('application/json');

      return {
        title: url,
        type: isJson ? 'json' : 'html',
        content: text,
      };
    } catch (err) {
      if (err instanceof LiveBrowserPreviewError) {
        throw err;
      }
      throw new LiveBrowserPreviewError(`Live browser preview unavailable for ${url}: ${err instanceof Error ? err.message : 'Fetch failed'}`);
    }
  },
};
