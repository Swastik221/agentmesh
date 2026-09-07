import path from 'node:path';
import { BadRequestError } from '../errors/app-error.js';

const MAX_PATHS_PER_TASK = 100;
const MAX_PATH_LENGTH = 500;

export function validateFilePaths(filePaths: string[] | undefined | null): string[] {
  if (!filePaths) {
    return [];
  }

  if (!Array.isArray(filePaths)) {
    throw new BadRequestError('filePaths must be an array of strings');
  }

  if (filePaths.length > MAX_PATHS_PER_TASK) {
    throw new BadRequestError(`Exceeded maximum allowed file paths per task (${MAX_PATHS_PER_TASK})`);
  }

  const validatedPaths: string[] = [];
  const seenPaths = new Set<string>();

  for (const rawPath of filePaths) {
    if (typeof rawPath !== 'string') {
      throw new BadRequestError('Each file path must be a string');
    }

    const trimmed = rawPath.trim();
    if (!trimmed) {
      throw new BadRequestError('File path cannot be empty');
    }

    if (trimmed.length > MAX_PATH_LENGTH) {
      throw new BadRequestError(`File path exceeds maximum length of ${MAX_PATH_LENGTH} characters`);
    }

    // Check for windows drive letters or UNC paths or absolute paths
    if (
      path.isAbsolute(trimmed) ||
      trimmed.startsWith('/') ||
      trimmed.startsWith('\\') ||
      /^[a-zA-Z]:[/\\]/.test(trimmed)
    ) {
      throw new BadRequestError(`File path '${trimmed}' must be relative, not absolute`);
    }

    // Normalize separators to forward slash
    const normalized = trimmed.replace(/\\/g, '/');

    // Reject directory traversal
    const parts = normalized.split('/');
    if (parts.includes('..') || parts.includes('.')) {
      throw new BadRequestError(`File path '${trimmed}' contains invalid directory traversal ('..' or '.')`);
    }

    // Reject empty path segments (e.g. "//" or trailing slash if not desired)
    if (parts.some((part) => part === '')) {
      throw new BadRequestError(`File path '${trimmed}' contains invalid empty path segments`);
    }

    // Normalize via path.posix.normalize
    const posixNormalized = path.posix.normalize(normalized);
    if (posixNormalized.startsWith('..') || path.isAbsolute(posixNormalized)) {
      throw new BadRequestError(`File path '${trimmed}' is invalid`);
    }

    if (!seenPaths.has(posixNormalized)) {
      seenPaths.add(posixNormalized);
      validatedPaths.push(posixNormalized);
    }
  }

  return validatedPaths;
}
