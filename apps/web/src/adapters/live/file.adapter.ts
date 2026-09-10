import { FileAdapter, FileItem, Artifact } from '../types';
import { apiClient } from '../../services/api-client';

export class LiveFileAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveFileAdapterError';
  }
}

export const liveFileAdapter: FileAdapter = {
  async getFiles(_workspaceId: string): Promise<FileItem[]> {
    throw new LiveFileAdapterError('File browser capability is unsupported in Live Mode in INT-1.');
  },

  async readFile(_workspaceId: string, _path: string): Promise<string> {
    throw new LiveFileAdapterError('File reading capability is unsupported in Live Mode in INT-1.');
  },

  async getArtifacts(_workspaceId: string, taskId?: string): Promise<Artifact[]> {
    if (!taskId) {
      throw new LiveFileAdapterError('Fetching artifacts requires a taskId in Live Mode in INT-1.');
    }
    const res = await apiClient.get<{ items: Artifact[]; page: number; limit: number; total: number }>(
      `/projects/${encodeURIComponent(_workspaceId)}/tasks/${encodeURIComponent(taskId)}/artifacts`,
    );
    return res.items || [];
  },

  async publishArtifact(workspaceId: string, artifact: Artifact & { taskId?: string }): Promise<Artifact> {
    if (!artifact.taskId) {
      throw new LiveFileAdapterError('Publishing an artifact requires a taskId in Live Mode in INT-1.');
    }
    return await apiClient.post<Artifact>(
      `/projects/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(artifact.taskId)}/artifacts`,
      {
        name: artifact.name,
        type: artifact.schema || 'general',
        payload: { content: artifact.content, hash: artifact.hash },
      },
    );
  },
};
