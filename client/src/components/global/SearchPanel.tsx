/**
 * SearchPanel — macOS Spotlight 风格全局搜索。
 *
 * 设计要点（对标 Spotlight）：
 * - 无边框输入：文字直接浮在毛玻璃面上，无 input 框线
 * - 紧凑列表：小图标 + 标题单行，item 高度 ~36px
 * - 轻量选中态：圆角 8px 微弱高亮
 * - 底部快捷键栏
 * - Portal 渲染 + 点击外部关闭
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Command as CommandPrimitive } from 'cmdk';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, FileText, Image, Search } from 'lucide-react';
import { searchApi, type SearchResult } from '@/services/search';

/**
 * 将文本中的关键词包裹在 <mark> 中，实现高亮。
 * split(/(keyword)/gi) 产生的数组中，奇数位是匹配的 capture group。
 */
function highlightKeyword(text: string, keyword: string): React.ReactNode {
  if (!keyword) return text;
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  if (parts.length === 1) return text;

  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-transparent font-semibold" style={{ color: 'var(--ink)' }}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

interface SearchPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  admin?: boolean;
}

const SCOPE_ICON: Record<string, React.ReactNode> = {
  notes: <FileText size={15} strokeWidth={1.4} />,
  gallery: <Image size={15} strokeWidth={1.4} />,
  anthology: <BookOpen size={15} strokeWidth={1.4} />,
};

const SCOPE_LABEL: Record<string, string> = {
  notes: '笔记',
  gallery: '相册',
  anthology: '文集',
};

/** 根据 scope 和上下文（管理端/展示端）生成跳转路径 */
function buildPath(scope: string, id: string, admin?: boolean): string {
  if (admin) {
    const adminPaths: Record<string, string> = {
      notes: `/admin/notes?doc=${id}`,
      gallery: `/admin/gallery?post=${id}`,
      anthology: `/admin/anthology?doc=${id}`,
    };
    return adminPaths[scope] ?? adminPaths.notes;
  }

  const publicPaths: Record<string, string> = {
    notes: `/note?doc=${id}`,
    gallery: `/gallery?post=${id}`,
    anthology: `/anthology?id=${id}`,
  };
  return publicPaths[scope] ?? publicPaths.notes;
}

interface SearchGroup {
  key: string;
  name: string;          // 直接父文件夹名，如 "计算机组成原理"
  breadcrumb?: string;   // 更上层路径，如 "计算机科学"
  scope: string;
  items: SearchResult[];
}

/**
 * 按直接父文件夹分组（而非 scope），让同一主题下的结果聚在一起。
 * 无 path 的根级文档回退到 scope 标签分组。
 * key 包含 scope 前缀，避免不同 scope 下同名文件夹合并。
 */
function groupByParent(results: SearchResult[]): SearchGroup[] {
  const map = new Map<string, SearchGroup>();

  for (const r of results) {
    let key: string;
    let name: string;
    let breadcrumb: string | undefined;

    if (r.path) {
      const parts = r.path.split(' / ');
      name = parts[parts.length - 1];
      key = `${r.scope}:${name}`;
      if (parts.length > 1) breadcrumb = parts.slice(0, -1).join(' / ');
    } else {
      key = `scope:${r.scope}`;
      name = SCOPE_LABEL[r.scope] ?? r.scope;
    }

    let group = map.get(key);
    if (!group) {
      group = { key, name, breadcrumb, scope: r.scope, items: [] };
      map.set(key, group);
    }
    group.items.push(r);
  }

  return [...map.values()];
}

export function SearchPanel({ open, onOpenChange, admin }: SearchPanelProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const latestReq = useRef(0);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const doSearch = useCallback(async (value: string) => {
    const q = value.trim();
    if (!q) {
      setResults([]);
      setLoading(false);
      return;
    }

    const reqId = ++latestReq.current;
    setLoading(true);
    try {
      const data = await searchApi.query(q, undefined, admin ? 'all' : undefined);
      if (reqId === latestReq.current) setResults(data);
    } catch {
      if (reqId === latestReq.current) setResults([]);
    } finally {
      if (reqId === latestReq.current) setLoading(false);
    }
  }, [admin]);

  /** 输入变化 → 立即更新显示文字，250ms 防抖后发请求 */
  const handleInput = useCallback(
    (value: string) => {
      setQuery(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => void doSearch(value), 250);
    },
    [doSearch],
  );

  /* 面板关闭时重置状态 */
  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setLoading(false);
    }
  }, [open]);

  /* 面板打开时聚焦输入框 */
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  function go(scope: string, contentId: string) {
    onOpenChange(false);
    navigate(buildPath(scope, contentId, admin));
  }

  const groups = groupByParent(results);
  const hasQ = query.trim().length > 0;
  const hasR = results.length > 0;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-[999]"
            style={{ background: 'rgba(0,0,0,0.12)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            onClick={() => onOpenChange(false)}
          />

          {/* Panel */}
          <motion.div
            className="fixed left-1/2 z-[1000]"
            style={{ top: '18vh', width: 'min(600px, 88vw)' }}
            initial={{ opacity: 0, scale: 0.96, x: '-50%' }}
            animate={{ opacity: 1, scale: 1, x: '-50%' }}
            exit={{ opacity: 0, scale: 0.96, x: '-50%' }}
            transition={{ duration: 0.12, ease: [0.32, 0, 0.15, 1] }}
          >
            <div
              style={{
                background: 'var(--omnibar-bg)',
                backdropFilter: 'blur(48px) saturate(200%)',
                WebkitBackdropFilter: 'blur(48px) saturate(200%)',
                borderRadius: 14,
                boxShadow: '0 24px 80px rgba(0,0,0,0.16), 0 0 0 0.5px var(--separator)',
              }}
            >
              <CommandPrimitive
                shouldFilter={false}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); onOpenChange(false); } }}
              >
                {/* ── Input row ── */}
                <div className="flex items-center gap-3 px-4" style={{ height: 52 }}>
                  <Search size={18} strokeWidth={2} className="flex-shrink-0" style={{ color: 'var(--ink-ghost)' }} />
                  <CommandPrimitive.Input
                    ref={inputRef}
                    value={query}
                    onValueChange={handleInput}
                    placeholder="搜索..."
                    className="h-full flex-1 bg-transparent text-base outline-none placeholder:text-[var(--ink-ghost)]"
                    style={{ color: 'var(--ink)', caretColor: 'var(--accent)', border: 'none', boxShadow: 'none' }}
                  />
                </div>

                {/* ── Results ── */}
                {hasQ && (
                  <>
                    <div style={{ height: 0.5, background: 'var(--separator)' }} />

                    <CommandPrimitive.List
                      className="overflow-y-auto overflow-x-hidden py-1.5"
                      style={{ maxHeight: 'min(380px, 48vh)' }}
                    >
                      {loading && !hasR && (
                        <p className="py-6 text-center text-xs" style={{ color: 'var(--ink-ghost)' }}>搜索中...</p>
                      )}
                      {!loading && !hasR && (
                        <p className="py-6 text-center text-xs" style={{ color: 'var(--ink-ghost)' }}>无匹配结果</p>
                      )}

                      {groups.map((group) => (
                        <CommandPrimitive.Group key={group.key}>
                          {/* 组标题：scope 图标 + 父文件夹名（ink-faded）+ 上层面包屑（ink-ghost） */}
                          <div className="flex items-center gap-2 px-4 pb-1 pt-2.5 text-xs font-medium tracking-wide">
                            <span className="flex-shrink-0" style={{ color: 'var(--ink-faded)' }}>
                              {SCOPE_ICON[group.scope] ?? SCOPE_ICON.notes}
                            </span>
                            <span style={{ color: 'var(--ink-faded)' }}>{group.name}</span>
                            {group.breadcrumb && (
                              <>
                                <span style={{ color: 'var(--ink-ghost)' }}>·</span>
                                <span style={{ color: 'var(--ink-ghost)' }}>{group.breadcrumb}</span>
                              </>
                            )}
                          </div>

                          {group.items.map((item) => (
                            <CommandPrimitive.Item
                              key={item.contentItemId}
                              value={`${item.title} ${item.snippet}`}
                              onSelect={() => go(item.scope, item.contentItemId)}
                              className="mx-1.5 flex cursor-default items-center rounded-lg px-2.5 py-1.5 pl-9 transition-colors duration-75 data-[selected=true]:bg-[var(--shelf)]"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="truncate text-sm" style={{ color: 'var(--ink)' }}>
                                  {highlightKeyword(item.title, query.trim())}
                                </span>
                                {item.snippet && (
                                  <div className="truncate text-xs mt-px" style={{ color: 'var(--ink-ghost)' }}>
                                    {highlightKeyword(item.snippet, query.trim())}
                                  </div>
                                )}
                              </div>
                            </CommandPrimitive.Item>
                          ))}
                        </CommandPrimitive.Group>
                      ))}
                    </CommandPrimitive.List>

                    {/* ── Footer ── */}
                    {hasR && (
                      <>
                        <div style={{ height: 0.5, background: 'var(--separator)' }} />
                        <div className="flex items-center justify-between px-4 text-[11px]" style={{ height: 32, color: 'var(--ink-ghost)' }}>
                          <span className="flex items-center gap-1.5">
                            <kbd className="inline-flex h-[18px] items-center rounded px-1" style={{ background: 'var(--shelf)' }}>↑↓</kbd>
                            <span>导航</span>
                            <span className="mx-1 opacity-40">·</span>
                            <kbd className="inline-flex h-[18px] items-center rounded px-1" style={{ background: 'var(--shelf)' }}>↵</kbd>
                            <span>打开</span>
                          </span>
                          <span>{results.length} 个结果</span>
                        </div>
                      </>
                    )}
                  </>
                )}
              </CommandPrimitive>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
