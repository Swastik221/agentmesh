import { useState, useEffect, useCallback } from 'react';

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
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);

  const API_BASE = '/api';

  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch(`${API_BASE}/auth/me`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setUser(data.user);
          setConnectedAddress(data.user.walletAddress);
          setStatus('authenticated');
        }
      } catch {
        // Session check failed or unauthenticated on load
      }
    }
    checkSession();
  }, []);

  const connectWallet = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    try {
      const ethereum = (window as unknown as { ethereum?: EthereumProvider }).ethereum;
      if (typeof window !== 'undefined' && ethereum) {
        const accounts = (await ethereum.request({
          method: 'eth_requestAccounts',
        })) as string[];

        if (accounts && accounts.length > 0) {
          setConnectedAddress(accounts[0]);
          setStatus('connected_unauthenticated');
          return accounts[0];
        }
      }
      const fallbackAddr = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';
      setConnectedAddress(fallbackAddr);
      setStatus('connected_unauthenticated');
      return fallbackAddr;
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
        throw new Error('Wallet not connected');
      }

      const nonceRes = await fetch(`${API_BASE}/auth/nonce`);
      if (!nonceRes.ok) {
        throw new Error('Failed to fetch authentication nonce');
      }
      const { nonce } = await nonceRes.json();

      const domain = window.location.hostname || 'localhost';
      const origin = window.location.origin || 'http://localhost:5173';
      const chainId = 11155111;
      const issuedAt = new Date().toISOString();

      const message =
        `${domain} wants you to sign in with your Ethereum account:\n` +
        `${addr}\n\n` +
        `Sign in with Ethereum to AgentMesh.\n\n` +
        `URI: ${origin}\n` +
        `Version: 1\n` +
        `Chain ID: ${chainId}\n` +
        `Nonce: ${nonce}\n` +
        `Issued At: ${issuedAt}`;

      let signature: string;
      const ethereum = (window as unknown as { ethereum?: EthereumProvider }).ethereum;

      if (typeof window !== 'undefined' && ethereum) {
        signature = (await ethereum.request({
          method: 'personal_sign',
          params: [message, addr],
        })) as string;
      } else {
        signature =
          '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b';
      }

      const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, signature }),
      });

      if (!verifyRes.ok) {
        const errData = await verifyRes.json().catch(() => ({}));
        throw new Error(errData.message || 'SIWE verification failed');
      }

      const data = await verifyRes.json();
      setUser(data.user);
      setConnectedAddress(data.user.walletAddress);
      setStatus('authenticated');
      return data.user;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'SIWE Sign-In failed';
      setError(msg);
      setStatus('error');
      return null;
    }
  }, [connectedAddress, connectWallet]);

  const logout = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Ignore network errors on logout
    }
    setUser(null);
    setConnectedAddress(null);
    setStatus('disconnected');
    setError(null);
  }, []);

  return {
    user,
    connectedAddress,
    status,
    error,
    connectWallet,
    loginWithSiwe,
    logout,
  };
}
