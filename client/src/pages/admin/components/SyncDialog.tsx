import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { smoothBounce } from '@/lib/motion';
import { authApi } from '@/services/auth';
import { LoadingState, ContentFade } from '@/components/LoadingState';

type SyncStatus = Awaited<ReturnType<typeof authApi.syncStatus>>;

export function SyncDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SyncStatus>(null);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    authApi.syncStatus()
      .then(setStatus)
      .catch(() => setError('获取同步状态失败'))
      .finally(() => setLoading(false));
  }, []);

  const handlePush = useCallback(async () => {
    setPushing(true);
    try {
      const result = await authApi.sync();
      if (result.success) {
        toast.success(result.message);
        onClose();
      } else {
        toast.error(result.message);
      }
    } catch {
      toast.error('同步失败');
    } finally {
      setPushing(false);
    }
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
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
          <div
            className="font-semibold uppercase"
            style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)', letterSpacing: '0.04em' }}
          >
            远程同步
          </div>
          <h3
            className="mt-1 font-semibold"
            style={{ color: 'var(--ink)', fontSize: 'var(--text-lg)' }}
          >
            推送到远程仓库
          </h3>
        </div>

        <div className="px-6 pb-1 pt-2">
          <ContentFade stateKey={loading ? 'loading' : error ? 'error' : 'status'}>
            {loading ? (
              <LoadingState label="正在获取仓库状态" />
            ) : error ? (
              <div
                className="py-4 text-center"
                style={{ color: 'var(--mark-red)', fontSize: 'var(--text-sm)' }}
              >
                {error}
              </div>
            ) : !status ? (
              <div
                className="py-4 text-center"
                style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-sm)' }}
              >
                未配置 Git 仓库
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <InfoRow label="分支" value={status.branch} />
                <InfoRow label="总提交" value={`${status.totalCommits} 次`} />
                <InfoRow
                  label="待推送"
                  value={
                    status.unpushedCommits > 0
                      ? `${status.unpushedCommits} 个提交`
                      : '已是最新'
                  }
                  highlight={status.unpushedCommits > 0}
                />
                {status.lastCommitMessage && (
                  <InfoRow label="最近提交" value={status.lastCommitMessage} truncate />
                )}
                {status.lastCommitTime && (
                  <InfoRow
                    label="提交时间"
                    value={new Date(status.lastCommitTime).toLocaleString('zh-CN')}
                  />
                )}
              </div>
            )}
          </ContentFade>
        </div>

        <div className="flex justify-end gap-2 px-6 pb-5 pt-4">
          <button
            type="button"
            className="rounded-lg px-4 py-2 font-medium"
            style={{ background: 'var(--shelf)', color: 'var(--ink-faded)', fontSize: 'var(--text-sm)' }}
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded-lg px-4 py-2 font-medium transition-opacity duration-150 disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'var(--accent-contrast)', fontSize: 'var(--text-sm)' }}
            onClick={() => void handlePush()}
            disabled={pushing || loading || !status || status.unpushedCommits === 0}
          >
            {pushing ? '推送中...' : '推送'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function InfoRow({
  label,
  value,
  highlight,
  truncate,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span
        className="shrink-0 font-medium"
        style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-2xs)' }}
      >
        {label}
      </span>
      <span
        className={`text-right ${truncate ? 'truncate max-w-[200px]' : ''}`}
        style={{
          color: highlight ? 'var(--mark-blue)' : 'var(--ink-faded)',
          fontSize: 'var(--text-sm)',
        }}
        title={truncate ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}
