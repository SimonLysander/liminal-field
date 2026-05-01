/**
 * Workspace 通用条目 DTO。
 * 所有 scope（notes/gallery）共享的列表项和详情数据结构，
 * 用于 WorkspaceService 的通用 CRUD 返回值。
 */
export class WorkspaceItemDto {
  id: string;
  title: string;
  summary: string;
  status: 'draft' | 'published';
  createdAt: string;
  updatedAt: string;
}

export class WorkspaceItemDetailDto extends WorkspaceItemDto {
  bodyMarkdown: string;
  plainText: string;
}
