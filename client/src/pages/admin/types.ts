import type {
  ContentChangeType,
  ContentDetail,
  ContentVersion,
  ContentStatus,
  EditorDraft,
} from '@/services/workspace';
import type {
  CreateStructureNodeDto,
  StructureNode,
  UpdateStructureNodeDto,
} from '@/services/structure';

export type TreeNode = StructureNode & {
  children?: TreeNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
};

export type ModalMode = 'create' | 'edit';

export type ModalState = {
  open: boolean;
  mode: ModalMode;
  node?: StructureNode;
  parentId?: string;
};

export type WorkspaceMode = 'formal' | 'draft';

export type FormalContentState = {
  id: string;
  status: ContentStatus;
  latestVersion: ContentVersion;
  publishedVersion: ContentVersion | null;
  hasUnpublishedChanges: boolean;
  bodyMarkdown: string;
  /** 后端提取的 TOC 标题列表，供右侧大纲面板渲染 */
  headings: { level: number; text: string }[];
  updatedAt: string;
};

export type DraftEditorState = {
  title: string;
  summary: string;
  bodyMarkdown: string;
  changeNote: string;
  changeType: ContentChangeType;
};

export type DraftPresence = {
  exists: boolean;
  savedAt?: string;
};

export type NodeSubmitPayload = {
  node: CreateStructureNodeDto | UpdateStructureNodeDto;
};

export type PreviewState = {
  /** MongoDB snapshot ID，取代原 commitHash 成为版本主键 */
  versionId: string;
  title: string;
  summary: string;
  bodyMarkdown: string;
  /** 该版本的 TOC 标题列表（来自版本快照，与当前正式版独立） */
  headings: { level: number; text: string }[];
  committedAt: string;
};

export type ContentVersionViewProps = {
  node: StructureNode;
  content: FormalContentState;
  loading: boolean;
  error: string;
  preview: PreviewState | null;
  previewLoading: boolean;
  onSaveSummary: (summary: string) => Promise<void>;
  onReload: () => Promise<void>;
  onPublish: () => Promise<void>;
  onUnpublish: () => Promise<void>;
  onExitPreview: () => void;
  onPublishPreview: () => Promise<void>;
  onEdit?: (node: StructureNode) => void;
  onDelete?: (node: StructureNode) => void;
  onMoveTo?: (node: StructureNode) => void;
};

export type DraftWorkspaceProps = {
  node: StructureNode;
  formalStatus: ContentStatus;
  draftState: DraftEditorState;
  draftPresence: DraftPresence;
  loading: boolean;
  error: string;
  draftInfo: string;
  isDirty: boolean;
  isAutosaving: boolean;
  lastDraftSavedAt: string;
  autosaveError: string;
  onReloadDraft: () => Promise<void>;
  onBackToContent: () => void;
  onEditorChange: <K extends keyof DraftEditorState>(
    key: K,
    value: DraftEditorState[K],
  ) => void;
  onSaveDraft: () => Promise<void>;
  onCommitDraft: () => Promise<void>;
  onDiscardDraft: () => Promise<void>;
};

export const EMPTY_FORMAL_CONTENT: FormalContentState = {
  id: '',
  status: 'committed',
  latestVersion: {
    versionId: '',
    commitHash: '',
    title: '',
    summary: '',
  },
  publishedVersion: null,
  hasUnpublishedChanges: false,
  bodyMarkdown: '',
  headings: [],
  updatedAt: '',
};

export const EMPTY_DRAFT_EDITOR_STATE: DraftEditorState = {
  title: '',
  summary: '',
  bodyMarkdown: '',
  changeNote: '更新内容',
  changeType: 'patch',
};

export const EMPTY_DRAFT_PRESENCE: DraftPresence = {
  exists: false,
};


export function toFormalContentState(detail: ContentDetail): FormalContentState {
  return {
    id: detail.id,
    status: detail.status,
    latestVersion: detail.latestVersion,
    publishedVersion: detail.publishedVersion ?? null,
    hasUnpublishedChanges: detail.hasUnpublishedChanges,
    bodyMarkdown: resolveAssetsForEditor(detail.bodyMarkdown, detail.id),
    headings: detail.headings,
    updatedAt: detail.updatedAt,
  };
}

/**
 * 将相对路径 ./assets/ 转为代理 URL（编辑器可访问），
 * 保存时后端 saveContent 会反向转回相对路径。
 */
function resolveAssetsForEditor(bodyMarkdown: string, contentId: string): string {
  return bodyMarkdown.replace(
    /\.\/assets\/([^)\s"]+)/g,
    (_match, fileName) => `/api/v1/spaces/notes/items/${contentId}/assets/${fileName}`,
  );
}

export function toDraftEditorStateFromDetail(
  detail: ContentDetail,
): DraftEditorState {
  return {
    title: detail.latestVersion.title,
    summary: detail.latestVersion.summary,
    bodyMarkdown: resolveAssetsForEditor(detail.bodyMarkdown, detail.id),
    changeNote: '更新内容',
    changeType: 'patch',
  };
}

export function toDraftEditorStateFromDraft(
  draft: EditorDraft,
  fallbackChangeType: ContentChangeType = 'patch',
): DraftEditorState {
  return {
    title: draft.title,
    summary: draft.summary,
    bodyMarkdown: draft.bodyMarkdown,
    changeNote: draft.changeNote,
    changeType: fallbackChangeType,
  };
}
