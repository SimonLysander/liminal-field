export type StructureNodeType = 'FOLDER' | 'DOC';
export type StructureVisibility = 'public' | 'all';
export interface StructureNode {
  id: string;
  name: string;
  type: StructureNodeType;
  parentId?: string;
  contentItemId?: string;
  sortOrder: number;
  hasChildren: boolean;
  createdAt: string;
  updatedAt?: string;
}
export interface CreateStructureNodeDto {
  name: string;
  type: StructureNodeType;
  parentId?: string;
  contentItemId?: string;
  sortOrder?: number;
}
export interface UpdateStructureNodeDto {
  name?: string;
  parentId?: string | null;
  contentItemId?: string;
  sortOrder?: number;
}
import { request } from './request';

function toQueryString(params: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export interface StructureListResult {
  path: StructureNode[];
  children: StructureNode[];
}

export interface DeleteStats {
  folderCount: number;
  docCount: number;
}

export const structureApi = {
  /**
   * 列出导航节点。scope 可选，传入后作为查询参数过滤特定 workspace 的节点。
   * 后端 workspace 重构后，不同 scope 的导航树通过 scope 字段区分。
   */
  listNodes: (
    parentId?: string,
    options?: { visibility?: StructureVisibility; scope?: string },
  ) =>
    request<StructureListResult>(
      `/structure-nodes${toQueryString({
        parentId,
        visibility: options?.visibility,
        scope: options?.scope,
      })}`,
    ),

  getRootNodes: (options?: { visibility?: StructureVisibility; scope?: string }) =>
    structureApi.listNodes(undefined, options),

  getChildren: (parentId: string, options?: { visibility?: StructureVisibility; scope?: string }) =>
    structureApi.listNodes(parentId, options),

  getPathByNodeId: (id: string) =>
    request<StructureNode[]>(`/structure-nodes/${id}/path`),

  getPathByContentItemId: (contentItemId: string) =>
    request<StructureNode[]>(`/contents/${contentItemId}/structure-path`),

  createNode: (dto: CreateStructureNodeDto) =>
    request<StructureNode>('/structure-nodes', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),

  updateNode: (id: string, dto: UpdateStructureNodeDto) =>
    request<StructureNode>(`/structure-nodes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),
  getDeleteStats: (id: string) =>
    request<DeleteStats>(`/structure-nodes/${id}/delete-stats`),

  deleteNode: (id: string) =>
    request<void>(`/structure-nodes/${id}`, { method: 'DELETE' }),

  reorderSiblings: (parentId: string | null, nodeIds: string[]) =>
    request<void>('/structure-nodes/reorder', {
      method: 'POST',
      body: JSON.stringify({ parentId, nodeIds }),
    }),
};
