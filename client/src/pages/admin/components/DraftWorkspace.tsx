import { useEffect, useState } from 'react';
import { PlateMarkdownEditor } from './PlateEditor';
import type { DraftWorkspaceProps } from '../types';
import { LoadingState, ContentFade } from '@/components/LoadingState';
import { DraftAssetProvider } from '@/contexts/DraftAssetContext';

export const DraftWorkspace = ({
  node,
  formalStatus,
  draftState,
  loading,
  error,
  draftInfo,
  isDirty,
  isAutosaving,
  lastDraftSavedAt,
  autosaveError,
  onReloadDraft,
  onBackToContent,
  onEditorChange,
  onSaveDraft,
  onCommitDraft,
  onDiscardDraft,
}: DraftWorkspaceProps) => {
  /*
   * resetKey: incremented when draft content is reloaded from the server,
   * forcing PlateMarkdownEditor to unmount/remount with fresh markdown.
   */
  const [resetKey, setResetKey] = useState(0);

  /* Keyboard shortcuts: Cmd+S → commit, Cmd+Shift+S → save draft */
  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const isSaveKey =
        event.key.toLowerCase() === 's' && (event.metaKey || event.ctrlKey);
      if (!isSaveKey) return;

      event.preventDefault();

      if (event.shiftKey) {
        void onSaveDraft();
        return;
      }

      void onCommitDraft();
    };

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [onCommitDraft, onSaveDraft]);

  const handleReloadDraft = async () => {
    await onReloadDraft();
    setResetKey((k) => k + 1);
  };

  const handleDiscardDraft = async () => {
    const confirmed = window.confirm(
      '确认丢弃当前草稿并返回正式内容视图？',
    );
    if (!confirmed) return;
    await onDiscardDraft();
  };

  const stateKey = loading ? 'loading' : error ? 'error' : 'content';

  return (
    <ContentFade stateKey={stateKey}>
      {loading ? (
        <LoadingState label="加载草稿中" />
      ) : error ? (
        <div className="rounded-xl p-4" style={{ background: 'rgba(255,59,48,0.06)' }}>
          <p style={{ color: 'var(--mark-red)', fontSize: 'var(--text-sm)' }}>{error}</p>
        </div>
      ) : (
    <div className="space-y-4">
      {/* Action bar */}
      <div className="flex items-center justify-between">
        <p style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)' }}>
          草稿工作区 · 基于{formalStatus}版本
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <ActionBtn label="← 返回" onClick={() => void onBackToContent()} />
          <ActionBtn label="刷新" onClick={() => void handleReloadDraft()} />
          <ActionBtn label="保存" onClick={() => void onSaveDraft()} />
          <ActionBtn label="提交" primary onClick={() => void onCommitDraft()} />
          <ActionBtn label="丢弃" danger onClick={() => void handleDiscardDraft()} />
        </div>
      </div>

      {/* Status bar */}
      {(isDirty || isAutosaving || lastDraftSavedAt || autosaveError || draftInfo) && (
        <div className="flex flex-wrap items-center gap-3" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-xs)' }}>
          {isAutosaving && <StatusDot color="var(--mark-blue)" label="自动保存中..." />}
          {isDirty && !isAutosaving && <StatusDot color="var(--mark-red)" label="有未保存的更改" />}
          {!isDirty && !isAutosaving && lastDraftSavedAt && <StatusDot color="var(--mark-green)" label="已同步" />}
          {lastDraftSavedAt && (
            <span>上次保存 {new Date(lastDraftSavedAt).toLocaleString('zh-CN')}</span>
          )}
          <span style={{ opacity: 0.5 }}>⌘S 提交 · ⌘⇧S 保存</span>
          {autosaveError && <span style={{ color: 'var(--mark-red)' }}>{autosaveError}</span>}
          {draftInfo && <span>{draftInfo}</span>}
        </div>
      )}

      {/* Inline title — Ghost/Notion style, no label/border/background */}
      <input
        type="text"
        value={draftState.title}
        onChange={(e) => onEditorChange('title', e.target.value)}
        placeholder="无标题"
        className="w-full border-none bg-transparent font-bold outline-none placeholder:text-[var(--ink-ghost)]"
        style={{ color: 'var(--ink)', fontSize: 'var(--text-5xl)', letterSpacing: '-0.025em', lineHeight: 1.2 }}
      />

      {/* Plate rich-text editor — immediately after title */}
      <DraftAssetProvider contentItemId={node.contentItemId!}>
        <PlateMarkdownEditor
          key={resetKey}
          initialMarkdown={draftState.bodyMarkdown}
          onChange={(md) => onEditorChange('bodyMarkdown', md)}
          charCount={draftState.bodyMarkdown.length}
        />
      </DraftAssetProvider>
    </div>
      )}
    </ContentFade>
  );
};

/* ---------- Shared primitives ---------- */

function ActionBtn({
  label,
  primary,
  danger,
  onClick,
}: {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="transition-colors duration-150"
      style={{
        color: danger ? 'var(--mark-red)' : primary ? 'var(--ink)' : 'var(--ink-faded)',
        fontSize: 'var(--text-xs)',
        fontWeight: primary ? 600 : 400,
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function StatusDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
