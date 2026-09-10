/**
 * AgentMesh Authentication & SIWE Session Manager
 *
 * Manages SIWE (Sign-In with Ethereum) authentication session lifecycle
 * and user state against backend auth routes (/auth/*).
 */

import { apiClient } from './api-client';
import { User, WalletIdentity } from '../adapters/types';

export interface SiweNonceResponse {
  nonce: string;
}

export interface SiweVerifyResponse {
  ok: boolean;
  user: User;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user: User | null;
}

export class AuthSessionService {
  private currentUser: User | null = null;
  private currentWallet: WalletIdentity | null = null;

  public getCurrentUser(): User | null {
    return this.currentUser;
  }

  public getCurrentWallet(): WalletIdentity | null {
    return this.currentWallet;
  }

  public async fetchNonce(): Promise<string> {
    const res = await apiClient.get<SiweNonceResponse>('/auth/nonce');
    return res.nonce;
  }

  public async verifySiwe(message: string, signature: string): Promise<User> {
    const res = await apiClient.post<SiweVerifyResponse>('/auth/verify', {
      message,
      signature,
    });
    if (!res.ok || !res.user) {
      throw new Error('SIWE verification failed');
    }
    this.currentUser = res.user;
    return res.user;
  }

  public async fetchSession(): Promise<AuthMeResponse> {
    try {
      const res = await apiClient.get<AuthMeResponse>('/auth/me');
      if (res.authenticated && res.user) {
        this.currentUser = res.user;
      } else {
        this.currentUser = null;
      }
      return res;
    } catch {
      this.currentUser = null;
      return { authenticated: false, user: null };
    }
  }

  public async logout(): Promise<void> {
    try {
      await apiClient.post('/auth/logout');
    } catch {
      // Ignore network errors during logout teardown
    } finally {
      this.currentUser = null;
      this.currentWallet = null;
    }
  }

  public setWalletIdentity(identity: WalletIdentity | null): void {
    this.currentWallet = identity;
  }
}

export const authSessionService = new AuthSessionService();
