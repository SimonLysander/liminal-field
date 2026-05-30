/*
 * MemoriesSection — Agent 记忆管理(user 记忆 + project 记忆)。
 *
 * 2026-05-31 按宪法重做:抛弃 Section 卡片,heading + divider 模板,
 * 每个 group 独立分页 10/页 + 搜索;ui/* 标准件。
 */

import { useState, useEffect, useCallback } from 'react';
import { Pencil, Trash2, X, Check, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  listMemories,
  updateMemory,
  deleteMemory,
  type MemoryItem,
} from '@/services/agent';

const PAGE_SIZE = 10;

/** 单条记忆:标题 + 内容预览 + hover 操作 */
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
    if (!confirm(`确定删除记忆「${memory.title}」?`)) return;
    await onDelete(memory._id);
  };

  if (editing) {
    return (
      <div
        className="space-y-2 rounded-sm p-3"
        style={{ background: 'var(--shelf)' }}
      >
        <input
          value={draft.title}
          onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
          className="flex h-7 w-full rounded-sm border border-transparent bg-[var(--paper-white)] px-2.5 text-md font-medium outline-none focus:bg-[var(--paper)]"
          style={{ color: 'var(--ink)' }}
        />
        <textarea
          value={draft.content}
          onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))}
          rows={3}
          className="flex w-full resize-none rounded-sm border border-transparent bg-[var(--paper-white)] px-2.5 py-1.5 text-md outline-none focus:bg-[var(--paper)]"
          style={{ color: 'var(--ink)' }}
        />
        <div className="flex items-center gap-1.5">
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSave()}
            disabled={saving || !draft.title.trim()}
          >
            <Check size={12} /> 保存
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            <X size={12} /> 取消
          </Button>
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
        <div className="text-md font-medium" style={{ color: 'var(--ink)' }}>
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

      {/* hover 显示操作 */}
      <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => {
            setDraft({ title: memory.title, content: memory.content });
            setEditing(true);
          }}
          className="rounded-sm p-1 transition-colors"
          style={{ color: 'var(--ink-ghost)' }}
          title="编辑"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={() => void handleDelete()}
          className="rounded-sm p-1 transition-colors"
          style={{ color: 'var(--danger)' }}
          title="删除"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

/** 分页控件:左下"第 N/M 页·共 X 条" + 右下 prev/next */
function Pagination({
  page,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between pt-2">
      <span className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
        第 {page}/{pages} 页 · 共 {total} 条
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={14} />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}

/** 一段记忆(分组):heading + 描述 + 列表 + 分页 */
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
  const [page, setPage] = useState(1);
  // memories 变化时(搜索过滤)重置到第一页
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 由外部 memories prop 变化驱动,非渲染期同步
    setPage(1);
  }, [memories.length]);

  const start = (page - 1) * PAGE_SIZE;
  const displayed = memories.slice(start, start + PAGE_SIZE);

  return (
    <section className="space-y-3">
      <div>
        <h2
          className="text-sm font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          {title}
        </h2>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {description}
        </p>
      </div>
      {memories.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          暂无记忆
        </p>
      ) : (
        <>
          <div>
            {displayed.map((m) => (
              <MemoryRow
                key={m._id}
                memory={m}
                onUpdate={onUpdate}
                onDelete={onDelete}
              />
            ))}
          </div>
          <Pagination
            page={page}
            total={memories.length}
            pageSize={PAGE_SIZE}
            onChange={setPage}
          />
        </>
      )}
    </section>
  );
}

export function MemoriesSection() {
  const [loading, setLoading] = useState(true);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
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
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
            认知
          </h2>
        </div>
        <div
          className="h-16 rounded-sm animate-pulse"
          style={{ background: 'var(--shelf)' }}
        />
      </section>
    );
  }

  const q = query.trim().toLowerCase();
  const matches = (m: MemoryItem) =>
    !q || m.title.toLowerCase().includes(q) || m.content.toLowerCase().includes(q);

  const userMemories = memories.filter((m) => m.type === 'user').filter(matches);
  const projectMemories = memories
    .filter((m) => m.type === 'project')
    .filter(matches);

  return (
    <div className="space-y-6">
      {/* heading + 搜索 */}
      <div className="space-y-3">
        <div>
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            认知
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            Agent 在对话中积累的关于你和你项目的认知
          </p>
        </div>
        <div className="relative">
          <Search
            size={14}
            strokeWidth={1.5}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--ink-ghost)' }}
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索记忆(标题或内容)..."
            className="flex h-7 w-full max-w-md rounded-sm border border-transparent bg-[var(--shelf)] pl-8 pr-2.5 text-md transition-colors placeholder:text-[var(--ink-ghost)] hover:bg-[var(--hover-overlay)] focus:bg-[var(--paper)] focus-visible:outline-none"
            style={{ color: 'var(--ink)' }}
          />
        </div>
      </div>

      <MemoryGroup
        title="关于我"
        description={`Agent 对你的认知 · ${userMemories.length} 条${q ? ` · 搜索 "${query}"` : ''}`}
        memories={userMemories}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />

      <Separator />

      <MemoryGroup
        title="项目记忆"
        description={`Agent 对你项目和内容的认知 · ${projectMemories.length} 条${q ? ` · 搜索 "${query}"` : ''}`}
        memories={projectMemories}
        onUpdate={handleUpdate}
        onDelete={handleDelete}
      />
    </div>
  );
}
