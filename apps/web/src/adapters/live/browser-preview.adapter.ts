import { BrowserPreviewAdapter } from '../types';

export class LiveBrowserPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveBrowserPreviewError';
  }
}

export const liveBrowserPreviewAdapter: BrowserPreviewAdapter = {
  async getPreview(url: string): Promise<{ title: string; type: 'html' | 'json'; content: string }> {
    throw new LiveBrowserPreviewError(`Browser preview proxy capability for '${url}' is unsupported in Live Mode in INT-1.`);
  },
};
