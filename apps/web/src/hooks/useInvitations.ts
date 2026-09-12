import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../services/api-client';

export type ProjectRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED';

export interface ProjectInvitation {
  id: string;
  projectId: string;
  inviterUserId: string;
  invitedWallet: string;
  role: ProjectRole;
  status: InvitationStatus;
  createdAt: string;
  project?: {
    id: string;
    name: string;
    description?: string | null;
  };
  inviterUser?: {
    id: string;
    displayName?: string | null;
    walletAddress?: string | null;
  };
}

export function usePendingInvitations() {
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ invitations: ProjectInvitation[] }>('/invitations/pending');
      setInvitations(res.invitations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchPending();
  }, [fetchPending]);

  const acceptInvitation = useCallback(
    async (invitationId: string) => {
      try {
        const res = await apiClient.post<ProjectInvitation>(`/invitations/${invitationId}/accept`, {});
        await fetchPending();
        return res;
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err));
      }
    },
    [fetchPending],
  );

  const declineInvitation = useCallback(
    async (invitationId: string) => {
      try {
        const res = await apiClient.post<ProjectInvitation>(`/invitations/${invitationId}/decline`, {});
        await fetchPending();
        return res;
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err));
      }
    },
    [fetchPending],
  );

  return {
    invitations,
    loading,
    error,
    refetch: fetchPending,
    acceptInvitation,
    declineInvitation,
  };
}

export function useProjectInvitations(projectId?: string) {
  const [invitations, setInvitations] = useState<ProjectInvitation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProjectInvitations = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ invitations: ProjectInvitation[] }>(
        `/projects/${projectId}/invitations`,
      );
      setInvitations(res.invitations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchProjectInvitations();
  }, [fetchProjectInvitations]);

  const createInvitation = useCallback(
    async (target: string, role: ProjectRole = 'MEMBER') => {
      if (!projectId) throw new Error('Project ID is required');
      try {
        const res = await apiClient.post<ProjectInvitation>(`/projects/${projectId}/invitations`, {
          target,
          role,
        });
        await fetchProjectInvitations();
        return res;
      } catch (err) {
        throw new Error(err instanceof Error ? err.message : String(err));
      }
    },
    [projectId, fetchProjectInvitations],
  );

  return {
    invitations,
    loading,
    error,
    refetch: fetchProjectInvitations,
    createInvitation,
  };
}

export interface ProjectMember {
  id: string;
  projectId: string;
  userId: string;
  role: ProjectRole;
  createdAt: string;
  user?: {
    id: string;
    displayName?: string | null;
    walletAddress?: string | null;
    ensName?: string | null;
  };
}

export function useProjectMembers(projectId?: string) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ProjectMember[]>(`/projects/${projectId}/members`);
      setMembers(res || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  return {
    members,
    loading,
    error,
    refetch: fetchMembers,
  };
}

