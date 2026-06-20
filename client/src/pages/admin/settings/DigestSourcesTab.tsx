/**
 * DigestSourcesTab — 信息源管理，作为 Settings sub-tab 内嵌使用。
 * 从 pages/admin/sources/index.tsx 迁移而来，去掉外层 admin 页面布局壳和「← 返回」面包屑，
 * 对齐 SkillsTab 的结构：顶层 <div className="space-y-6">，header 用 text-base font-semibold。
 * 全局共用：一个源可被多事项订阅，不重复抓取。首期只支持 RSS / Atom。
 *
 * 数据契约: client/src/services/info-sources.ts
 */

import { useCallback, useEffect, useState } from 'react';
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
import { infoSourcesApi } from '@/services/info-sources';
import type { InfoSource } from '@/services/info-sources';

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

function getUrl(source: InfoSource): string {
  const url = source.config['url'];
  return typeof url === 'string' ? url : '';
}

// ── 子组件：单行信息源 ─────────────────────────────────────────────────────────

function SourceRow({
  source,
  onEdit,
  onDelete,
  onToggleEnabled,
}: {
  source: InfoSource;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: () => void;
}) {
  const url = getUrl(source);
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
            title={url}
          >
            {url}
          </span>
        </div>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {source.lastFetchedAt
            ? `上次抓取 ${formatRelativeTime(source.lastFetchedAt)}`
            : '尚未抓取'}
          {source.lastFetchStatus === 'failed' && source.lastFetchError
            ? ` · 上次失败: ${source.lastFetchError}`
            : ''}
        </p>
      </div>

      {/* enabled 状态切换 */}
      <button
        type="button"
        onClick={onToggleEnabled}
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

const inputCls = 'mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none';
const inputSty = { background: 'var(--paper-white)', color: 'var(--ink)', border: '1px solid var(--separator)' };

function SourceForm({ initial, onSubmit, onCancel, saving }: {
  initial?: InfoSource;
  onSubmit: (draft: SourceDraft) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<SourceDraft>({
    name: initial?.name ?? '',
    url: initial ? getUrl(initial) : '',
    enabled: initial?.enabled ?? true,
  });
  const canSubmit = draft.name.trim().length > 0 && draft.url.trim().length > 0 && !saving;

  return (
    <div className="space-y-4">
      <div>
        <FieldLabel>类型</FieldLabel>
        <select disabled defaultValue="rss" className={inputCls} style={inputSty}>
          <option value="rss">RSS / Atom</option>
          {OTHER_TYPES.map((t) => (
            <option key={t.value} value={t.value} disabled>{t.label}（敬请期待）</option>
          ))}
        </select>
      </div>
      <div>
        <FieldLabel>订阅 URL</FieldLabel>
        <input
          type="url"
          value={draft.url}
          onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))}
          placeholder="https://example.com/feed.xml"
          className={inputCls}
          style={inputSty}
          disabled={saving}
        />
      </div>
      <div>
        <FieldLabel>名称</FieldLabel>
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="Paul Graham Essays"
          className={inputCls}
          style={inputSty}
          disabled={saving}
        />
      </div>
      <div className="flex items-center gap-3">
        <FieldLabel>启用</FieldLabel>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
          disabled={saving}
          className="relative h-5 w-9 rounded-full transition-colors duration-150 disabled:opacity-50"
          style={{ background: draft.enabled ? 'var(--accent)' : 'var(--separator)' }}
        >
          <span
            className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-150"
            style={{ left: draft.enabled ? '1.125rem' : '0.125rem' }}
          />
        </button>
      </div>
      <div className="flex gap-2 pt-2">
        <PrimaryButton onClick={() => canSubmit && onSubmit(draft)} disabled={!canSubmit}>
          {saving ? '保存中...' : initial ? '保存' : '创建'}
        </PrimaryButton>
        <SecondaryButton onClick={onCancel} disabled={saving}>取消</SecondaryButton>
      </div>
    </div>
  );
}

// ── Tab 主体 ──────────────────────────────────────────────────────────────────

export function DigestSourcesTab() {
  const [sources, setSources] = useState<InfoSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<InfoSource | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<InfoSource | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await infoSourcesApi.list();
      setSources(data);
    } catch {
      banner.error('加载信息源列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void loadData();
  }, [loadData]);

  const handleCreate = async (draft: SourceDraft) => {
    setSaving(true);
    try {
      await infoSourcesApi.create({ type: 'rss', name: draft.name, config: { url: draft.url }, enabled: draft.enabled });
      banner.success(`信息源「${draft.name}」已新建`);
      setCreating(false);
      await loadData(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建失败';
      banner.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (draft: SourceDraft) => {
    if (!editing) return;
    setSaving(true);
    try {
      await infoSourcesApi.update(editing.id, { name: draft.name, config: { url: draft.url }, enabled: draft.enabled });
      banner.success(`信息源「${draft.name}」已保存`);
      setEditing(null);
      await loadData(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败';
      banner.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (source: InfoSource) => {
    try {
      await infoSourcesApi.update(source.id, { enabled: !source.enabled });
      await loadData(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '操作失败';
      banner.error(msg);
    }
  };

  const handleDelete = async () => {
    if (!confirmingDelete) return;
    setDeleting(true);
    try {
      await infoSourcesApi.delete(confirmingDelete.id);
      banner.success(`信息源「${confirmingDelete.name}」已删除`);
      setConfirmingDelete(null);
      await loadData(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '删除失败';
      banner.error(msg);
    } finally {
      setDeleting(false);
    }
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
        {loading ? (
          <>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-lg"
                style={{ background: 'var(--shelf)' }}
              />
            ))}
          </>
        ) : sources.length > 0 ? (
          sources.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              onEdit={() => setEditing(source)}
              onDelete={() => setConfirmingDelete(source)}
              onToggleEnabled={() => void handleToggleEnabled(source)}
            />
          ))
        ) : (
          <div
            className="rounded-lg px-3 py-6 text-center text-xs"
            style={{ color: 'var(--ink-ghost)', border: '1px dashed var(--separator)' }}
          >
            暂无信息源。点右上「新建信息源」开始。
          </div>
        )}
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
            onSubmit={(draft) => void handleCreate(draft)}
            onCancel={() => setCreating(false)}
            saving={saving}
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
              onSubmit={(draft) => void handleUpdate(draft)}
              onCancel={() => setEditing(null)}
              saving={saving}
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
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction asChild>
              <DangerButton onClick={() => void handleDelete()} disabled={deleting}>
                {deleting ? '删除中...' : '删除'}
              </DangerButton>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
