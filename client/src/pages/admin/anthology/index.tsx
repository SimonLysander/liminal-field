/*
 * AnthologyAdmin — 文集管理主页面 (/admin/anthology)
 *
 * 重写背景:Phase 4 让文集 admin 复用 ContentAdmin(笔记列表样式)信息密度不够,
 * 现回到独立 admin 设计:左 文集列表(双行:标题+副信息 篇数·状态)
 *                     中 选中文集详情(元信息+简介+章节表格)
 * 底层走统一节点接口(workspaceApi + structureApi),不再有 entry 专用接口。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import Topbar from '@/components/global/Topbar';
import { banner } from '@/components/ui/banner-api';
import { LoadingState } from '@/components/LoadingState';
import { useConfirm } from '@/contexts/ConfirmContext';
import { workspaceApi } from '@/services/workspace';
import { structureApi, type StructureNode } from '@/services/structure';
import { NodeFormModal } from '../components/NodeFormModal';
import { parseError } from '../helpers';
import type { ModalState, NodeSubmitPayload } from '../types';
import { AnthologyDetailPanel } from './components/AnthologyDetailPanel';

/* 后端 toAdminListItem 返回结构 */
interface AnthologyAdminListItem {
  id: string; // contentItemId
  title: string;
  description: string;
  entryCount: number;
  status: 'committed' | 'published';
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

/** 列表行 = list item + navigation id 合并(navId 用于结构操作,删除/排序) */
export interface AnthologyRow {
  navId: string;
  contentItemId: string;
  title: string;
  description: string;
  entryCount: number;
  status: 'committed' | 'published';
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

const AnthologyAdmin = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedContentItemId = searchParams.get('node') ?? null;
  const confirm = useConfirm();

  const [rows, setRows] = useState<AnthologyRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [modal, setModal] = useState<ModalState>({ open: false, mode: 'create' });

  /* 并行拉 admin list + structure roots,按 contentItemId 合并 */
  const loadList = useCallback(async () => {
    setListLoading(true);
    setListError('');
    try {
      const [list, structure] = await Promise.all([
        workspaceApi.list('anthology') as unknown as Promise<AnthologyAdminListItem[]>,
        structureApi.getRootNodes({ scope: 'anthology', visibility: 'all' }),
      ]);
      const navByContent = new Map<string, StructureNode>();
      for (const n of structure.children) if (n.contentItemId) navByContent.set(n.contentItemId, n);
      const merged: AnthologyRow[] = list
        .map((item) => {
          const nav = navByContent.get(item.id);
          if (!nav) return null;
          return {
            navId: nav.id,
            contentItemId: item.id,
            title: item.title,
            description: item.description,
            entryCount: item.entryCount,
            status: item.status,
            hasUnpublishedChanges: item.hasUnpublishedChanges,
            updatedAt: item.updatedAt,
          };
        })
        .filter((x): x is AnthologyRow => x !== null);
      // 按 nav 顺序(structure 已 sort_order 升序)
      merged.sort((a, b) => {
        const ai = structure.children.findIndex((n) => n.id === a.navId);
        const bi = structure.children.findIndex((n) => n.id === b.navId);
        return ai - bi;
      });
      setRows(merged);
    } catch (err) {
      setListError(parseError(err, '加载文集列表失败'));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    // lint 'react-hooks/set-state-in-effect' 误报:loadList 内 setState 是 async fetch
    // 回调里调,不是同步 cascading render。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadList();
  }, [loadList]);

  const selectedRow = useMemo(
    () => rows.find((r) => r.contentItemId === selectedContentItemId) ?? null,
    [rows, selectedContentItemId],
  );

  const selectAnthology = (contentItemId: string) => {
    setSearchParams({ node: contentItemId }, { replace: true });
  };

  /* 新建文集:建 navigation node + 跳编辑器写卷首语 */
  const handleCreate = async (payload: NodeSubmitPayload) => {
    const dto = payload.node as { name: string };
    try {
      const created = await structureApi.createNode({
        name: dto.name,
        type: 'DOC',
        scope: 'anthology',
      });
      await loadList();
      if (created.contentItemId) {
        window.location.href = `/admin/anthology/${created.contentItemId}/edit`;
      }
    } catch (err) {
      banner.error(parseError(err, '新建失败'));
    }
  };

  const handleDeleteAnthology = async (row: AnthologyRow) => {
    const ok = await confirm({
      title: '删除文集',
      message: `将删除「${row.title}」及其全部章节。`,
      danger: true,
      confirmLabel: '删除',
    });
    if (!ok) return;
    try {
      await structureApi.deleteNode(row.navId);
      banner.success('已删除');
      if (selectedContentItemId === row.contentItemId) {
        setSearchParams({}, { replace: true });
      }
      void loadList();
    } catch (err) {
      banner.error(parseError(err, '删除失败'));
    }
  };

  return (
    <>
      <Topbar />
      <main className="flex h-[calc(100vh-var(--topbar-h,52px))] overflow-hidden">
        {/* 左:文集列表 */}
        <aside
          className="flex shrink-0 flex-col border-r"
          style={{
            width: '280px',
            background: 'var(--sidebar-bg)',
            borderColor: 'var(--separator)',
          }}
        >
          <div className="shrink-0 px-5 pt-7 pb-3">
            <h2 className="text-lg font-medium" style={{ color: 'var(--ink)' }}>
              文集
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--ink-faded)' }}>
              {rows.length} 部作品
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            {listLoading ? (
              <LoadingState variant="inline" />
            ) : listError ? (
              <p className="px-2 text-xs" style={{ color: 'var(--mark-red)' }}>
                {listError}
              </p>
            ) : rows.length === 0 ? (
              <p className="px-2 py-4 text-xs" style={{ color: 'var(--ink-ghost)' }}>
                还没有文集,点下方「新建」开始
              </p>
            ) : (
              <ul className="space-y-1">
                {rows.map((row) => {
                  const active = row.contentItemId === selectedContentItemId;
                  return (
                    <li key={row.contentItemId}>
                      <button
                        type="button"
                        onClick={() => selectAnthology(row.contentItemId)}
                        className="relative w-full px-3 py-2.5 text-left"
                      >
                        {active && (
                          <span
                            className="absolute left-0 top-2.5 bottom-2.5 w-[2px]"
                            style={{ background: 'var(--ink)' }}
                          />
                        )}
                        <div className="min-w-0">
                          <div
                            className="truncate text-sm"
                            style={{
                              color: active ? 'var(--ink)' : 'var(--ink-faded)',
                              fontWeight: active ? 600 : 500,
                            }}
                          >
                            {row.title || '无标题'}
                          </div>
                          <div
                            className="mt-1 flex items-center gap-1.5 truncate text-2xs"
                            style={{ color: 'var(--ink-ghost)' }}
                          >
                            <span>{row.entryCount} 篇</span>
                            <span>·</span>
                            <StatusLabel row={row} />
                          </div>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div
            className="shrink-0 border-t px-3 py-3"
            style={{ borderColor: 'var(--separator)' }}
          >
            <button
              type="button"
              onClick={() => setModal({ open: true, mode: 'create' })}
              className="flex w-full items-center justify-center gap-1.5 rounded-md py-2 text-sm transition-colors hover:bg-[var(--shelf)]"
              style={{ color: 'var(--ink-faded)' }}
            >
              <Plus size={14} strokeWidth={1.5} />
              新建文集
            </button>
          </div>
        </aside>

        {/* 中:选中文集详情 */}
        <div className="flex-1 overflow-hidden">
          {selectedRow ? (
            <AnthologyDetailPanel
              row={selectedRow}
              onReload={loadList}
              onDelete={() => handleDeleteAnthology(selectedRow)}
            />
          ) : (
            <EmptyHint />
          )}
        </div>
      </main>

      {modal.open && (
        <NodeFormModal
          modal={modal}
          onClose={() => setModal({ open: false, mode: 'create' })}
          onSubmit={handleCreate}
          scope="anthology"
        />
      )}
    </>
  );
};

/** 状态徽章 — 抄 VersionTimeline.tsx 的设计语言:
 *  rounded + 浅色底 + 同色字 + text-3xs font-semibold
 *  已发布:绿;有未发布改动:蓝;草稿:无徽章纯文字 ink-ghost */
function StatusBadge({ status, hasUnpublishedChanges }: {
  status: 'committed' | 'published';
  hasUnpublishedChanges: boolean;
}) {
  if (status !== 'published') {
    return <span style={{ color: 'var(--ink-ghost)' }}>草稿</span>;
  }
  if (hasUnpublishedChanges) {
    return (
      <span
        className="rounded px-1.5 py-[1px] text-3xs font-semibold"
        style={{ background: 'rgba(0,122,255,0.12)', color: 'var(--mark-blue)' }}
      >
        有未发布改动
      </span>
    );
  }
  return (
    <span
      className="rounded px-1.5 py-[1px] text-3xs font-semibold"
      style={{ background: 'rgba(48,209,88,0.12)', color: 'var(--mark-green)' }}
    >
      已发布
    </span>
  );
}

function StatusLabel({ row }: { row: AnthologyRow }) {
  return <StatusBadge status={row.status} hasUnpublishedChanges={row.hasUnpublishedChanges} />;
}

export { StatusBadge };

function EmptyHint() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <p className="text-sm" style={{ color: 'var(--ink-faded)' }}>
        未选择文集
      </p>
      <p className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
        从左侧选择一部作品,或新建文集
      </p>
    </div>
  );
}

export default AnthologyAdmin;
