import { useEffect, useState } from 'react';
import { structureApi, type DeleteStats } from '@/services/structure';
import { parseError } from '../helpers';
import type { StructureNode } from '@/services/structure';
import { LoadingState } from '@/components/LoadingState';
import { Modal } from '@/components/shared/Modal';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field-error';

/**
 * Confirm dialog for destructive actions (delete node).
 *
 * 外壳迁移：原 fixed inset-0 + blur + motion → 统一 <Modal> 标准组件（L3）。
 * open 固定传 true：组件只在 workspace.deleteTarget 存在时被渲染，渲染即打开。
 * 对外 props 签名不变：{ node, onConfirm, onCancel }。
 * 删除按钮改用 variant="danger"（原 var(--mark-red) 红块 → 设计系统危险语义）。
 */
export const ConfirmDialog = ({
  node,
  onConfirm,
  onCancel,
}: {
  node: StructureNode;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [stats, setStats] = useState<DeleteStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    structureApi
      .getDeleteStats(node.id)
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch((statsError) => {
        if (!cancelled) setError(parseError(statsError, '获取统计失败'));
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => { cancelled = true; };
  }, [node.id]);

  const handleConfirm = async () => {
    setLoading(true);
    setError('');
    try {
      await onConfirm();
    } catch (confirmError) {
      setError(parseError(confirmError, '删除失败'));
      setLoading(false);
    }
  };

  const hasDescendants = stats && (stats.folderCount + stats.docCount > 1);

  return (
    <Modal
      open
      onClose={onCancel}
      title={`确认删除「${node.name}」？`}
      footer={
        <>
          <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button
            variant="danger"
            size="sm"
            type="button"
            onClick={() => void handleConfirm()}
            disabled={loading || statsLoading}
          >
            {loading ? '删除中...' : '删除'}
          </Button>
        </>
      }
    >
      {/* 统计文案：加载中 / 有子节点 / 无子节点三态 */}
      <div className="text-sm leading-relaxed" style={{ color: 'var(--ink-faded)' }}>
        {statsLoading ? (
          <LoadingState variant="inline" label="正在统计" />
        ) : stats && hasDescendants ? (
          <span>
            将删除 <strong style={{ color: 'var(--mark-red)' }}>{stats.folderCount}</strong> 个主题、
            <strong style={{ color: 'var(--mark-red)' }}>{stats.docCount}</strong> 个内容节点，此操作不可撤销。
          </span>
        ) : (
          <span>此操作不可撤销。</span>
        )}
      </div>
      <FieldError>{error}</FieldError>
    </Modal>
  );
};
