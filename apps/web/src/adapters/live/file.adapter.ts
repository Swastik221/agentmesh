import { FileAdapter, FileItem, Artifact } from '../types';
import { apiClient } from '../../services/api-client';

export const liveFileAdapter: FileAdapter = {
  async getFiles(workspaceId: string): Promise<FileItem[]> {
    try {
      const res = await apiClient.get<FileItem[]>(`/projects/${encodeURIComponent(workspaceId)}/files`);
      return res;
    } catch {
      return [];
    }
  },

  async readFile(workspaceId: string, path: string): Promise<string> {
    try {
      const res = await apiClient.get<{ content: string }>(`/projects/${encodeURIComponent(workspaceId)}/files/read`, { params: { path } });
      return res.content;
    } catch {
      return '// File content unavailable in live mode fallback';
    }
  },

  async getArtifacts(workspaceId: string): Promise<Artifact[]> {
    try {
      const res = await apiClient.get<Artifact[]>(`/projects/${encodeURIComponent(workspaceId)}/artifacts`);
      return res;
    } catch {
      return [];
    }
  },

  async publishArtifact(workspaceId: string, artifact: Artifact): Promise<Artifact> {
    try {
      const res = await apiClient.post<Artifact>(`/projects/${encodeURIComponent(workspaceId)}/artifacts`, artifact);
      return res;
    } catch {
      return artifact;
    }
  },
};
