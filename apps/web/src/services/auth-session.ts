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
    if (!res || !res.nonce) {
      throw new Error('SIWE_NONCE_FAILED: Invalid nonce response from server');
    }
    return res.nonce;
  }

  public async verifySiwe(message: string, signature: string): Promise<User> {
    const res = await apiClient.post<SiweVerifyResponse>('/auth/verify', {
      message,
      signature,
    });
    if (!res || !res.user) {
      throw new Error('SIWE_VERIFICATION_FAILED: Backend did not return user object');
    }
    this.currentUser = res.user;
    return res.user;
  }

  public async fetchSession(): Promise<AuthMeResponse> {
    try {
      const res = await apiClient.get<{ user: User }>('/auth/me');
      if (res && res.user) {
        this.currentUser = res.user;
        return { authenticated: true, user: res.user };
      }
      this.currentUser = null;
      return { authenticated: false, user: null };
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
