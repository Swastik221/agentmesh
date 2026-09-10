import { WalletAdapter, WalletIdentity, ENSIdentity } from '../types';
import { apiClient } from '../../services/api-client';

export class LiveWalletError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveWalletError';
  }
}

export const liveWalletAdapter: WalletAdapter = {
  async connectWallet(provider: WalletIdentity['provider'] = 'metamask'): Promise<WalletIdentity> {
    if (typeof window === 'undefined' || !(window as unknown as { ethereum?: { request: (args: { method: string }) => Promise<unknown> } }).ethereum) {
      throw new LiveWalletError('No injected wallet provider (window.ethereum) detected in browser.');
    }

    const ethereum = (window as unknown as { ethereum: { request: (args: { method: string }) => Promise<unknown> } }).ethereum;

    try {
      const accounts = (await ethereum.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts || accounts.length === 0 || !accounts[0]) {
        throw new LiveWalletError('Wallet connected but returned no active accounts.');
      }

      const address = accounts[0];
      let chainIdNum = 1;

      try {
        const hexChainId = (await ethereum.request({ method: 'eth_chainId' })) as string;
        if (hexChainId && typeof hexChainId === 'string') {
          chainIdNum = parseInt(hexChainId, 16) || 1;
        }
      } catch {
        // Fallback chain ID parsing failure
      }

      return {
        address,
        truncatedAddress: `${address.slice(0, 6)}...${address.slice(-4)}`,
        provider,
        connected: true,
        chainId: chainIdNum,
      };
    } catch (err) {
      if (err instanceof LiveWalletError) {
        throw err;
      }
      throw new LiveWalletError(
        err instanceof Error ? `Wallet connection rejected: ${err.message}` : 'Wallet connection rejected by user.'
      );
    }
  },

  async resolveEns(address: string): Promise<ENSIdentity> {
    try {
      const res = await apiClient.get<ENSIdentity>(`/api/ens/resolve/${encodeURIComponent(address)}`);
      return res;
    } catch {
      return {
        ens: address,
        address,
        resolved: false,
      };
    }
  },

  async signApproval(_approvalId: string, _action: string, _spendThreshold?: string): Promise<{ signature: string; txHash: string }> {
    throw new LiveWalletError('Live approval signing is not implemented yet in Live Mode.');
  },

  async disconnect(): Promise<void> {
    // Teardown wallet state connection
  },
};
