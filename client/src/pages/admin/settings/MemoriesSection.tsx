/*
 * MemoriesSection — Agent 岁月史书(2026-05-30 改 readonly observations 时间序列)。
 *
 * 架构翻转(#150 续):
 * - 旧:user 记忆是 key-value(title 唯一,可编辑/删除)
 * - 新:observations 是 append-only event log,前端只读、按 observedAt 倒序、可按 topic 筛选
 * - 主 agent 不再有 remember/forget 工具——塑形由后台 MemoryObserverService 自动跑
 *
 * UI 设计:
 * 1. 顶部:当前画像 markdown(observer 派生,简明摘要)
 * 2. 中部:topic chip 筛选 + 搜索框(关键词模糊匹配 observation/context)
 * 3. 下部:observations 时间序列(by observedAt 倒序)+ 分页 5/页
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  listObservations,
  type ObservationItem,
  type ObservationsResponse,
  type ObservationTopic,
} from '@/services/agent';

const PAGE_SIZE = 5;

const TOPIC_LABEL: Record<ObservationTopic, string> = {
  identity: '身份',
  personality: '性格',
  aesthetic: '审美',
  method: '方法',
  other: '其他',
};

const TOPIC_ORDER: ObservationTopic[] = [
  'identity',
  'personality',
  'aesthetic',
  'method',
  'other',
];

function formatDate(iso: string): string {
  // YYYY-MM-DD
  return iso.slice(0, 10);
}

/** 单条 observation 行(只读) */
function ObservationRow({ item }: { item: ObservationItem }) {
  return (
    <div
      className="flex items-start gap-3 py-2.5"
      style={{ borderBottom: '0.5px solid var(--separator)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-xs">
          <span style={{ color: 'var(--ink-ghost)' }}>
            {formatDate(item.observedAt)}
          </span>
          <span
            className="rounded-sm px-1.5 py-0.5"
            style={{
              background: 'var(--shelf)',
              color: 'var(--ink-faded)',
              fontSize: '11px',
            }}
          >
            {TOPIC_LABEL[item.topic]}
          </span>
        </div>
        <p
          className="mt-1 text-md leading-relaxed"
          style={{ color: 'var(--ink)' }}
        >
          {item.observation}
        </p>
        {item.context && (
          <p
            className="mt-0.5 text-xs italic"
            style={{ color: 'var(--ink-ghost)' }}
          >
            ⟨{item.context}⟩
          </p>
        )}
      </div>
    </div>
  );
}

/** 分页控件 */
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

export function MemoriesSection() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ObservationsResponse | null>(null);
  const [query, setQuery] = useState('');
  const [topicFilter, setTopicFilter] = useState<ObservationTopic | 'all'>(
    'all',
  );
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    try {
      const resp = await listObservations();
      setData(resp);
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

  // 筛选 + 搜索 + 倒序
  const filtered = useMemo<ObservationItem[]>(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.observations.filter((o) => {
      if (topicFilter !== 'all' && o.topic !== topicFilter) return false;
      if (q) {
        const hay = `${o.observation} ${o.context ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, query, topicFilter]);

  // 筛选/搜索变化时重置到第 1 页
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [query, topicFilter]);

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

  const start = (page - 1) * PAGE_SIZE;
  const displayed = filtered.slice(start, start + PAGE_SIZE);
  const totalObservations = data?.observations.length ?? 0;
  const currentViewMarkdown = data?.currentView?.markdown;

  return (
    <div className="space-y-4">
      {/* heading */}
      <div>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>
          认知
        </h2>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          Aurora 在对话中持续观察沉淀的认知(岁月史书,append-only) · 共 {totalObservations} 条观察
          {currentViewMarkdown ? ' · 含派生画像' : ''}
        </p>
      </div>

      {/* 当前画像 */}
      {currentViewMarkdown && (
        <div
          className="rounded-sm p-3"
          style={{
            background: 'var(--shelf)',
            border: '0.5px solid var(--separator)',
          }}
        >
          <div
            className="mb-1 text-xs font-medium"
            style={{ color: 'var(--ink-faded)' }}
          >
            当前画像(观察者派生)
          </div>
          <pre
            className="whitespace-pre-wrap font-sans text-md leading-relaxed"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-reading)' }}
          >
            {currentViewMarkdown}
          </pre>
        </div>
      )}

      {/* topic 筛选 + 搜索 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setTopicFilter('all')}
          className="rounded-sm px-2 py-0.5 text-xs transition-colors"
          style={{
            background:
              topicFilter === 'all'
                ? 'var(--accent-soft)'
                : 'var(--shelf)',
            color: topicFilter === 'all' ? 'var(--accent)' : 'var(--ink-faded)',
          }}
        >
          全部
        </button>
        {TOPIC_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTopicFilter(t)}
            className="rounded-sm px-2 py-0.5 text-xs transition-colors"
            style={{
              background:
                topicFilter === t ? 'var(--accent-soft)' : 'var(--shelf)',
              color: topicFilter === t ? 'var(--accent)' : 'var(--ink-faded)',
            }}
          >
            {TOPIC_LABEL[t]}
          </button>
        ))}
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
          placeholder="搜索观察(关键词模糊匹配)..."
          className="flex h-7 w-full max-w-md rounded-sm border border-transparent bg-[var(--shelf)] pl-8 pr-2.5 text-md transition-colors placeholder:text-[var(--ink-ghost)] hover:bg-[var(--hover-overlay)] focus:bg-[var(--paper)] focus-visible:outline-none"
          style={{ color: 'var(--ink)' }}
        />
      </div>

      {/* observations 时间序列 */}
      {filtered.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {data?.observations.length === 0
            ? 'Aurora 还没观察到任何东西(开始对话她就会慢慢沉淀)'
            : '当前筛选下无匹配'}
        </p>
      ) : (
        <>
          <div>
            {displayed.map((o) => (
              <ObservationRow key={o._id} item={o} />
            ))}
          </div>
          <Pagination
            page={page}
            total={filtered.length}
            pageSize={PAGE_SIZE}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
