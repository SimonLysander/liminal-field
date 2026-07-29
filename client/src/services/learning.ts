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
  startBlockedReason: 'descendant-project' | null;
  rootNode: StructureNode;
  currentNode: StructureNode;
  path: StructureNode[];
}

export interface LearningProjectDiscardResult {
  affectedContentItemIds: string[];
  deleted: number;
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
