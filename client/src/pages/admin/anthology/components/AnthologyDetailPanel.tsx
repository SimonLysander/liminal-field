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
import { workspaceApi } from '@/services/workspace';
import { structureApi, type StructureNode } from '@/services/structure';
import { request } from '@/services/request';
import MarkdownBody from '@/components/shared/MarkdownBody';
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
        <p className="text-sm" style={{ color: 'var(--mark-red)' }}>{error}</p>
      </div>
    );
  if (!detail) return null;

  // 视图分流:章节预览 vs 文集概览
  const selectedEntry = selectedEntryId
    ? detail.entries.find((e) => e.nodeId === selectedEntryId) ?? null
    : null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
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

  return (
    <>
      {/* 顶部:title + 元信息 + ⋯ */}
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-medium" style={{ color: 'var(--ink)' }}>
            《{detail.title || '无标题'}》
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
              className="rounded-md p-1.5 transition-colors hover:bg-[var(--shelf)]"
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
            <DropdownMenuItem onClick={onDelete} style={{ color: 'var(--mark-red)' }}>
              删除文集
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 简介 */}
      <div className="mb-8 border-t pt-4" style={{ borderColor: 'var(--separator)' }}>
        <div className="mb-1.5 text-2xs font-medium uppercase"
          style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}>简介</div>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-faded)' }}>
          {detail.description || '暂无简介'}
        </p>
      </div>

      {/* 章节区 */}
      <div className="border-t pt-4" style={{ borderColor: 'var(--separator)' }}>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-2xs font-medium uppercase"
            style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}>章节</div>
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
  // 状态徽章(抄 StatusBadge,但 entry 用 publishedVersionId 派生)
  const status = isPublished ? 'published' : 'committed';

  return (
    <div className="flex items-center gap-4 px-2 py-3">
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
      <span className="shrink-0 text-xs tabular-nums"
        style={{ color: 'var(--ink-ghost)', minWidth: '50px' }}>
        {updateYmd}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button type="button" onClick={onPreview}
          className="rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--shelf)]"
          style={{ color: 'var(--ink-faded)' }}>预览</button>
        <button type="button" onClick={onEdit}
          className="rounded px-2 py-1 text-xs transition-colors hover:bg-[var(--shelf)]"
          style={{ color: 'var(--ink-faded)' }}>编辑</button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button"
              className="rounded p-1 transition-colors hover:bg-[var(--shelf)]"
              style={{ color: 'var(--ink-faded)' }} aria-label="章节操作">
              <MoreHorizontal size={14} strokeWidth={1.5} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onDelete} style={{ color: 'var(--mark-red)' }}>
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
  const status = isPublished ? 'published' : 'committed';
  const updateYmd = entry.updatedAt
    ? new Date(entry.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
    : '--';

  return (
    <>
      {/* 面包屑 + ⋯ */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <button type="button" onClick={onBack}
          className="flex items-center gap-1 text-xs transition-colors hover:text-[var(--ink)]"
          style={{ color: 'var(--ink-faded)' }}>
          <ChevronLeft size={14} strokeWidth={1.5} />
          《{anthologyTitle || '文集'}》
        </button>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onEdit}
            className="rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-[var(--shelf)]"
            style={{ color: 'var(--ink-faded)' }}>编辑</button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button"
                className="rounded-md p-1.5 transition-colors hover:bg-[var(--shelf)]"
                style={{ color: 'var(--ink-faded)' }} aria-label="章节操作">
                <MoreHorizontal size={18} strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onDelete} style={{ color: 'var(--mark-red)' }}>
                删除章节
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* 标题 + 元信息 */}
      <h1 className="text-2xl font-medium" style={{ color: 'var(--ink)' }}>
        {entry.title || '(空章节)'}
      </h1>
      <p className="mt-2 flex items-center gap-2 text-xs" style={{ color: 'var(--ink-faded)' }}>
        <StatusBadge status={status} hasUnpublishedChanges={entry.hasUnpublishedChanges} />
        <span>·</span>
        <span>{updateYmd} 更新</span>
      </p>

      {/* 正文 readonly */}
      <div className="mt-8 border-t pt-6" style={{ borderColor: 'var(--separator)' }}>
        {bodyLoading ? (
          <LoadingState variant="inline" />
        ) : bodyError ? (
          <p className="text-sm" style={{ color: 'var(--mark-red)' }}>{bodyError}</p>
        ) : body && body.bodyMarkdown.trim() ? (
          <div className="prose prose-sm max-w-none">
            <MarkdownBody markdown={body.bodyMarkdown} contentItemId={entry.nodeId} />
          </div>
        ) : (
          <p className="py-8 text-center text-xs" style={{ color: 'var(--ink-ghost)' }}>
            (空章节,点右上「编辑」开始写)
          </p>
        )}
      </div>
    </>
  );
}
