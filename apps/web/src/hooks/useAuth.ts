import { useState, useEffect, useCallback } from 'react';
import { DEFAULT_SIWE_CHAIN_ID } from '@agentmesh/shared';
import { authSessionService } from '../services/auth-session';

export interface AuthUser {
  id: string;
  walletAddress: string | null;
  displayName: string | null;
}

export type AuthStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected_unauthenticated'
  | 'authenticating'
  | 'authenticated'
  | 'error';

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [status, setStatus] = useState<AuthStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  // Restore existing session on mount
  useEffect(() => {
    async function checkSession() {
      try {
        const session = await authSessionService.fetchSession();
        if (session.authenticated && session.user) {
          setUser({
            id: session.user.id,
            walletAddress: session.user.walletAddress || null,
            displayName: session.user.displayName || null,
          });
          if (session.user.walletAddress) {
            setConnectedAddress(session.user.walletAddress);
          }
          setStatus('authenticated');
        } else {
          setUser(null);
          setStatus('disconnected');
        }
      } catch {
        setUser(null);
        setStatus('disconnected');
      }
    }
    checkSession();
  }, []);

  // Listen for EIP-1193 accountsChanged and chainChanged events
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const ethereum = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
    if (!ethereum || !ethereum.on) return;

    const handleAccountsChanged = (accounts: unknown) => {
      const accList = accounts as string[];
      if (!accList || accList.length === 0) {
        setConnectedAddress(null);
        setUser(null);
        setStatus('disconnected');
        authSessionService.setWalletIdentity(null);
      } else {
        const newAddress = accList[0];
        setConnectedAddress(newAddress);
        // If current authenticated user address doesn't match new wallet address, invalidate session state
        if (user && user.walletAddress && user.walletAddress.toLowerCase() !== newAddress.toLowerCase()) {
          setUser(null);
          setStatus('connected_unauthenticated');
        }
      }
    };

    const handleChainChanged = (hexChain: unknown) => {
      if (typeof hexChain === 'string') {
        const parsed = parseInt(hexChain, 16);
        if (!isNaN(parsed)) {
          setChainId(parsed);
        }
      }
    };

    ethereum.on('accountsChanged', handleAccountsChanged);
    ethereum.on('chainChanged', handleChainChanged);

    return () => {
      if (ethereum.removeListener) {
        ethereum.removeListener('accountsChanged', handleAccountsChanged);
        ethereum.removeListener('chainChanged', handleChainChanged);
      }
    };
  }, [user]);

  const connectWallet = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    try {
      if (typeof window === 'undefined' || !(window as unknown as { ethereum?: EthereumProvider }).ethereum) {
        throw new Error('WALLET_NOT_INSTALLED: Ethereum wallet (window.ethereum) not detected.');
      }

      const ethereum = (window as unknown as { ethereum: EthereumProvider }).ethereum;

      let accounts: string[];
      try {
        accounts = (await ethereum.request({
          method: 'eth_requestAccounts',
        })) as string[];
      } catch (err: unknown) {
        throw new Error(
          err instanceof Error ? `WALLET_CONNECTION_REJECTED: ${err.message}` : 'WALLET_CONNECTION_REJECTED: User rejected wallet connection.',
        );
      }

      if (!accounts || accounts.length === 0 || !accounts[0]) {
        throw new Error('WALLET_NO_ACCOUNT: Wallet connected but returned no accounts.');
      }

      const address = accounts[0];

      let chainIdNum = DEFAULT_SIWE_CHAIN_ID;
      try {
        const hexChainId = (await ethereum.request({ method: 'eth_chainId' })) as string;
        if (hexChainId && typeof hexChainId === 'string') {
          const parsed = parseInt(hexChainId, 16);
          if (!isNaN(parsed) && parsed > 0) {
            chainIdNum = parsed;
          }
        }
      } catch (err: unknown) {
        throw new Error(
          `CHAIN_ID_READ_FAILED: Failed to query chain ID: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      setConnectedAddress(address);
      setChainId(chainIdNum);
      setStatus('connected_unauthenticated');

      authSessionService.setWalletIdentity({
        address,
        truncatedAddress: `${address.slice(0, 6)}...${address.slice(-4)}`,
        provider: 'metamask',
        connected: true,
        chainId: chainIdNum,
      });

      return address;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to connect wallet';
      setError(msg);
      setStatus('error');
      return null;
    }
  }, []);

  const loginWithSiwe = useCallback(async () => {
    setError(null);
    setStatus('authenticating');
    try {
      let addr = connectedAddress;
      if (!addr) {
        addr = await connectWallet();
      }
      if (!addr) {
        throw new Error('WALLET_NOT_CONNECTED: Wallet not connected');
      }

      let nonce: string;
      try {
        nonce = await authSessionService.fetchNonce();
      } catch (err: unknown) {
        throw new Error(`SIWE_NONCE_FAILED: ${err instanceof Error ? err.message : 'Failed to retrieve nonce'}`);
      }

      const domain = (typeof window !== 'undefined' && window.location.hostname) || 'localhost';
      const origin = (typeof window !== 'undefined' && window.location.origin) || 'http://localhost:5173';
      const activeChainId = chainId || DEFAULT_SIWE_CHAIN_ID;
      const issuedAt = new Date().toISOString();

      const message =
        `${domain} wants you to sign in with your Ethereum account:\n` +
        `${addr}\n\n` +
        `Sign in with Ethereum to AgentMesh.\n\n` +
        `URI: ${origin}\n` +
        `Version: 1\n` +
        `Chain ID: ${activeChainId}\n` +
        `Nonce: ${nonce}\n` +
        `Issued At: ${issuedAt}`;

      let signature: string;
      const ethereum = (window as unknown as { ethereum?: EthereumProvider }).ethereum;

      if (typeof window === 'undefined' || !ethereum) {
        throw new Error('WALLET_NOT_INSTALLED: Ethereum wallet not detected for signing.');
      }

      try {
        signature = (await ethereum.request({
          method: 'personal_sign',
          params: [message, addr],
        })) as string;
      } catch (err: unknown) {
        throw new Error(`SIWE_SIGNATURE_REJECTED: ${err instanceof Error ? err.message : 'User rejected signing request.'}`);
      }

      let authedUser;
      try {
        const u = await authSessionService.verifySiwe(message, signature);
        authedUser = {
          id: u.id,
          walletAddress: u.walletAddress || addr,
          displayName: u.displayName || null,
        };
      } catch (err: unknown) {
        throw new Error(`SIWE_VERIFICATION_FAILED: ${err instanceof Error ? err.message : 'SIWE verification failed'}`);
      }

      setUser(authedUser);
      setConnectedAddress(authedUser.walletAddress);
      setStatus('authenticated');
      return authedUser;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'SIWE Sign-In failed';
      setError(msg);
      setStatus('error');
      return null;
    }
  }, [connectedAddress, connectWallet, chainId]);

  const logout = useCallback(async () => {
    await authSessionService.logout();
    setUser(null);
    setConnectedAddress(null);
    setStatus('disconnected');
    setError(null);
  }, []);

  return {
    user,
    connectedAddress,
    chainId,
    status,
    error,
    connectWallet,
    loginWithSiwe,
    logout,
  };
}
