/**
 * DigestSourcesTab — 信息源管理，作为 Settings sub-tab 内嵌使用。
 * 从 pages/admin/sources/index.tsx 迁移而来，去掉外层 admin 页面布局壳和「← 返回」面包屑，
 * 对齐 SkillsTab 的结构：顶层 <div className="space-y-6">，header 用 text-base font-semibold。
 * 全局共用：一个源可被多事项订阅，不重复抓取。首期只支持 RSS / Atom。
 */

import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
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
import { FieldLabel, PrimaryButton, SecondaryButton, DangerButton } from './SettingsUI';

// ── 本地类型（隔离后端，骨架阶段不 import server types） ──────────────────────

interface InfoSource {
  id: string;
  type: 'rss';
  name: string;
  url: string;
  enabled: boolean;
  lastFetchedAt: string | null;
  subscriberCount: number;
}

// ── Mock 数据（独立变量，避免 react-refresh/only-export-components 警告） ─────

const MOCK_SOURCES: InfoSource[] = [
  { id: 'src_1a2b3c4d5e6f', type: 'rss', name: 'Paul Graham Essays', url: 'http://www.aaronsw.com/2002/feeds/pgessays.rss', enabled: true, lastFetchedAt: '2026-06-18T07:00:00Z', subscriberCount: 2 },
  { id: 'src_7g8h9i0j1k2l', type: 'rss', name: 'Hacker News Frontpage', url: 'https://hnrss.org/frontpage', enabled: true, lastFetchedAt: '2026-06-18T08:30:00Z', subscriberCount: 1 },
  { id: 'src_3m4n5o6p7q8r', type: 'rss', name: 'LessWrong', url: 'https://www.lesswrong.com/feed.xml', enabled: false, lastFetchedAt: null, subscriberCount: 0 },
  { id: 'src_9s0t1u2v3w4x', type: 'rss', name: '少数派', url: 'https://sspai.com/feed', enabled: true, lastFetchedAt: '2026-06-18T06:15:00Z', subscriberCount: 1 },
  { id: 'src_5y6z7a8b9c0d', type: 'rss', name: '阮一峰的网络日志', url: 'http://www.ruanyifeng.com/blog/atom.xml', enabled: true, lastFetchedAt: '2026-06-18T05:45:00Z', subscriberCount: 3 },
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

// ── 子组件：单行信息源 ─────────────────────────────────────────────────────────

function SourceRow({
  source,
  onEdit,
  onDelete,
}: {
  source: InfoSource;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg px-4 py-3"
      style={{
        background: 'var(--paper-dark)',
        border: '0.5px solid var(--separator)',
      }}
    >
      {/* type chip */}
      <span
        className="shrink-0 rounded px-2 py-0.5 text-2xs font-medium uppercase tracking-wide"
        style={{
          background: 'var(--shelf)',
          color: 'var(--ink-faded)',
          border: '0.5px solid var(--separator)',
        }}
      >
        {source.type}
      </span>

      {/* 主体信息 */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            {source.name}
          </span>
          <span
            className="truncate font-mono text-2xs"
            style={{ color: 'var(--ink-ghost)' }}
            title={source.url}
          >
            {source.url}
          </span>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {source.lastFetchedAt
            ? `上次抓取 ${formatRelativeTime(source.lastFetchedAt)}`
            : '尚未抓取'}
          {' · '}
          {source.subscriberCount} 个事项订阅
        </p>
      </div>

      {/* enabled 状态 — 视觉占位，点击提示敬请期待 */}
      <button
        type="button"
        onClick={() => banner.info('敬请期待')}
        className="shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium transition-colors"
        style={
          source.enabled
            ? { background: 'var(--accent)', color: '#fff' }
            : { background: 'var(--shelf)', color: 'var(--ink-ghost)', border: '0.5px solid var(--separator)' }
        }
      >
        {source.enabled ? '启用' : '停用'}
      </button>

      {/* 操作按钮 */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          className="rounded p-1.5 transition-colors duration-100 hover:bg-[var(--shelf)]"
          style={{ color: 'var(--ink-faded)' }}
          title="编辑"
          aria-label={`编辑 ${source.name}`}
        >
          <Pencil size={14} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1.5 transition-colors duration-100 hover:bg-[var(--shelf)]"
          style={{ color: 'var(--ink-ghost)' }}
          title="删除"
          aria-label={`删除 ${source.name}`}
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}

// ── 子组件：新建/编辑表单 ──────────────────────────────────────────────────────

const OTHER_TYPES = [
  { label: '网页监控', value: 'web' },
  { label: 'API 推送', value: 'api' },
  { label: '邮件订阅', value: 'email' },
  { label: 'Podcast', value: 'podcast' },
] as const;

interface SourceDraft { name: string; url: string; enabled: boolean; }

// 表单输入公共样式
const inputCls = 'mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none';
const inputSty = { background: 'var(--paper-white)', color: 'var(--ink)', border: '1px solid var(--separator)' };

function SourceForm({ initial, onSubmit, onCancel }: {
  initial?: InfoSource;
  onSubmit: (draft: SourceDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<SourceDraft>({
    name: initial?.name ?? '',
    url: initial?.url ?? '',
    enabled: initial?.enabled ?? true,
  });
  const canSubmit = draft.name.trim().length > 0 && draft.url.trim().length > 0;

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel>类型</FieldLabel>
        {/* 首期固定 rss，其他 type disabled 敬请期待 */}
        <select disabled defaultValue="rss" className={inputCls} style={inputSty}>
          <option value="rss">RSS / Atom</option>
          {OTHER_TYPES.map((t) => (
            <option key={t.value} value={t.value} disabled>{t.label}（敬请期待）</option>
          ))}
        </select>
      </div>
      <div>
        <FieldLabel>订阅 URL</FieldLabel>
        <input type="url" value={draft.url} onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          placeholder="https://example.com/feed.xml" className={inputCls} style={inputSty} />
      </div>
      <div>
        <FieldLabel>名称</FieldLabel>
        <input type="text" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="Paul Graham Essays" className={inputCls} style={inputSty} />
      </div>
      <div className="flex items-center gap-3">
        <FieldLabel>启用</FieldLabel>
        <button type="button" role="switch" aria-checked={draft.enabled}
          onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
          className="relative h-5 w-9 rounded-full transition-colors duration-150"
          style={{ background: draft.enabled ? 'var(--accent)' : 'var(--separator)' }}>
          <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150"
            style={{ left: draft.enabled ? '1.125rem' : '0.125rem' }} />
        </button>
      </div>
      <div className="flex gap-2 pt-2">
        <PrimaryButton onClick={() => canSubmit && onSubmit(draft)} disabled={!canSubmit}>
          {initial ? '保存' : '创建'}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel}>取消</SecondaryButton>
      </div>
    </div>
  );
}

// ── Tab 主体 ──────────────────────────────────────────────────────────────────

export function DigestSourcesTab() {
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InfoSource | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<InfoSource | null>(null);

  const handleCreate = (draft: SourceDraft) => {
    banner.success(`信息源「${draft.name}」已新建`);
    setCreating(false);
  };

  const handleUpdate = (draft: SourceDraft) => {
    banner.success(`信息源「${draft.name}」已保存`);
    setEditing(null);
  };

  const handleDelete = () => {
    if (!confirmingDelete) return;
    banner.success(`信息源「${confirmingDelete.name}」已删除`);
    setConfirmingDelete(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-base font-semibold" style={{ color: 'var(--ink)' }}>
            信息源
          </h1>
          <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            全局共用 — 一个源可以被多个事项订阅，不重复抓取。首期实现 RSS / Atom，后续扩展。
          </p>
        </div>
        <PrimaryButton onClick={() => setCreating(true)}>
          + 新建信息源
        </PrimaryButton>
      </div>
      <Separator />

      {/* 列表 */}
      <section className="space-y-2">
        {MOCK_SOURCES.map((source) => (
          <SourceRow
            key={source.id}
            source={source}
            onEdit={() => setEditing(source)}
            onDelete={() => setConfirmingDelete(source)}
          />
        ))}
      </section>

      {/* 新建 Dialog */}
      <Dialog open={creating} onOpenChange={(v) => !v && setCreating(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建信息源</DialogTitle>
            <DialogDescription className="sr-only">
              添加一个全局共用的信息源，可被多个事项订阅
            </DialogDescription>
          </DialogHeader>
          <SourceForm
            onSubmit={handleCreate}
            onCancel={() => setCreating(false)}
          />
        </DialogContent>
      </Dialog>

      {/* 编辑 Dialog */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>编辑信息源</DialogTitle>
            <DialogDescription className="sr-only">
              修改信息源配置
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <SourceForm
              initial={editing}
              onSubmit={handleUpdate}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 删除确认 AlertDialog */}
      <AlertDialog
        open={!!confirmingDelete}
        onOpenChange={(v) => !v && setConfirmingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除信息源「{confirmingDelete?.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销。
              {confirmingDelete && confirmingDelete.subscriberCount > 0
                ? ` 当前有 ${confirmingDelete.subscriberCount} 个事项订阅了此源，删除后这些事项将抓不到此源的内容。`
                : ''}
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
