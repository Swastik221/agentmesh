import type { ENSIdentity, WalletAdapter, WalletIdentity } from '../types';

export const DEMO_IDENTITIES: Record<string, { address: string; ens: string; truncated: string }> = {
  anand: {
    address: '0x1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b9f3c',
    ens: 'dev1.eth',
    truncated: '0x1a2b…9f3c',
  },
  swastik: {
    address: '0x7c81de0a4b2f3915e6d7c8b9a0f1e2d3c4b5a6e7',
    ens: 'dev2.eth',
    truncated: '0x7c81…a6e7',
  },
};

export class DemoWalletAdapter implements WalletAdapter {
  private activeWallet: WalletIdentity | null = null;

  async connectWallet(provider: WalletIdentity['provider'] = 'metamask'): Promise<WalletIdentity> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const profile = DEMO_IDENTITIES.anand;
    this.activeWallet = {
      address: profile.address,
      truncatedAddress: profile.truncated,
      provider,
      connected: true,
      chainId: 11155111, // Sepolia
    };
    return this.activeWallet;
  }

  async resolveEns(address: string): Promise<ENSIdentity> {
    await new Promise((resolve) => setTimeout(resolve, 350));
    if (address.toLowerCase() === DEMO_IDENTITIES.swastik.address.toLowerCase()) {
      return {
        ens: DEMO_IDENTITIES.swastik.ens,
        address: DEMO_IDENTITIES.swastik.address,
        resolved: true,
      };
    }
    return {
      ens: DEMO_IDENTITIES.anand.ens,
      address: DEMO_IDENTITIES.anand.address,
      resolved: true,
    };
  }

  async signApproval(
    approvalId: string,
    _action: string,
    _spendThreshold = '$0.001 USDC'
  ): Promise<{ signature: string; txHash: string }> {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const randomHex = Math.random().toString(16).substring(2, 10);
    return {
      signature: `0x7f9a2b${approvalId}${randomHex}`,
      txHash: `0xbc${randomHex}98e1042a5`,
    };
  }

  async disconnect(): Promise<void> {
    this.activeWallet = null;
  }
}
