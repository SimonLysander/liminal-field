/*
 * MemoriesSection — Agent 记忆管理（user 记忆 + project 记忆）。
 *
 * 此前位于 OwnerTab(个人资料)下,2026-05-30 挪到 AgentTab ——
 * "Agent 对你的认知"是 agent 的事,不是身份/个人资料的事。
 */

import { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2, X, Check, Search } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import {
  listMemories,
  updateMemory,
  deleteMemory,
  type MemoryItem,
} from '@/services/agent';
import { Section, SectionSkeleton } from './SettingsUI';

/** 单条记忆：标题 + 内容预览 + hover 操作 */
function MemoryRow({
  memory,
  onUpdate,
  onDelete,
}: {
  memory: MemoryItem;
  onUpdate: (id: string, data: { type?: string; title?: string; content?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState({
    title: memory.title,
    content: memory.content,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      await onUpdate(memory._id, draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`确定删除记忆「${memory.title}」？`)) return;
    await onDelete(memory._id);
  };

  if (editing) {
    return (
      <div
        className="rounded-lg p-3"
        style={{ background: 'var(--shelf)', border: '1px solid var(--separator)' }}
      >
        <div className="space-y-2">
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            className="h-7 w-full rounded px-2 text-sm font-medium outline-none"
            style={{
              background: 'var(--paper-white)',
              color: 'var(--ink)',
              border: '1px solid var(--separator)',
            }}
          />
          <textarea
            value={draft.content}
            onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
            rows={3}
            className="w-full resize-none rounded px-2 py-1.5 text-sm outline-none"
            style={{
              background: 'var(--paper-white)',
              color: 'var(--ink)',
              border: '1px solid var(--separator)',
            }}
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => void handleSave()}
              disabled={saving || !draft.title.trim()}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-opacity disabled:opacity-40"
              style={{ color: 'var(--ink)', background: 'var(--paper)' }}
            >
              <Check size={12} /> 保存
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs transition-opacity disabled:opacity-40"
              style={{ color: 'var(--ink-faded)' }}
            >
              <X size={12} /> 取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group flex items-start gap-3 py-2.5"
      style={{ borderBottom: '0.5px solid var(--separator)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
          {memory.title}
        </div>
        <p
          className="mt-0.5 text-xs leading-relaxed"
          style={{ color: 'var(--ink-faded)' }}
        >
          {memory.content.length > 150
            ? memory.content.slice(0, 150) + '...'
            : memory.content}
        </p>
      </div>

      {/* 操作按钮（hover 显示） */}
      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => {
            setDraft({ title: memory.title, content: memory.content });
            setEditing(true);
          }}
          className="rounded p-1 transition-colors"
          style={{ color: 'var(--ink-ghost)' }}
          title="编辑"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={() => void handleDelete()}
          className="rounded p-1 transition-colors"
          style={{ color: 'var(--mark-red)' }}
          title="删除"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/** 按类型过滤的记忆分区 */
function MemoryGroup({
  title,
  description,
  memories,
  onUpdate,
  onDelete,
}: {
  title: string;
  description: string;
  memories: MemoryItem[];
  onUpdate: (id: string, data: { type?: string; title?: string; content?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <Section title={title} description={description}>
      {memories.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
          暂无记忆
        </p>
      ) : (
        <div>
          {memories.map((m) => (
            <MemoryRow
              key={m._id}
              memory={m}
              onUpdate={onUpdate}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

export function MemoriesSection() {
  const [loading, setLoading] = useState(true);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  // 搜索词:按 title + content 模糊过滤;两段记忆各自过滤后再渲染。
  // 规模小(目前 11 条)不需要分页,只做搜索 + 实时过滤就足够。
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await listMemories();
      setMemories(data);
    } catch {
      // API 不可用时静默降级
    } finally {
      setLoading(false);
    }
  }, []);

  // 挂载时加载记忆列表：load 内的 setState 在 async 回调里执行（非渲染期同步），属合法用法
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const handleUpdate = async (
    id: string,
    data: { type?: string; title?: string; content?: string },
  ) => {
    try {
      const updated = await updateMemory(id, data);
      setMemories((prev) => prev.map((m) => (m._id === id ? updated : m)));
      banner.success('已更新');
    } catch {
      banner.error('更新失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m._id !== id));
      banner.success('已删除');
    } catch {
      banner.error('删除失败');
    }
  };

  if (loading) {
    return (
      <>
        <SectionSkeleton title="关于我" />
        <SectionSkeleton title="项目记忆" />
      </>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = (m: MemoryItem) =>
    !q || m.title.toLowerCase().includes(q) || m.content.toLowerCase().includes(q);

  const userMemories = memories.filter((m) => m.type === 'user').filter(matches);
  const projectMemories = memories.filter((m) => m.type === 'project').filter(matches);

  return (
    <>
      {/* 搜索框:按 title + content 实时过滤两段记忆 */}
      <div className="relative">
        <Search
          size={14}
          strokeWidth={1.5}
          className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          style={{ color: 'var(--ink-ghost)' }}
        />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索记忆(标题或内容)..."
          className="h-9 w-full rounded-lg pl-9 pr-3 text-sm outline-none"
          style={{
            background: 'var(--paper-white)',
            color: 'var(--ink)',
            border: '1px solid var(--separator)',
          }}
        />
      </div>
      <MemoryGroup
        title="关于我"
        description={`Agent 对你的认知（${userMemories.length} 条${q ? ` · 搜索 "${query}"` : ''}）`}
        memories={userMemories}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
      <MemoryGroup
        title="项目记忆"
        description={`Agent 对你的项目和内容的认知（${projectMemories.length} 条${q ? ` · 搜索 "${query}"` : ''}）`}
        memories={projectMemories}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </>
  );
}
