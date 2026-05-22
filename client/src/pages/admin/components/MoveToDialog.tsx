/*
 * MoveToDialog — 面包屑钻入式文件夹选择弹窗
 *
 * 用户在列表项上触发"移动到..."后弹出。
 * 交互模式与 AdminStructurePanel / 展示端 Sidebar 一致：
 * 一次显示一个层级的文件夹，点击进入下一层，面包屑回退。
 * 选定目标后点"移动到此处"确认。
 */

import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight, Folder } from 'lucide-react';
import { smoothBounce } from '@/lib/motion';
import { structureApi } from '@/services/structure';
import type { StructureNode } from '@/services/structure';
import { LoadingState, ContentFade } from '@/components/LoadingState';

type BreadcrumbItem = { id: string; name: string };

type MoveToDialogProps = {
  /** 正在移动的节点（用于显示标题 + 排除自身） */
  node: StructureNode;
  /** scope 隔离：只显示同 scope 的文件夹 */
  scope: string;
  onConfirm: (targetFolderId: string | null) => Promise<void>;
  onClose: () => void;
};

/** 加载指定层级的文件夹列表（scope 隔离） */
function useFolderLevel(parentId: string | undefined, scope: string) {
  const [folders, setFolders] = useState<StructureNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);

      const req = parentId
        ? structureApi.getChildren(parentId, { visibility: 'all', scope })
        : structureApi.getRootNodes({ visibility: 'all', scope });

      try {
        const result = await req;
        if (!cancelled) {
          setFolders(result.children.filter((n) => n.type === 'FOLDER'));
        }
      } catch {
        // 文件夹列表加载失败时静默降级为空列表
        if (!cancelled) setFolders([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [parentId, scope]);

  return { folders, loading };
}

export function MoveToDialog({ node, scope, onConfirm, onClose }: MoveToDialogProps) {
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedParentId = breadcrumb.length > 0
    ? breadcrumb[breadcrumb.length - 1].id
    : undefined;

  const { folders, loading } = useFolderLevel(selectedParentId, scope);

  /* 目标与当前位置相同时禁用确认按钮 */
  const isSamePosition = (selectedParentId ?? null) === (node.parentId ?? null);

  /* 排除正在移动的节点自身（如果它是文件夹，不能移入自己） */
  const filteredFolders = folders.filter((f) => f.id !== node.id);

  const enterFolder = (folder: StructureNode) => {
    setBreadcrumb((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const goToBreadcrumb = (index: number | null) => {
    if (index === null) {
      setBreadcrumb([]);
    } else {
      setBreadcrumb((prev) => prev.slice(0, index + 1));
    }
  };

  const handleConfirm = useCallback(async () => {
    setSubmitting(true);
    setError('');
    try {
      await onConfirm(selectedParentId ?? null);
      onClose();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : '移动失败');
    } finally {
      setSubmitting(false);
    }
  }, [selectedParentId, onConfirm, onClose]);

  /* 目标位置描述 */
  const targetLabel = breadcrumb.length > 0
    ? breadcrumb[breadcrumb.length - 1].name
    : '根目录';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        className="flex w-[420px] flex-col overflow-hidden rounded-xl"
        style={{
          background: 'var(--paper)',
          boxShadow: 'var(--shadow-lg)',
          maxHeight: '70vh',
        }}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: smoothBounce }}
      >
        {/* Header */}
        <div className="px-6 pb-1 pt-5">
          <h2
            className="text-lg font-semibold"
            style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}
          >
            移动「{node.name}」
          </h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            选择目标位置
          </p>
        </div>

        {/* Breadcrumb */}
        <div className="px-6 pt-3 pb-2">
          {breadcrumb.length === 0 ? (
            <span
              className="text-xs font-medium"
              style={{ color: 'var(--ink-ghost)' }}
            >
              根目录
            </span>
          ) : (
            <div className="flex items-center whitespace-nowrap">
              <span
                className="shrink-0 cursor-pointer rounded p-0.5 transition-colors duration-150"
                style={{ color: 'var(--ink-faded)' }}
                onClick={() =>
                  breadcrumb.length >= 2
                    ? goToBreadcrumb(breadcrumb.length - 2)
                    : goToBreadcrumb(null)
                }
              >
                <ChevronLeft size={14} strokeWidth={2} />
              </span>
              <div className="flex min-w-0 items-center gap-1">
                {breadcrumb.length === 1 ? (
                  <span
                    className="cursor-pointer truncate rounded px-1 py-0.5 text-xs"
                    style={{ color: 'var(--ink-light)' }}
                    onClick={() => goToBreadcrumb(null)}
                  >
                    根目录
                  </span>
                ) : (
                  <>
                    <span
                      className="cursor-pointer rounded px-1 py-0.5 text-xs"
                      style={{ color: 'var(--ink-ghost)' }}
                      onClick={() => goToBreadcrumb(null)}
                    >
                      …
                    </span>
                    <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>/</span>
                    <span
                      className="cursor-pointer truncate rounded px-1 py-0.5 text-xs"
                      style={{ color: 'var(--ink-light)' }}
                      onClick={() => goToBreadcrumb(breadcrumb.length - 2)}
                    >
                      {breadcrumb[breadcrumb.length - 2]?.name}
                    </span>
                    <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>/</span>
                  </>
                )}
                <span
                  className="truncate text-xs font-medium"
                  style={{ color: 'var(--ink)' }}
                >
                  {breadcrumb[breadcrumb.length - 1].name}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Folder list */}
        <div className="flex-1 overflow-y-auto px-4 pb-2" style={{ minHeight: 120 }}>
          <ContentFade stateKey={loading ? 'loading' : `folders-${selectedParentId || 'root'}`}>
            {loading ? (
              <LoadingState />
            ) : filteredFolders.length === 0 ? (
              <div className="py-6 text-center text-xs" style={{ color: 'var(--ink-ghost)' }}>
                无子文件夹
              </div>
            ) : (
              <div>
                {filteredFolders.map((folder) => (
                  <div
                    key={folder.id}
                    className="flex cursor-pointer items-center gap-2 rounded-[10px] px-2.5 py-[7px] transition-colors duration-150"
                    style={{ color: 'var(--ink-light)' }}
                    onClick={() => enterFolder(folder)}
                    onMouseOver={(e) => { e.currentTarget.style.background = 'var(--shelf)'; }}
                    onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Folder size={14} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)' }} />
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {folder.name}
                    </span>
                    {folder.hasChildren && (
                      <ChevronRight size={12} strokeWidth={2} className="shrink-0" style={{ color: 'var(--ink-ghost)' }} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </ContentFade>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-3" style={{ borderTop: '0.5px solid var(--separator)' }}>
          {error && (
            <p className="mb-2 text-xs" style={{ color: 'var(--mark-red)' }}>{error}</p>
          )}
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
              目标：{targetLabel}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg px-4 py-2 text-sm font-medium"
                style={{ background: 'var(--shelf)', color: 'var(--ink-faded)' }}
                onClick={onClose}
              >
                取消
              </button>
              <button
                type="button"
                disabled={submitting || isSamePosition}
                className="rounded-lg px-4 py-2 text-sm font-medium transition-opacity duration-150 disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
                onClick={() => void handleConfirm()}
              >
                {submitting ? '移动中...' : isSamePosition ? '已在此位置' : '移动到此处'}
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
