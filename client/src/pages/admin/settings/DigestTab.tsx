/**
 * DigestTab — 智能采集事项列表，作为 Settings sub-tab 内嵌使用。
 * 从 pages/admin/digest/index.tsx 迁移而来，去掉外层 admin 页面布局壳，
 * 对齐 SkillsTab 的结构：顶层 <div className="space-y-6">，header 用 text-base font-semibold。
 * 「信息源」入口按钮已移除，信息源现在是同级 tab（digest-sources）。
 */

import { useState } from 'react';
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
import type { TopicDraft } from './DigestTopicForm';

// ── 本地类型 ──────────────────────────────────────────────────────────────────

interface Topic {
  id: string;
  name: string;
  cron: string;
  cronLabel: string;
  sourceCount: number;
  keywordCount: number;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunHits: number;
  lastRunStatus: 'ok' | 'error' | null;
}

// ── Mock 数据（独立变量，避免 react-refresh/only-export-components 警告） ─────

const MOCK_TOPICS: Topic[] = [
  { id: 'ci_topic_ai001', name: 'AI 应用发展', cron: '0 8 * * *', cronLabel: '每天 8:00', sourceCount: 3, keywordCount: 12, enabled: true, lastRunAt: '2026-06-18T08:00:00Z', lastRunHits: 5, lastRunStatus: 'ok' },
  { id: 'ci_topic_photo02', name: '摄影活动举办', cron: '0 9 * * 1', cronLabel: '每周一 9:00', sourceCount: 2, keywordCount: 8, enabled: true, lastRunAt: '2026-06-17T09:00:00Z', lastRunHits: 2, lastRunStatus: 'ok' },
  { id: 'ci_topic_writing', name: '写作 · 叙事 · 文学', cron: '0 0 */3 * *', cronLabel: '每 3 天 0:00', sourceCount: 4, keywordCount: 15, enabled: false, lastRunAt: null, lastRunHits: 0, lastRunStatus: null },
];

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

// ── 子组件：单行事项 ──────────────────────────────────────────────────────────

function TopicRow({
  topic,
  onEdit,
  onDelete,
}: {
  topic: Topic;
  onEdit: () => void;
  onDelete: () => void;
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
          {topic.cronLabel} · {topic.sourceCount} 个信息源 · {topic.keywordCount} 个关键词
        </p>
      </div>

      {/* 右：最近运行状态 + 操作 */}
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {topic.lastRunAt
            ? `${formatRelativeTime(topic.lastRunAt)} · 命中 ${topic.lastRunHits} 条`
            : '尚未运行'}
        </span>

        {/* enabled toggle 占位，点击提示敬请期待 */}
        <button
          type="button"
          role="switch"
          aria-checked={topic.enabled}
          onClick={(e) => { e.stopPropagation(); banner.info('敬请期待'); }}
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
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<Topic | null>(null);

  const handleCreate = (draft: TopicDraft) => {
    banner.success(`事项「${draft.name}」已新建`);
    setCreating(false);
  };

  const handleUpdate = (draft: TopicDraft) => {
    banner.success(`事项「${draft.name}」已保存`);
    setEditing(null);
  };

  const handleDelete = () => {
    if (!confirmingDelete) return;
    banner.success(`事项「${confirmingDelete.name}」已删除`);
    setConfirmingDelete(null);
  };

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
        {MOCK_TOPICS.length > 0 ? (
          MOCK_TOPICS.map((topic) => (
            <TopicRow
              key={topic.id}
              topic={topic}
              onEdit={() => setEditing(topic)}
              onDelete={() => setConfirmingDelete(topic)}
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
      <Dialog open={creating} onOpenChange={(v) => !v && setCreating(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建事项</DialogTitle>
            <DialogDescription className="sr-only">新建一个智能采集事项，配置信息源和关键词</DialogDescription>
          </DialogHeader>
          <DigestTopicForm onSubmit={handleCreate} onCancel={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      {/* 编辑 Dialog */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑事项</DialogTitle>
            <DialogDescription className="sr-only">修改事项配置</DialogDescription>
          </DialogHeader>
          {editing && (
            <DigestTopicForm
              initial={{ name: editing.name, cron: editing.cron, enabled: editing.enabled }}
              onSubmit={handleUpdate}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认 AlertDialog */}
      <AlertDialog open={!!confirmingDelete} onOpenChange={(v) => !v && setConfirmingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除事项「{confirmingDelete?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销。相关的采集记录和报告将一并移除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction asChild>
              <DangerButton onClick={handleDelete}>删除</DangerButton>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
