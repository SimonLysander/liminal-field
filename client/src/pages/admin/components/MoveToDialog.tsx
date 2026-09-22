/*
 * MoveToDialog — 面包屑钻入式目标节点选择弹窗
 *
 * 用户在列表项上触发"移动到..."后弹出。
 * 交互模式与 AdminStructurePanel / 展示端 Sidebar 一致：
 * 一次显示一个层级的节点，点击进入下一层，面包屑回退。
 * 节点采用同质化模型：叶子节点同样可以接收子节点，因此不能只展示
 * 当前已经拥有子节点的“文件夹”。
 * 选定目标后点"移动到此处"确认。
 *
 * 外壳迁移：原 fixed inset-0 + blur + motion → 统一 <Modal> 标准组件（L3）。
 * open 固定传 true：组件只在 workspace.moveTarget 存在时被渲染，渲染即打开。
 * 对外 props 签名不变：{ node, scope, onConfirm, onClose }。
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Folder } from 'lucide-react';
import { structureApi } from '@/services/structure';
import type { StructureNode } from '@/services/structure';
import { LoadingState, ContentFade } from '@/components/LoadingState';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-error';
import { createLogger } from '@/lib/logger';

const logger = createLogger('move-to-dialog');

type BreadcrumbItem = { id: string; name: string };

type MoveToDialogProps = {
  /** 正在移动的节点（用于显示标题 + 排除自身） */
  node: StructureNode;
  /** scope 隔离：只显示同 scope 的候选父节点 */
  scope: string;
  onConfirm: (targetParentId: string | null) => Promise<void>;
  onClose: () => void;
};

/** 加载指定层级的候选父节点（scope 隔离） */
function useTargetLevel(parentId: string | undefined, scope: string) {
  const [targets, setTargets] = useState<StructureNode[]>([]);
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
          setTargets(result.children);
        }
      } catch (err) {
        logger.error('load_targets_failed', {
          parentId: parentId ?? null,
          scope,
          errorType: err instanceof Error ? err.name : typeof err,
        });
        // 保持弹窗可操作，并通过空列表明确表示当前层级不可用。
        if (!cancelled) setTargets([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [parentId, scope]);

  return { targets, loading };
}

export function MoveToDialog({ node, scope, onConfirm, onClose }: MoveToDialogProps) {
  const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const selectedParentId = breadcrumb.length > 0
    ? breadcrumb[breadcrumb.length - 1].id
    : undefined;

  const { targets, loading } = useTargetLevel(selectedParentId, scope);

  /* 目标与当前位置相同时禁用确认按钮 */
  const isSamePosition = (selectedParentId ?? null) === (node.parentId ?? null);

  /* 排除自身后，其后代也无法从当前层级进入；后端仍负责最终循环校验。 */
  const availableTargets = targets.filter((target) => target.id !== node.id);

  const enterTarget = (target: StructureNode) => {
    setBreadcrumb((prev) => [...prev, { id: target.id, name: target.name }]);
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
    <Modal
      open
      onClose={onClose}
      title={`移动「${node.name}」`}
      description="选择目标位置"
      footer={
        /* footer 区：目标位置标签 + 取消 + 确认，使用 flex 撑开让标签靠左 */
        <div className="flex w-full items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
            目标：{targetLabel}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" type="button" onClick={onClose}>
              取消
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="button"
              disabled={submitting || isSamePosition}
              onClick={() => void handleConfirm()}
            >
              {submitting ? '移动中...' : isSamePosition ? '已在此位置' : '移动到此处'}
            </Button>
          </div>
        </div>
      }
    >
      {/* 面包屑导航 */}
      <div className="pb-1 pt-0">
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

      {/* 候选父节点列表（限高保证弹窗不撑满屏幕） */}
      <div className="overflow-y-auto" style={{ minHeight: 120, maxHeight: '40vh' }}>
        <ContentFade stateKey={loading ? 'loading' : `targets-${selectedParentId || 'root'}`}>
          {loading ? (
            <LoadingState />
          ) : availableTargets.length === 0 ? (
            <div className="py-6 text-center text-xs" style={{ color: 'var(--ink-ghost)' }}>
              无下级节点
            </div>
          ) : (
            <div>
              {availableTargets.map((target) => (
                <div
                  key={target.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors duration-150 hover:bg-[var(--shelf)]"
                  style={{ color: 'var(--ink-light)' }}
                  onClick={() => enterTarget(target)}
                >
                  <Folder size={14} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)' }} />
                  <span className="min-w-0 flex-1 truncate text-base">
                    {target.name}
                  </span>
                  <ChevronRight size={12} strokeWidth={2} className="shrink-0" style={{ color: 'var(--ink-ghost)' }} />
                </div>
              ))}
            </div>
          )}
        </ContentFade>
      </div>

      <FieldError>{error}</FieldError>
    </Modal>
  );
}
