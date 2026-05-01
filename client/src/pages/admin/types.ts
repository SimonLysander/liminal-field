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
  commitHash: string;
  title: string;
  bodyMarkdown: string;
  committedAt: string;
};

export type ContentVersionViewProps = {
  node: StructureNode;
  content: FormalContentState;
  loading: boolean;
  error: string;
  preview: PreviewState | null;
  previewLoading: boolean;
  onReload: () => Promise<void>;
  onPublish: () => Promise<void>;
  onUnpublish: () => Promise<void>;
  onExitPreview: () => void;
  onPublishPreview: () => Promise<void>;
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
    commitHash: '',
    title: '',
    summary: '',
  },
  publishedVersion: null,
  hasUnpublishedChanges: false,
  bodyMarkdown: '',
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
    bodyMarkdown: detail.bodyMarkdown,
    updatedAt: detail.updatedAt,
  };
}

export function toDraftEditorStateFromDetail(
  detail: ContentDetail,
): DraftEditorState {
  return {
    title: detail.latestVersion.title,
    summary: detail.latestVersion.summary,
    bodyMarkdown: detail.bodyMarkdown,
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
