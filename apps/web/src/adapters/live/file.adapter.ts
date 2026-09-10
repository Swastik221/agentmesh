import { FileAdapter, FileItem, Artifact } from '../types';
import { apiClient } from '../../services/api-client';

export const liveFileAdapter: FileAdapter = {
  async getFiles(workspaceId: string): Promise<FileItem[]> {
    return await apiClient.get<FileItem[]>(`/projects/${encodeURIComponent(workspaceId)}/files`);
  },

  async readFile(workspaceId: string, path: string): Promise<string> {
    const res = await apiClient.get<{ content: string }>(`/projects/${encodeURIComponent(workspaceId)}/files/read`, { params: { path } });
    return res.content;
  },

  async getArtifacts(workspaceId: string): Promise<Artifact[]> {
    return await apiClient.get<Artifact[]>(`/projects/${encodeURIComponent(workspaceId)}/artifacts`);
  },

  async publishArtifact(workspaceId: string, artifact: Artifact): Promise<Artifact> {
    return await apiClient.post<Artifact>(`/projects/${encodeURIComponent(workspaceId)}/artifacts`, artifact);
  },
};
