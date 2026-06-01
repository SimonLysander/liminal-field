/*
 * AnthologyDetailPanel — 中区。两种视图按 URL ?entry= 切换:
 *   无 entry:文集概览(元信息 + 简介 + 章节列表)
 *   有 entry:章节预览(面包屑 + 标题 + 元信息 + 正文 readonly + [编辑])
 *
 * 章节列表行不响应点击,操作走显式按钮(预览/编辑/⋯)。
 * 状态徽章统一抄 VersionTimeline 的设计语言(rounded + 浅底 + mark-color 字)。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MoreHorizontal, FileEdit } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { LoadingState } from '@/components/LoadingState';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { workspaceApi, type ContentHistoryEntry } from '@/services/workspace';
import { structureApi, type StructureNode } from '@/services/structure';
import { request } from '@/services/request';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { VersionTimeline } from '@/pages/admin/components/VersionTimeline';
import { NodeFormModal } from '../../components/NodeFormModal';
import type { ModalState, NodeSubmitPayload } from '../../types';
import { parseError } from '../../helpers';
import { type AnthologyRow, StatusBadge } from '../index';

/** 后端 toAdminEntryRef 返回 */
interface AdminEntry {
  nodeId: string;
  title: string;
  date: string | null;
  hasContent: boolean;
  publishedVersionId: string | null;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

interface AnthologyAdminDetail {
  id: string;
  title: string;
  description: string;
  bodyMarkdown: string;
  status: 'committed' | 'published';
  hasUnpublishedChanges: boolean;
  entries: AdminEntry[];
}

interface EntryDetail {
  nodeId: string;
  title: string;
  date: string | null;
  updatedAt: string;
  bodyMarkdown: string;
}

interface Props {
  row: AnthologyRow;
  onReload: () => void | Promise<void>;
  onDelete: () => void;
}

export function AnthologyDetailPanel({ row, onReload, onDelete }: Props) {
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  /* URL key 跟 index.tsx 同步:?at=文集 / ?at=&chapter=条目 */
  const selectedEntryId = searchParams.get('chapter') ?? null;

  const [detail, setDetail] = useState<AnthologyAdminDetail | null>(null);
  const [childrenNavs, setChildrenNavs] = useState<StructureNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<ModalState>({ open: false, mode: 'create' });

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [d, children] = await Promise.all([
        workspaceApi.getById('anthology', row.contentItemId, {
          visibility: 'all',
        }) as unknown as Promise<AnthologyAdminDetail>,
        structureApi.getChildren(row.navId, { scope: 'anthology', visibility: 'all' }),
      ]);
      setDetail(d);
      setChildrenNavs(children.children);
    } catch (err) {
      setError(parseError(err, '加载文集详情失败'));
    } finally {
      setLoading(false);
    }
  }, [row.contentItemId, row.navId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadDetail();
  }, [loadDetail]);

  const navIdByContent = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of childrenNavs) if (n.contentItemId) m.set(n.contentItemId, n.id);
    return m;
  }, [childrenNavs]);

  const selectEntry = (entryId: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (entryId) next.set('chapter', entryId);
    else next.delete('chapter');
    setSearchParams(next, { replace: true });
  };

  const handlePublish = async () => {
    try {
      await request(`/spaces/anthology/items/${row.contentItemId}/publish`, { method: 'PUT' });
      banner.success('已发布');
      await Promise.all([loadDetail(), onReload()]);
    } catch (err) {
      banner.error(parseError(err, '发布失败'));
    }
  };

  const handleUnpublish = async () => {
    try {
      await request(`/spaces/anthology/items/${row.contentItemId}/unpublish`, { method: 'PUT' });
      banner.success('已取消发布');
      await Promise.all([loadDetail(), onReload()]);
    } catch (err) {
      banner.error(parseError(err, '取消发布失败'));
    }
  };

  const handlePublishAll = async () => {
    try {
      await request(`/spaces/anthology/items/${row.contentItemId}/publish-all`, { method: 'POST' });
      banner.success('已发布全部');
      await Promise.all([loadDetail(), onReload()]);
    } catch (err) {
      banner.error(parseError(err, '发布失败'));
    }
  };

  const handleCreateEntry = async (payload: NodeSubmitPayload) => {
    const dto = payload.node as { name: string };
    try {
      const created = await structureApi.createNode({
        name: dto.name,
        type: 'DOC',
        scope: 'anthology',
        parentId: row.navId,
      });
      await loadDetail();
      void onReload();
      if (created.contentItemId) {
        /* 条目编辑带 ?at=文集id 让 edit.tsx 算出"返回 = 条目选中态" */
        window.location.href = `/admin/anthology/${created.contentItemId}/edit?at=${row.contentItemId}`;
      }
    } catch (err) {
      banner.error(parseError(err, '新增章节失败'));
    }
  };

  const handleDeleteEntry = async (entry: AdminEntry) => {
    const navId = navIdByContent.get(entry.nodeId);
    if (!navId) {
      banner.error('找不到该章节的导航节点');
      return;
    }
    const ok = await confirm({
      title: '删除章节',
      message: `将删除「${entry.title}」`,
      danger: true,
      confirmLabel: '删除',
    });
    if (!ok) return;
    try {
      await structureApi.deleteNode(navId);
      banner.success('已删除');
      if (selectedEntryId === entry.nodeId) selectEntry(null);
      await Promise.all([loadDetail(), onReload()]);
    } catch (err) {
      banner.error(parseError(err, '删除失败'));
    }
  };

  /* loading/error 必须撑满父并居中——父是横向 flex 容器,默认 flex item 宽是内容自然宽,
   * 直接 return <LoadingState/> 会左对齐 + 切换时位置闪一下。 */
  if (loading) return (
    <div className="flex h-full w-full items-center justify-center">
      <LoadingState variant="inline" />
    </div>
  );
  if (error)
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
      </div>
    );
  if (!detail) return null;

  // 视图分流:章节预览 vs 文集概览
  const selectedEntry = selectedEntryId
    ? detail.entries.find((e) => e.nodeId === selectedEntryId) ?? null
    : null;

  /* Layout 横向三段:
   *   左主体(中区内容,竖向滚动) | 右版本栏(只在选中章节时出现,与笔记/画廊心智一致)
   * 文集概览态没有右栏(后端未暴露文集级 history,且 OverviewView 没有"被预览的某版本"概念) */
  return (
    <div className="flex h-full w-full min-w-0 overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-10 py-8">
        {selectedEntry ? (
          <EntryPreviewView
            entry={selectedEntry}
            onEdit={() => {
              window.location.href = `/admin/anthology/${selectedEntry.nodeId}/edit?at=${row.contentItemId}`;
            }}
            onDelete={() => void handleDeleteEntry(selectedEntry)}
          />
        ) : (
          <AnthologyOverviewView
            row={row}
            detail={detail}
            onEditPreface={() => {
              window.location.href = `/admin/anthology/${row.contentItemId}/edit`;
            }}
            onPublish={handlePublish}
            onUnpublish={handleUnpublish}
            onPublishAll={handlePublishAll}
            onDelete={onDelete}
            onReload={() => void loadDetail()}
          />
        )}
        </div>
      </div>

      {/* 右栏 — 宽度 261px / 无 border-l,对齐 /admin/notes 右栏(设计语言"无栏线") */}
      {selectedEntry && (
        <aside
          className="flex shrink-0 flex-col"
          style={{ width: '261px' }}
        >
          <EntryVersionsRail
            anthologyContentItemId={row.contentItemId}
            entryNodeId={selectedEntry.nodeId}
            publishedVersionId={selectedEntry.publishedVersionId}
          />
        </aside>
      )}

      {modal.open && (
        <NodeFormModal
          modal={modal}
          onClose={() => setModal({ open: false, mode: 'create' })}
          onSubmit={handleCreateEntry}
          scope="anthology"
        />
      )}
    </div>
  );
}

/** 章节右栏 — 严格抄笔记 ContentAdmin > FormalSidePanel 三段(大纲/编辑/版本)的视觉与结构。
 *  数据各自简化拉取:大纲暂留空(后续解析章节正文标题再补);编辑段拉 anthology draft;版本段已成熟。
 *  心智与笔记完全一致——uppercase caption、字号、间距、InfoRow/SideLink helpers 全部照抄。 */
function EntryVersionsRail({
  anthologyContentItemId, entryNodeId, publishedVersionId,
}: {
  anthologyContentItemId: string;
  entryNodeId: string;
  publishedVersionId: string | null;
}) {
  const [history, setHistory] = useState<ContentHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [draftExists, setDraftExists] = useState(false);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);

  /* 版本历史 */
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHistoryLoading(true);
    setHistoryError('');
    void (async () => {
      try {
        const data = await request<ContentHistoryEntry[]>(
          `/spaces/anthology/items/${anthologyContentItemId}/entries/${entryNodeId}/history`,
        );
        if (!cancelled) setHistory(data);
      } catch (err) {
        if (!cancelled) setHistoryError(parseError(err, '加载版本历史失败'));
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [anthologyContentItemId, entryNodeId]);

  /* 草稿状态(getNodeDraft 后端 200 返回 null = 无草稿) */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const draft = await workspaceApi.getNodeDraft('anthology', entryNodeId);
        if (cancelled) return;
        setDraftExists(!!draft);
        setDraftSavedAt(draft?.savedAt ?? null);
      } catch {
        if (!cancelled) {
          setDraftExists(false);
          setDraftSavedAt(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [entryNodeId]);

  const goToEditor = () => {
    /* 带 ?at=文集id 让编辑器返回时定位到条目选中态 */
    window.location.href = `/admin/anthology/${entryNodeId}/edit?at=${anthologyContentItemId}`;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden px-5 py-7">
      {/* 大纲 — flex-1,内部滚动;暂占位"暂无标题"(后续接章节正文 toc 解析) */}
      <div className="mb-5 flex min-h-0 flex-1 flex-col">
        <SectionCaption>大纲</SectionCaption>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>暂无标题</p>
        </div>
      </div>

      {/* 编辑 — shrink-0,固定高度,显示草稿状态 + 入口链接 */}
      <div className="mb-5 shrink-0">
        <SectionCaption>编辑</SectionCaption>
        {draftExists ? (
          <div className="space-y-2">
            <InfoRow label="已有草稿" value="是" />
            <InfoRow
              label="上次保存"
              value={draftSavedAt ? new Date(draftSavedAt).toLocaleString('zh-CN') : '--'}
            />
            <div className="flex gap-4 pt-2">
              <SideLink label="继续编辑 →" primary onClick={goToEditor} />
            </div>
          </div>
        ) : (
          <>
            <p className="mb-3.5 text-xs leading-relaxed" style={{ color: 'var(--ink-ghost)' }}>
              进入编辑器创建草稿
            </p>
            <SideLink label="开始编辑 →" primary onClick={goToEditor} />
          </>
        )}
      </div>

      {/* 版本 — flex-1,内部滚动 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <SectionCaption>版本</SectionCaption>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {historyLoading ? (
            <LoadingState variant="inline" />
          ) : historyError ? (
            <p className="text-xs" style={{ color: 'var(--danger)' }}>{historyError}</p>
          ) : history.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>暂无版本</p>
          ) : (
            <VersionTimeline
              history={history}
              publishedVersionId={publishedVersionId}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── helpers 抄自 content/index.tsx ────────────────────────────────── */

function SectionCaption({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="mb-2.5 shrink-0 text-2xs font-semibold uppercase"
      style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
    >
      {children}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs" style={{ color: 'var(--ink-faded)' }}>{label}</span>
      <span className="text-xs font-medium" style={{ color: 'var(--ink)' }}>{value}</span>
    </div>
  );
}

/** 顶部操作行的文本链接(对齐笔记 ContentVersionView 的 TextLink):
 *  灰字 + hover 变深,无 bg、无 border。用于"刷新"、"返回最新"等次要操作 */
function TextLink({
  label, onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="nav-item text-xs transition-colors duration-150"
      style={{
        color: 'var(--ink-faded)',
        background: 'none', border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', padding: '4px 0',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ink)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-faded)'; }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function SideLink({
  label, primary, onClick,
}: {
  label: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="text-xs transition-colors duration-150"
      style={{
        color: primary ? 'var(--ink)' : 'var(--ink-faded)',
        fontWeight: primary ? 600 : 400,
        background: 'none', border: 'none', cursor: 'pointer',
        fontFamily: 'inherit', padding: '4px 0',
      }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/* ── 视图 1:文集概览 ────────────────────────────────────────── */

function AnthologyOverviewView({
  row, detail,
  onEditPreface, onPublish, onUnpublish, onPublishAll, onDelete, onReload,
}: {
  row: AnthologyRow;
  detail: AnthologyAdminDetail;
  onEditPreface: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onPublishAll: () => void;
  onDelete: () => void;
  onReload: () => void;
}) {
  const updateYmd = new Date(row.updatedAt).toLocaleDateString('zh-CN', {
    month: 'numeric', day: 'numeric',
  });

  /* 文集自身的 history 后端未暴露(只有章节级 /entries/:nodeId/history),
   * 这里暂不挂版本按钮——避免点击 404。后端补 endpoint 后再开。 */
  return (
    <>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-medium" style={{ color: 'var(--ink)' }}>
            {detail.title || '无标题'}
          </h1>
          <p className="mt-2 flex items-center gap-2 text-xs" style={{ color: 'var(--ink-faded)' }}>
            <span>{row.entryCount} 篇</span>
            <span>·</span>
            <StatusBadge status={detail.status} hasUnpublishedChanges={detail.hasUnpublishedChanges} />
            <span>·</span>
            <span>{updateYmd} 更新</span>
          </p>
        </div>
        {/* 操作组(对齐笔记 ContentVersionView header):刷新文本链接 + ⋯ 菜单 */}
        <div className="flex shrink-0 items-center gap-4 pt-1">
          <TextLink label="刷新" onClick={onReload} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button"
                className="nav-item rounded-md p-1.5 transition-colors hover:text-[var(--ink)]"
                style={{ color: 'var(--ink-faded)' }} aria-label="文集操作">
                <MoreHorizontal size={18} strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEditPreface}>
                <FileEdit size={14} strokeWidth={1.5} className="mr-2" />
                编辑卷首语
              </DropdownMenuItem>
              {detail.status === 'published'
                ? <DropdownMenuItem onClick={onUnpublish}>取消发布</DropdownMenuItem>
                : <DropdownMenuItem onClick={onPublish}>发布文集</DropdownMenuItem>}
              {detail.status === 'published' && (
                <DropdownMenuItem onClick={onPublishAll}>一键发布全部</DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onDelete} style={{ color: 'var(--danger)' }}>
                删除文集
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 简介 / 卷首语正文预览。中区不放章节列表——章节已挪到左栏钻入层。 */}
      <div className="pt-2">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-faded)' }}>
          {detail.description || '暂无简介'}
        </p>
        {detail.bodyMarkdown.trim() && (
          <div className="mt-6">
            <MarkdownBody markdown={detail.bodyMarkdown} contentItemId={row.contentItemId} />
          </div>
        )}
      </div>
    </>
  );
}

/* ── 视图 2:章节预览 ────────────────────────────────────────── */

function EntryPreviewView({
  entry, onEdit, onDelete,
}: {
  entry: AdminEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // 章节正文:再 fetch 一次,因为 toAdminEntryRef 不带正文
  const [body, setBody] = useState<EntryDetail | null>(null);
  const [bodyLoading, setBodyLoading] = useState(true);
  const [bodyError, setBodyError] = useState('');

  /* fetchBody 抽出来:useEffect 首次拉 + 顶部「刷新」按钮再拉 */
  const fetchBody = useCallback(async () => {
    setBodyLoading(true);
    setBodyError('');
    try {
      const d = (await workspaceApi.getById('anthology', entry.nodeId, {
        visibility: 'all',
      })) as unknown as EntryDetail;
      setBody(d);
    } catch (err) {
      setBodyError(parseError(err, '加载章节正文失败'));
    } finally {
      setBodyLoading(false);
    }
  }, [entry.nodeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBody();
  }, [fetchBody]);

  const isPublished = !!entry.publishedVersionId;
  // commitHash 字段笔记中区有(来自 Snapshot),这里用 publishedVersionId 兜底,
  // 没发布过则用 nodeId 前 8 位让 pill 仍有形态(语义=该节点 id 的速写,跟笔记 pill 视觉一致)。
  const pillHash = entry.publishedVersionId ?? entry.nodeId;

  /* 视觉严格抄笔记 ContentVersionView header:
   *  - 大标题 text-5xl serif bold(用 var(--font-reading) 阅读体)
   *  - 状态徽章(VersionStatusPill 风格) + 时间
   *  - 右操作组: 编辑 + ⋯ 菜单
   *  - 不放面包屑(左栏两段栈已表达层级,跟笔记心智一致——左侧结构面板管层级) */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2
            className="text-5xl font-bold"
            style={{ color: 'var(--ink)', fontFamily: 'var(--font-reading)', letterSpacing: '-0.025em' }}
          >
            {entry.title || '(空章节)'}
          </h2>
          <div className="mt-2 flex items-center gap-2.5">
            <VersionStatusPill isPublished={isPublished} commitHash={pillHash} />
            <span className="text-2xs" style={{ color: 'var(--ink-ghost)' }}>
              {entry.updatedAt ? new Date(entry.updatedAt).toLocaleString('zh-CN') : '--'}
            </span>
          </div>
          {/* 中区不再放返回入口——想看文集本身,点左栏顶部的文集名(那是用户认知里的"回卷")。
            *  原 ChevronLeft + 《文集名》面包屑已删。 */}
        </div>
        <div className="flex shrink-0 items-center gap-4 pt-1">
          <TextLink label="刷新" onClick={() => void fetchBody()} />
          <TextLink label="编辑" onClick={onEdit} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-6 w-6 items-center justify-center rounded-md transition-opacity hover:opacity-70 focus:outline-none data-[state=open]:opacity-100"
                style={{ color: 'var(--ink-ghost)' }}
                aria-label="章节操作"
              >
                <MoreHorizontal size={14} strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[120px]">
              <DropdownMenuItem onClick={onDelete} style={{ color: 'var(--danger)' }}>
                删除章节
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 正文 — 不带 border-t 分割(设计语言:无栏线),直接续在 header 后 */}
      <div className="pt-2">
        {bodyLoading ? (
          <LoadingState variant="inline" />
        ) : bodyError ? (
          <p className="text-sm" style={{ color: 'var(--danger)' }}>{bodyError}</p>
        ) : body && body.bodyMarkdown.trim() ? (
          <MarkdownBody markdown={body.bodyMarkdown} contentItemId={entry.nodeId} />
        ) : (
          <p className="py-8 text-center text-xs" style={{ color: 'var(--ink-ghost)' }}>
            (空章节,点右上「编辑」开始写)
          </p>
        )}
      </div>
    </div>
  );
}

/** 抄笔记 ContentVersionView 的 VersionStatusPill,视觉/字号/圆角完全一致 */
function VersionStatusPill({ isPublished, commitHash }: { isPublished: boolean; commitHash: string }) {
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-full px-2.5 py-[3px] text-2xs font-medium"
      style={{
        background: isPublished ? 'var(--success-soft)' : 'var(--accent-soft)',
        color: isPublished ? 'var(--mark-green)' : 'var(--ink-faded)',
      }}
    >
      <span className="h-[5px] w-[5px] rounded-full" style={{ background: 'currentColor' }} />
      {isPublished ? '已发布' : '已提交'}
      <span style={{ fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
        {commitHash.slice(0, 8)}
      </span>
    </span>
  );
}
