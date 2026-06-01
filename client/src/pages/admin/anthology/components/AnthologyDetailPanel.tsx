import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { banner } from '@/components/ui/banner-api';
import { LoadingState } from '@/components/LoadingState';
import { useConfirm } from '@/contexts/ConfirmContext';
import { smoothBounce } from '@/lib/motion';
import {
  workspaceApi,
  type ContentHistoryEntry,
  type ContentVersion,
} from '@/services/workspace';
import { structureApi, type StructureNode } from '@/services/structure';
import { request } from '@/services/request';
import { ContentVersionView } from '../../components/ContentVersionView';
import { FormalSidePanel } from '../../components/FormalSidePanel';
import { NodeFormModal } from '../../components/NodeFormModal';
import { MoveToDialog } from '../../components/MoveToDialog';
import type {
  DraftPresence,
  FormalContentState,
  ModalState,
  NodeSubmitPayload,
  PreviewState,
} from '../../types';
import { parseError } from '../../helpers';
import { type AnthologyRow } from '../index';

interface AdminEntry {
  nodeId: string;
  title: string;
  date: string | null;
  latestVersion: ContentVersion | null;
  publishedVersion: ContentVersion | null;
  hasContent: boolean;
  publishedVersionId: string | null;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

interface AnthologyAdminDetail {
  id: string;
  title: string;
  description: string;
  latestVersion: ContentVersion | null;
  publishedVersion: ContentVersion | null;
  bodyMarkdown: string;
  status: 'committed' | 'published';
  hasUnpublishedChanges: boolean;
  updatedAt: string;
  entries: AdminEntry[];
}

interface EntryDetail {
  nodeId: string;
  title: string;
  summary?: string;
  date: string | null;
  updatedAt: string;
  bodyMarkdown: string;
}

interface AnthologyVersionDetail {
  id: string;
  title: string;
  description: string;
  bodyMarkdown: string;
  updatedAt: string;
}

interface Props {
  row: AnthologyRow;
  onReload: () => void | Promise<void>;
  onDelete: () => void;
}

const EMPTY_DRAFT: DraftPresence = { exists: false };

export function AnthologyDetailPanel({ row, onReload, onDelete }: Props) {
  const confirm = useConfirm();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedEntryId = searchParams.get('chapter') ?? null;

  const [detail, setDetail] = useState<AnthologyAdminDetail | null>(null);
  const [childrenNavs, setChildrenNavs] = useState<StructureNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<ModalState>({ open: false, mode: 'create' });
  const [moveTarget, setMoveTarget] = useState<StructureNode | null>(null);

  const [entryDetail, setEntryDetail] = useState<EntryDetail | null>(null);
  const [entryLoading, setEntryLoading] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [history, setHistory] = useState<ContentHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [draftPresence, setDraftPresence] = useState<DraftPresence>(EMPTY_DRAFT);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  const loadDetail = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
      setError('');
    }
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
      if (!options?.silent) setLoading(false);
    }
  }, [row.contentItemId, row.navId]);

  useEffect(() => {
    void Promise.resolve().then(() => loadDetail());
  }, [loadDetail]);

  const navIdByContent = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of childrenNavs) if (n.contentItemId) m.set(n.contentItemId, n.id);
    return m;
  }, [childrenNavs]);

  const selectedEntry = selectedEntryId && detail
    ? detail.entries.find((e) => e.nodeId === selectedEntryId) ?? null
    : null;
  const selectedEntryNodeId = selectedEntry?.nodeId ?? null;
  const activeContentId = selectedEntry?.nodeId ?? row.contentItemId;

  const activeNode = useMemo<StructureNode | null>(() => {
    if (!detail) return null;
    if (selectedEntry) {
      return {
        id: navIdByContent.get(selectedEntry.nodeId) ?? selectedEntry.nodeId,
        name: selectedEntry.title || '无标题',
        type: 'DOC',
        parentId: row.navId,
        contentItemId: selectedEntry.nodeId,
        sortOrder: 0,
        hasChildren: false,
        createdAt: selectedEntry.updatedAt,
        updatedAt: selectedEntry.updatedAt,
      };
    }
    return {
      id: row.navId,
      name: detail.title || row.title || '无标题',
      type: 'DOC',
      contentItemId: row.contentItemId,
      sortOrder: 0,
      hasChildren: detail.entries.length > 0,
      createdAt: detail.updatedAt,
      updatedAt: detail.updatedAt,
    };
  }, [detail, navIdByContent, row, selectedEntry]);

  const loadEntryDetail = useCallback(async (options?: { silent?: boolean }) => {
    if (!selectedEntryNodeId) {
      setEntryDetail(null);
      setEntryLoading(false);
      setEntryError('');
      return;
    }
    if (!options?.silent) {
      setEntryLoading(true);
      setEntryError('');
    }
    try {
      const d = await request<EntryDetail>(
        `/spaces/anthology/public/items/${row.contentItemId}/entries/${selectedEntryNodeId}`,
      );
      setEntryDetail(d);
    } catch (err) {
      setEntryError(parseError(err, '加载章节正文失败'));
      setEntryDetail(null);
    } finally {
      if (!options?.silent) setEntryLoading(false);
    }
  }, [row.contentItemId, selectedEntryNodeId]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setPreview(null);
      setActiveIndex(-1);
      void loadEntryDetail();
    });
    return () => {
      cancelled = true;
    };
  }, [loadEntryDetail]);

  useEffect(() => {
    let cancelled = false;
    const historyUrl = selectedEntryNodeId
      ? `/spaces/anthology/items/${row.contentItemId}/entries/${selectedEntryNodeId}/history`
      : `/spaces/anthology/items/${row.contentItemId}/history`;

    void (async () => {
      setHistoryLoading(true);
      try {
        const [historyResult, draft] = await Promise.all([
          request<ContentHistoryEntry[]>(historyUrl),
          workspaceApi.getNodeDraft('anthology', activeContentId),
        ]);
        if (cancelled) return;
        setHistory(historyResult);
        setDraftPresence(draft ? { exists: true, savedAt: draft.savedAt } : EMPTY_DRAFT);
      } catch (err) {
        if (!cancelled) {
          setHistory([]);
          setDraftPresence(EMPTY_DRAFT);
          banner.error(parseError(err, '加载右栏信息失败'));
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeContentId, row.contentItemId, selectedEntryNodeId]);

  const reloadActive = useCallback(async (options?: { silent?: boolean }) => {
    if (selectedEntryNodeId) {
      await Promise.all([
        loadEntryDetail({ silent: options?.silent }),
        loadDetail({ silent: options?.silent }),
        onReload(),
      ]);
    } else {
      await Promise.all([loadDetail({ silent: options?.silent }), onReload()]);
    }
  }, [loadDetail, loadEntryDetail, onReload, selectedEntryNodeId]);

  const content = useMemo<FormalContentState | null>(() => {
    if (!detail) return null;
    if (selectedEntry) {
      const body = entryDetail?.bodyMarkdown ?? '';
      const latestVersion = normalizeVersion(
        selectedEntry.latestVersion,
        selectedEntry.nodeId,
        selectedEntry.title,
      );
      const publishedVersion = selectedEntry.publishedVersion
        ? normalizeVersion(selectedEntry.publishedVersion, selectedEntry.nodeId, selectedEntry.title)
        : selectedEntry.publishedVersionId
          ? normalizeVersion({ versionId: selectedEntry.publishedVersionId }, selectedEntry.nodeId, selectedEntry.title)
          : null;
      return {
        id: selectedEntry.nodeId,
        status: publishedVersion ? 'published' : 'committed',
        latestVersion,
        publishedVersion,
        hasUnpublishedChanges: selectedEntry.hasUnpublishedChanges,
        bodyMarkdown: body,
        headings: extractMarkdownHeadings(body),
        updatedAt: entryDetail?.updatedAt ?? selectedEntry.updatedAt,
      };
    }

    return {
      id: row.contentItemId,
      status: detail.status,
      latestVersion: normalizeVersion(detail.latestVersion, row.contentItemId, detail.title),
      publishedVersion: detail.publishedVersion
        ? normalizeVersion(detail.publishedVersion, row.contentItemId, detail.title)
        : null,
      hasUnpublishedChanges: detail.hasUnpublishedChanges,
      bodyMarkdown: detail.bodyMarkdown,
      headings: extractMarkdownHeadings(detail.bodyMarkdown),
      updatedAt: detail.updatedAt ?? row.updatedAt,
    };
  }, [detail, entryDetail, row, selectedEntry]);

  const toc = useMemo(
    () => (preview?.headings ?? content?.headings ?? []).map((h, i) => ({
      level: h.level,
      text: h.text,
      index: i,
    })),
    [content?.headings, preview?.headings],
  );

  const getHeadingEls = useCallback(
    () => previewRef.current?.querySelectorAll<HTMLElement>('[data-heading-id]'),
    [],
  );

  const handlePreviewScroll = useCallback(() => {
    const container = previewRef.current;
    const els = getHeadingEls();
    if (!container || !els || els.length === 0) return;
    const threshold = container.getBoundingClientRect().top + 50;
    for (let i = els.length - 1; i >= 0; i--) {
      if (els[i].getBoundingClientRect().top <= threshold) {
        setActiveIndex(i);
        return;
      }
    }
    setActiveIndex(0);
  }, [getHeadingEls]);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    el.addEventListener('scroll', handlePreviewScroll, { passive: true });
    return () => el.removeEventListener('scroll', handlePreviewScroll);
  }, [handlePreviewScroll]);

  const scrollToHeading = useCallback((index: number) => {
    const els = getHeadingEls();
    const container = previewRef.current;
    if (!els || !els[index] || !container) return;
    const el = els[index];
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 16;
    container.scrollTo({ top, behavior: 'smooth' });

    el.classList.remove('toc-highlight');
    void el.offsetWidth;
    el.classList.add('toc-highlight');
    el.addEventListener('animationend', () => el.classList.remove('toc-highlight'), { once: true });
  }, [getHeadingEls]);

  const handleSaveSummary = useCallback(async (summary: string) => {
    await workspaceApi.patchMeta('anthology', activeContentId, { summary });
    await reloadActive({ silent: true });
  }, [activeContentId, reloadActive]);

  const handlePublish = useCallback(async () => {
    await request(`/spaces/anthology/items/${activeContentId}/publish`, { method: 'PUT' });
    await reloadActive({ silent: true });
  }, [activeContentId, reloadActive]);

  const handleUnpublish = useCallback(async () => {
    await request(`/spaces/anthology/items/${activeContentId}/unpublish`, { method: 'PUT' });
    await reloadActive({ silent: true });
  }, [activeContentId, reloadActive]);

  const handlePublishPreview = useCallback(async () => {
    if (!preview) return;
    await request(`/spaces/anthology/items/${activeContentId}/publish`, {
      method: 'PUT',
      body: JSON.stringify({ versionId: preview.versionId }),
    });
    setPreview(null);
    await reloadActive({ silent: true });
  }, [activeContentId, preview, reloadActive]);

  const handlePublishAll = useCallback(async () => {
    await request(`/spaces/anthology/items/${row.contentItemId}/publish-all`, { method: 'POST' });
    banner.success('已发布全部');
    await reloadActive({ silent: true });
  }, [reloadActive, row.contentItemId]);

  const handlePreviewVersion = useCallback(async (versionId: string) => {
    if (!content) return;
    if (preview?.versionId === versionId) return;
    if (versionId === content.latestVersion.versionId) {
      setPreview(null);
      return;
    }

    setPreviewLoading(true);
    try {
      if (selectedEntryNodeId) {
        const d = await request<EntryDetail>(
          `/spaces/anthology/items/${row.contentItemId}/entries/${selectedEntryNodeId}/versions/${versionId}`,
        );
        setPreview({
          versionId,
          title: d.title,
          summary: d.summary ?? '',
          bodyMarkdown: d.bodyMarkdown,
          headings: extractMarkdownHeadings(d.bodyMarkdown),
          committedAt: d.updatedAt,
        });
      } else {
        const d = await request<AnthologyVersionDetail>(
          `/spaces/anthology/items/${row.contentItemId}/versions/${versionId}`,
        );
        setPreview({
          versionId,
          title: d.title,
          summary: d.description,
          bodyMarkdown: d.bodyMarkdown,
          headings: extractMarkdownHeadings(d.bodyMarkdown),
          committedAt: d.updatedAt,
        });
      }
    } catch (err) {
      banner.error(parseError(err, '加载版本内容失败'));
    } finally {
      setPreviewLoading(false);
    }
  }, [content, preview?.versionId, row.contentItemId, selectedEntryNodeId]);

  const handleEditNode = useCallback((node: StructureNode) => {
    setModal({ open: true, mode: 'edit', node });
  }, []);

  const handleModalSubmit = useCallback(async (payload: NodeSubmitPayload) => {
    if (modal.mode !== 'edit' || !modal.node) return;
    await structureApi.updateNode(modal.node.id, payload.node);
    await reloadActive();
  }, [modal.mode, modal.node, reloadActive]);

  const handleDeleteEntry = useCallback(async (entry: AdminEntry) => {
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
    await structureApi.deleteNode(navId);
    banner.success('已删除');
    const next = new URLSearchParams(searchParams);
    next.delete('chapter');
    setSearchParams(next, { replace: true });
    await reloadActive();
  }, [confirm, navIdByContent, reloadActive, searchParams, setSearchParams]);

  const handleDeleteNode = useCallback((node: StructureNode) => {
    if (node.contentItemId === row.contentItemId) {
      onDelete();
      return;
    }
    const entry = detail?.entries.find((e) => e.nodeId === node.contentItemId);
    if (entry) void handleDeleteEntry(entry);
  }, [detail?.entries, handleDeleteEntry, onDelete, row.contentItemId]);

  const handleMoveConfirm = useCallback(async (targetFolderId: string | null) => {
    if (!moveTarget) return;
    await structureApi.updateNode(moveTarget.id, { parentId: targetFolderId });
    await reloadActive();
  }, [moveTarget, reloadActive]);

  if (loading) return (
    <div className="flex h-full w-full items-center justify-center">
      <LoadingState variant="inline" />
    </div>
  );
  if (error) return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
    </div>
  );
  if (!detail || !activeNode || !content) return null;

  const editUrl = selectedEntry
    ? `/admin/anthology/${selectedEntry.nodeId}/edit?at=${row.contentItemId}`
    : `/admin/anthology/${row.contentItemId}/edit`;
  const latestHistoryEntry = history.find(
    (entry) => entry.versionId === content.latestVersion.versionId,
  );
  const canEditSummary = !!latestHistoryEntry && (latestHistoryEntry.source ?? 'user') === 'user';

  return (
    <div className="flex h-full w-full min-w-0 overflow-hidden" style={{ background: 'var(--paper)' }}>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div
          className="flex-1 overflow-y-auto px-10 py-9 max-[520px]:px-4"
          ref={previewRef}
        >
          <div className="mx-auto w-full max-w-[var(--layout-reading-max)]">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeNode.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -2 }}
                transition={{ duration: 0.2, ease: smoothBounce }}
              >
                <ContentVersionView
                  node={activeNode}
                  content={content}
                  loading={selectedEntry ? entryLoading : false}
                  error={selectedEntry ? entryError : ''}
                  preview={preview}
                  previewLoading={previewLoading}
                  canEditSummary={canEditSummary}
                  onSaveSummary={handleSaveSummary}
                  onReload={() => reloadActive({ silent: true })}
                  onPublish={handlePublish}
                  onUnpublish={handleUnpublish}
                  onExitPreview={() => setPreview(null)}
                  onPublishPreview={handlePublishPreview}
                  onEdit={handleEditNode}
                  onDelete={handleDeleteNode}
                  onMoveTo={setMoveTarget}
                  onPublishAll={!selectedEntry && detail.entries.length > 0 ? handlePublishAll : undefined}
                />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <aside
        className="flex shrink-0 flex-col overflow-hidden px-5 py-7"
        style={{ width: 'var(--layout-context)' }}
      >
        <FormalSidePanel
          toc={toc}
          activeIndex={activeIndex}
          onScrollToHeading={scrollToHeading}
          draftPresence={draftPresence}
          history={history}
          historyLoading={historyLoading}
          publishedVersionId={content.publishedVersion?.versionId ?? null}
          activeVersionId={preview?.versionId ?? null}
          onEditDraft={() => {
            window.location.href = editUrl;
          }}
          onSelectVersion={handlePreviewVersion}
        />
      </aside>

      {modal.open && (
        <NodeFormModal
          modal={modal}
          onClose={() => setModal({ open: false, mode: 'create' })}
          onSubmit={handleModalSubmit}
          scope="anthology"
        />
      )}
      {moveTarget && (
        <MoveToDialog
          node={moveTarget}
          scope="anthology"
          onConfirm={handleMoveConfirm}
          onClose={() => setMoveTarget(null)}
        />
      )}
    </div>
  );
}

function normalizeVersion(
  version: Partial<ContentVersion> | null | undefined,
  fallbackId: string,
  fallbackTitle: string,
): ContentVersion {
  return {
    versionId: version?.versionId || fallbackId,
    commitHash: version?.commitHash ?? '',
    title: version?.title ?? fallbackTitle,
    summary: version?.summary ?? '',
  };
}

function extractMarkdownHeadings(markdown: string): { level: number; text: string }[] {
  const headings: { level: number; text: string }[] = [];
  for (const line of markdown.split('\n')) {
    const match = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line.trim());
    if (!match) continue;
    headings.push({
      level: match[1].length,
      text: match[2].trim(),
    });
  }
  return headings;
}
