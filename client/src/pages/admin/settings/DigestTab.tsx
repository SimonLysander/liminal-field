/**
 * DigestTab — 智能采集事项列表，作为 Settings sub-tab 内嵌使用。
 *
 * 数据来源: topicsApi（/digest/topics）
 * 模式: useState + async/await + try/catch + banner 反馈（同 DigestSourcesTab）
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Pencil, Trash2, ChevronRight } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { banner } from '@/components/ui/banner-api';
import { PrimaryButton, DangerButton } from './SettingsUI';
import { DigestTopicForm } from './DigestTopicForm';
import type { TopicDraft, TopicFormInitial } from './DigestTopicForm';
import { topicsApi } from '@/services/topics';
import type { TopicSummary, TopicDetail } from '@/services/topics';

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  return `${Math.floor(hr / 24)} 天前`;
}

/** draft 的 keywords 字符串 → string[] */
function parseKeywords(raw: string): string[] {
  return raw
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
}

// ── 子组件：单行事项 ──────────────────────────────────────────────────────────

function TopicRow({
  topic,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  topic: TopicSummary;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3 transition-colors duration-100 hover:bg-[var(--shelf)]"
      style={{
        background: 'var(--paper-dark)',
        border: '0.5px solid var(--separator)',
      }}
      onClick={() => navigate(`/admin/digest/${topic.id}`)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/admin/digest/${topic.id}`)}
      aria-label={`进入事项「${topic.name}」详情`}
    >
      {/* 左：名称 + 摘要 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {topic.name}
          </span>
          {!topic.enabled && (
            <span
              className="rounded px-1.5 py-0.5 text-2xs"
              style={{ background: 'var(--shelf)', color: 'var(--ink-ghost)', border: '0.5px solid var(--separator)' }}
            >
              停用
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-faded)' }}>
          {topic.cron} · {topic.sourceCount} 个信息源 · {topic.keywordCount} 个关键词
        </p>
      </div>

      {/* 右：最近运行状态 + 操作 */}
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {topic.lastRunAt
            ? `${formatRelativeTime(topic.lastRunAt)} · 命中 ${topic.lastRunHits} 条`
            : '尚未运行'}
        </span>

        <button
          type="button"
          role="switch"
          aria-checked={topic.enabled}
          onClick={(e) => { e.stopPropagation(); onToggleEnabled(); }}
          className="relative h-5 w-9 rounded-full transition-colors duration-150"
          style={{ background: topic.enabled ? 'var(--accent)' : 'var(--separator)' }}
          title={topic.enabled ? '停用' : '启用'}
        >
          <span
            className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150"
            style={{ left: topic.enabled ? '1.125rem' : '0.125rem' }}
          />
        </button>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={onEdit}
            className="rounded p-1.5 transition-colors duration-100 hover:bg-[var(--shelf)]"
            style={{ color: 'var(--ink-faded)' }}
            title="编辑"
            aria-label={`编辑事项「${topic.name}」`}
          >
            <Pencil size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="rounded p-1.5 transition-colors duration-100 hover:bg-[var(--shelf)]"
            style={{ color: 'var(--ink-ghost)' }}
            title="删除"
            aria-label={`删除事项「${topic.name}」`}
          >
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        </div>

        <ChevronRight size={14} strokeWidth={1.5} style={{ color: 'var(--ink-ghost)' }} />
      </div>
    </div>
  );
}

// ── Tab 主体 ──────────────────────────────────────────────────────────────────

export function DigestTab() {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  // 编辑时需要 TopicDetail（含 sourceIds / keywords / prompt）
  const [editingDetail, setEditingDetail] = useState<TopicDetail | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<TopicSummary | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadTopics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await topicsApi.list();
      setTopics(list);
    } catch {
      setError('加载事项失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void loadTopics();
  }, [loadTopics]);

  /** 点击编辑：拉 detail（含完整配置）再打开 Dialog */
  const handleOpenEdit = async (id: string) => {
    try {
      const detail = await topicsApi.get(id);
      setEditingDetail(detail);
    } catch {
      banner.error('加载事项详情失败');
    }
  };

  const handleCreate = async (draft: TopicDraft) => {
    setSubmitting(true);
    try {
      await topicsApi.create({
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        cron: draft.cron.trim(),
        sourceIds: draft.sourceIds,
        keywords: parseKeywords(draft.keywords),
        prompt: draft.aiPrompt.trim(),
        enabled: draft.enabled,
      });
      banner.success(`事项「${draft.name}」已新建`);
      setCreating(false);
      await loadTopics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '创建失败';
      banner.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (draft: TopicDraft) => {
    if (!editingDetail) return;
    setSubmitting(true);
    try {
      await topicsApi.update(editingDetail.id, {
        name: draft.name.trim(),
        description: draft.description.trim(),
        cron: draft.cron.trim(),
        sourceIds: draft.sourceIds,
        keywords: parseKeywords(draft.keywords),
        prompt: draft.aiPrompt.trim(),
        enabled: draft.enabled,
      });
      banner.success(`事项「${draft.name}」已保存`);
      setEditingDetail(null);
      await loadTopics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '保存失败';
      banner.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmingDelete) return;
    setSubmitting(true);
    try {
      await topicsApi.delete(confirmingDelete.id);
      banner.success(`事项「${confirmingDelete.name}」已删除`);
      setConfirmingDelete(null);
      await loadTopics();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除失败';
      banner.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleEnabled = async (topic: TopicSummary) => {
    try {
      await topicsApi.update(topic.id, { enabled: !topic.enabled });
      banner.success(
        topic.enabled ? `事项「${topic.name}」已停用` : `事项「${topic.name}」已启用`,
      );
      await loadTopics();
    } catch {
      banner.error('操作失败');
    }
  };

  /** 编辑 initial：从 TopicDetail 组装 TopicFormInitial */
  const editingInitial: TopicFormInitial | undefined = editingDetail
    ? {
        name: editingDetail.name,
        description: editingDetail.description,
        cron: editingDetail.cron,
        keywords: editingDetail.keywords,
        sourceIds: editingDetail.sourceIds,
        aiPrompt: editingDetail.prompt,
        enabled: editingDetail.enabled,
      }
    : undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            智能采集
          </h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            配置关注事项，自动从订阅信息源里采集，AI 判定相关性，生成精选报告。
          </p>
        </div>
        <PrimaryButton onClick={() => setCreating(true)}>
          + 新建事项
        </PrimaryButton>
      </div>
      <Separator />

      {/* 列表 */}
      <section className="space-y-2">
        {loading ? (
          <div
            className="rounded-lg px-3 py-6 text-center text-xs"
            style={{ color: 'var(--ink-ghost)', border: '1px dashed var(--separator)' }}
          >
            加载中…
          </div>
        ) : error ? (
          <div
            className="rounded-lg px-3 py-6 text-center text-xs"
            style={{ color: 'var(--error, #e53e3e)', border: '1px dashed var(--separator)' }}
          >
            {error}
          </div>
        ) : topics.length > 0 ? (
          topics.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              onEdit={() => void handleOpenEdit(topic.id)}
              onDelete={() => setConfirmingDelete(topic)}
              onToggleEnabled={() => void handleToggleEnabled(topic)}
            />
          ))
        ) : (
          <div
            className="rounded-lg px-3 py-6 text-center text-xs"
            style={{ color: 'var(--ink-ghost)', border: '1px dashed var(--separator)' }}
          >
            还没有事项，点右上「新建事项」开始关注一个话题。
          </div>
        )}
      </section>

      {/* 新建 Dialog */}
      <Dialog open={creating} onOpenChange={(v) => !v && !submitting && setCreating(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建事项</DialogTitle>
            <DialogDescription className="sr-only">新建一个智能采集事项，配置信息源和关键词</DialogDescription>
          </DialogHeader>
          <DigestTopicForm onSubmit={(d) => void handleCreate(d)} onCancel={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      {/* 编辑 Dialog */}
      <Dialog open={!!editingDetail} onOpenChange={(v) => !v && !submitting && setEditingDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑事项</DialogTitle>
            <DialogDescription className="sr-only">修改事项配置</DialogDescription>
          </DialogHeader>
          {editingDetail && editingInitial && (
            <DigestTopicForm
              initial={editingInitial}
              onSubmit={(d) => void handleUpdate(d)}
              onCancel={() => setEditingDetail(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认 AlertDialog */}
      <AlertDialog
        open={!!confirmingDelete}
        onOpenChange={(v) => !v && !submitting && setConfirmingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除事项「{confirmingDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销。相关的采集记录和报告将一并移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction asChild>
              <DangerButton onClick={() => void handleDelete()} disabled={submitting}>
                删除
              </DangerButton>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
