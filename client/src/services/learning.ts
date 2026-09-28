import type { StructureNode } from './structure';
import { request, toQueryString } from './request';

export type LearningProjectStatus = 'active' | 'archived';

export interface LearningProject {
  id: string;
  rootNodeId: string;
  rootContentItemId: string;
  status: LearningProjectStatus;
  createdAt?: string;
  updatedAt?: string;
  archivedAt?: string;
}

export interface LearningProjectResolve {
  project: LearningProject | null;
  canStart: boolean;
  rootNode: StructureNode;
  currentNode: StructureNode;
  path: StructureNode[];
}

export interface LearningProjectDiscardResult {
  affectedContentItemIds: string[];
  deleted: number;
}

/** 学习根进入规划页，其余页面进入最近学习根下的正文页。 */
export function buildLearningUrl(resolved: LearningProjectResolve): string {
  const base = `/admin/notes/${encodeURIComponent(resolved.rootNode.id)}/learn`;
  const cid = resolved.currentNode.contentItemId;
  return resolved.currentNode.id !== resolved.rootNode.id && cid
    ? `${base}?node=${encodeURIComponent(cid)}`
    : base;
}

export const learningApi = {
  resolve: (nodeId: string) =>
    request<LearningProjectResolve>(
      `/learning/projects/resolve${toQueryString({ nodeId })}`,
    ),

  create: (rootNodeId: string) =>
    request<LearningProject>('/learning/projects', {
      method: 'POST',
      body: JSON.stringify({ rootNodeId }),
    }),

  discard: (projectId: string) =>
    request<LearningProjectDiscardResult>(
      `/learning/projects/${projectId}/discard`,
      { method: 'POST' },
    ),
};
