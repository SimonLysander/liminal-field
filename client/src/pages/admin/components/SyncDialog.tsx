import { useCallback, useEffect, useState } from 'react';
import { banner } from '@/components/ui/banner-api';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/shared/Modal';
import { settingsApi } from '@/services/settings';
import { LoadingState, ContentFade } from '@/components/LoadingState';

type SyncStatus = Awaited<ReturnType<typeof settingsApi.getSyncStatus>>;

/**
 * SyncDialog — 远程同步弹窗
 *
 * 使用统一 Modal 组件(居中面板,无毛玻璃),替换原有的自写
 * `fixed inset-0 + backdropFilter/motion` 遮罩外壳。
 * 对外 props 保持不变({ onClose }),IconRail 无需修改。
 * open 固定传 true:组件只在 syncOpen 为真时被渲染,渲染即打开。
 */
export function SyncDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SyncStatus>(null);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    settingsApi.getSyncStatus()
      .then(setStatus)
      .catch(() => setError('获取同步状态失败'))
      .finally(() => setLoading(false));
  }, []);

  const handlePush = useCallback(async () => {
    setPushing(true);
    try {
      const result = await settingsApi.pushToRemote();
      if (result.success) {
        onClose();
      } else {
        banner.error(result.message);
      }
    } catch (err) {
      console.error('[SyncDialog] 同步失败:', err);
      // 同步推送失败
      banner.error('同步失败');
    } finally {
      setPushing(false);
    }
  }, [onClose]);

  return (
    <Modal
      open
      onClose={onClose}
      title="推送到远程仓库"
      description="远程同步"
      footer={
        <>
          <Button variant="ghost" size="sm" type="button" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="button"
            onClick={() => void handlePush()}
            disabled={pushing || loading || !status || status.unpushedCommits === 0}
          >
            {pushing ? '推送中...' : '推送'}
          </Button>
        </>
      }
    >
      <ContentFade stateKey={loading ? 'loading' : error ? 'error' : 'status'}>
        {loading ? (
          <LoadingState label="正在获取仓库状态" />
        ) : error ? (
          <div
            className="py-4 text-center text-sm"
            style={{ color: 'var(--mark-red)' }}
          >
            {error}
          </div>
        ) : !status ? (
          <div
            className="py-4 text-center text-sm"
            style={{ color: 'var(--ink-ghost)' }}
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
    </Modal>
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
        className="shrink-0 text-2xs font-medium"
        style={{ color: 'var(--ink-ghost)' }}
      >
        {label}
      </span>
      <span
        className={`text-right text-sm ${truncate ? 'truncate max-w-[200px]' : ''}`}
        style={{
          color: highlight ? 'var(--mark-blue)' : 'var(--ink-faded)',
        }}
        title={truncate ? value : undefined}
      >
        {value}
      </span>
    </div>
  );
}
