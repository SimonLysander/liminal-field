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
import { ChevronLeft, MoreHorizontal, Plus, FileEdit } from 'lucide-react';
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
  const selectedEntryId = searchParams.get('entry') ?? null;

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
    if (entryId) next.set('entry', entryId);
    else next.delete('entry');
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
        window.location.href = `/admin/anthology/${created.contentItemId}/edit`;
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

  if (loading) return <LoadingState variant="inline" />;
  if (error)
    return (
      <div className="p-8">
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
            anthologyTitle={detail.title}
            entry={selectedEntry}
            onBack={() => selectEntry(null)}
            onEdit={() => {
              window.location.href = `/admin/anthology/${selectedEntry.nodeId}/edit`;
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
            onCreateEntry={() => setModal({ open: true, mode: 'create' })}
            onPreviewEntry={(id) => selectEntry(id)}
            onEditEntry={(id) => {
              window.location.href = `/admin/anthology/${id}/edit`;
            }}
            onDeleteEntry={(entry) => void handleDeleteEntry(entry)}
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
    window.location.href = `/admin/anthology/${entryNodeId}/edit`;
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
  onEditPreface, onPublish, onUnpublish, onPublishAll, onDelete,
  onCreateEntry, onPreviewEntry, onEditEntry, onDeleteEntry,
}: {
  row: AnthologyRow;
  detail: AnthologyAdminDetail;
  onEditPreface: () => void;
  onPublish: () => void;
  onUnpublish: () => void;
  onPublishAll: () => void;
  onDelete: () => void;
  onCreateEntry: () => void;
  onPreviewEntry: (id: string) => void;
  onEditEntry: (id: string) => void;
  onDeleteEntry: (entry: AdminEntry) => void;
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button"
              className="rounded-md p-1.5 transition-colors hover:text-[var(--ink)]"
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

      {/* 简介:仅 divider 分隔,无 label——西式 caption(uppercase + letter-spacing)与纸墨气质冲突 */}
      <div className="mb-8 border-t pt-4" style={{ borderColor: 'var(--separator)' }}>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-faded)' }}>
          {detail.description || '暂无简介'}
        </p>
      </div>

      {/* 章节区:小标题 ink-faded 普通字号,不大写不字距 */}
      <div className="border-t pt-4" style={{ borderColor: 'var(--separator)' }}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs" style={{ color: 'var(--ink-faded)' }}>
            章节 · {detail.entries.length}
          </div>
          <button type="button" onClick={onCreateEntry}
            className="flex items-center gap-1.5 text-xs transition-colors"
            style={{ color: 'var(--ink-faded)' }}>
            <Plus size={12} strokeWidth={1.5} />
            添加章节
          </button>
        </div>

        {detail.entries.length === 0 ? (
          <p className="py-8 text-center text-xs" style={{ color: 'var(--ink-ghost)' }}>
            还没有章节,点上方「添加章节」开始
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--separator)' }}>
            {detail.entries.map((entry, idx) => (
              <li key={entry.nodeId}>
                <EntryRow
                  index={idx}
                  entry={entry}
                  onPreview={() => onPreviewEntry(entry.nodeId)}
                  onEdit={() => onEditEntry(entry.nodeId)}
                  onDelete={() => onDeleteEntry(entry)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function EntryRow({
  index, entry, onPreview, onEdit, onDelete,
}: {
  index: number;
  entry: AdminEntry;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const isPublished = !!entry.publishedVersionId;
  const updateYmd = entry.updatedAt
    ? new Date(entry.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
    : '--';
  const status = isPublished ? 'published' : 'committed';

  /* 整行点击 = 选中并切换到预览态(不进入编辑器);编辑/⋯按钮 stopPropagation 避免冒泡触发预览。
   *  无 hover bg(避免卡片化动效),仅 cursor-pointer 提示可点。 */
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPreview}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPreview(); } }}
      className="flex cursor-pointer items-center gap-4 px-2 py-3 text-xs"
    >
      <span className="shrink-0 text-2xs tabular-nums"
        style={{ color: 'var(--ink-ghost)', minWidth: '24px' }}>
        {String(index + 1).padStart(2, '0')}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm"
        style={{ color: entry.hasContent ? 'var(--ink)' : 'var(--ink-ghost)' }}>
        {entry.title || (entry.hasContent ? '无标题' : '(空章节)')}
      </span>
      <span className="shrink-0" style={{ minWidth: '90px' }}>
        <StatusBadge status={status} hasUnpublishedChanges={entry.hasUnpublishedChanges} />
      </span>
      <span className="shrink-0 tabular-nums"
        style={{ color: 'var(--ink-ghost)', minWidth: '50px' }}>
        {updateYmd}
      </span>
      <div className="flex shrink-0 items-center gap-1" onClick={stop}>
        <button type="button" onClick={onEdit}
          className="rounded px-2 py-1 transition-colors hover:text-[var(--ink)]"
          style={{ color: 'var(--ink-faded)' }}>编辑</button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button"
              className="rounded p-1 transition-colors hover:text-[var(--ink)]"
              style={{ color: 'var(--ink-faded)' }} aria-label="章节操作">
              <MoreHorizontal size={14} strokeWidth={1.5} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDelete} style={{ color: 'var(--danger)' }}>
              删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/* ── 视图 2:章节预览 ────────────────────────────────────────── */

function EntryPreviewView({
  anthologyTitle, entry, onBack, onEdit, onDelete,
}: {
  anthologyTitle: string;
  entry: AdminEntry;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  // 章节正文:再 fetch 一次,因为 toAdminEntryRef 不带正文
  const [body, setBody] = useState<EntryDetail | null>(null);
  const [bodyLoading, setBodyLoading] = useState(true);
  const [bodyError, setBodyError] = useState('');

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBodyLoading(true);
    setBodyError('');
    (async () => {
      try {
        const d = (await workspaceApi.getById('anthology', entry.nodeId, {
          visibility: 'all',
        })) as unknown as EntryDetail;
        if (!cancelled) setBody(d);
      } catch (err) {
        if (!cancelled) setBodyError(parseError(err, '加载章节正文失败'));
      } finally {
        if (!cancelled) setBodyLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [entry.nodeId]);

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
          {/* "你正在《X》" — 章节没有自己的面包屑,仅一行小字提示来源文集,
            *  点击可返回文集态(清掉 ?entry=)。比顶部面包屑更克制。 */}
          <button
            type="button"
            onClick={onBack}
            className="mt-2 inline-flex items-center gap-1 text-2xs transition-colors hover:text-[var(--ink)]"
            style={{ color: 'var(--ink-ghost)' }}
          >
            <ChevronLeft size={12} strokeWidth={1.5} />
            《{anthologyTitle || '文集'}》
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-4 pt-1">
          <button
            type="button"
            onClick={onEdit}
            className="text-xs transition-colors duration-150"
            style={{ color: 'var(--ink-faded)', fontFamily: 'inherit', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ink)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-faded)'; }}
          >
            编辑
          </button>
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
