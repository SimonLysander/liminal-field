import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { smoothBounce } from '@/lib/motion';
import { structureApi, type DeleteStats } from '@/services/structure';
import { parseError } from '../helpers';
import type { StructureNode } from '@/services/structure';
import { LoadingState } from '@/components/LoadingState';

/**
 * Confirm dialog for destructive actions (delete node).
 *
 * Radius: container uses radius-xl (12px, modal tier).
 * Buttons use rounded-lg. Font sizes use type scale variables.
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <motion.div
        className="w-[360px]"
        style={{
          background: 'var(--paper)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-lg)',
        }}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.2, ease: smoothBounce }}
      >
        <div className="px-6 pb-2 pt-5">
          <div className="font-semibold uppercase" style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)', letterSpacing: '0.04em' }}>
            删除节点
          </div>
          <h3 className="mt-1 font-semibold" style={{ color: 'var(--ink)', fontSize: 'var(--text-lg)' }}>
            确认删除「{node.name}」？
          </h3>
          <div className="mt-2 leading-relaxed" style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-sm)' }}>
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
        </div>

        {error && (
          <div className="px-6">
            <p style={{ color: 'var(--mark-red)', fontSize: 'var(--text-xs)' }}>{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-2 px-6 pb-5 pt-4">
          <button
            type="button"
            className="rounded-lg px-4 py-2 font-medium"
            style={{ background: 'var(--shelf)', color: 'var(--ink-faded)', fontSize: 'var(--text-sm)' }}
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-lg px-4 py-2 font-medium transition-opacity duration-150 disabled:opacity-50"
            style={{ background: 'var(--mark-red)', color: '#fff', fontSize: 'var(--text-sm)' }}
            onClick={() => void handleConfirm()}
            disabled={loading || statsLoading}
          >
            {loading ? '删除中...' : '删除'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};
