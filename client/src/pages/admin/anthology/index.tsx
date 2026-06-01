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
  const selectedEntryContentItemId = searchParams.get('entry') ?? null;
  const confirm = useConfirm();

  const [rows, setRows] = useState<AnthologyRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [modal, setModal] = useState<ModalState>({ open: false, mode: 'create' });
  /* 章节列表与新建章节弹窗独立于文集弹窗 */
  const [entries, setEntries] = useState<StructureNode[]>([]);
  const [entriesLoading, setEntriesLoading] = useState(false);
  const [entryModal, setEntryModal] = useState<ModalState>({ open: false, mode: 'create' });

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

  /* 当前文集变化 → 拉它的章节列表(structure children) */
  const loadEntries = useCallback(async (parentNavId: string) => {
    setEntriesLoading(true);
    try {
      const r = await structureApi.getChildren(parentNavId, {
        scope: 'anthology', visibility: 'all',
      });
      setEntries(r.children);
    } catch {
      setEntries([]);
    } finally {
      setEntriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedRow) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries([]);
      return;
    }
    void loadEntries(selectedRow.navId);
  }, [selectedRow, loadEntries]);

  const selectAnthology = (contentItemId: string) => {
    /* 切文集:同时清掉 entry,避免上个文集的 entry id 卡住 */
    const next = new URLSearchParams();
    next.set('node', contentItemId);
    setSearchParams(next, { replace: true });
  };

  const selectEntry = (entryContentItemId: string) => {
    if (!selectedContentItemId) return;
    const next = new URLSearchParams();
    next.set('node', selectedContentItemId);
    next.set('entry', entryContentItemId);
    setSearchParams(next, { replace: true });
  };

  const handleCreateEntry = async (payload: NodeSubmitPayload) => {
    if (!selectedRow) return;
    const dto = payload.node as { name: string };
    try {
      const created = await structureApi.createNode({
        name: dto.name, type: 'DOC', scope: 'anthology', parentId: selectedRow.navId,
      });
      await Promise.all([loadEntries(selectedRow.navId), loadList()]);
      setEntryModal({ open: false, mode: 'create' });
      if (created.contentItemId) {
        window.location.href = `/admin/anthology/${created.contentItemId}/edit`;
      }
    } catch (err) {
      banner.error(parseError(err, '新增章节失败'));
    }
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
      {/* w-full:main 在外层 flex 容器(全局 layout 的 flex-1 主区)里默认只占自然宽度,
       *  必须显式撑满,否则中区 flex-1 拿到的剩余空间是 0 → 视觉被挤成竖条。 */}
      <main className="flex h-[calc(100vh-var(--topbar-h,52px))] w-full overflow-hidden">
        {/* 左:两段栈 — 顶部 文集列表 + (选中后) 底部 该文集章节列表 + footer 新建文集
         *  Why 两段栈:文集双层模型(文集→章节),左栏自然映射两层结构;
         *  选中文集才长出章节段,中区与右栏即时跟着切换,导航不离开侧栏。 */}
        <aside
          className="flex shrink-0 flex-col border-r"
          style={{
            width: '280px',
            background: 'var(--sidebar-bg)',
            borderColor: 'var(--separator)',
          }}
        >
          {/* 顶部 section:文集列表 */}
          <div className="shrink-0 px-5 pt-7 pb-3">
            <h2 className="text-sm font-medium" style={{ color: 'var(--ink)' }}>
              文集
            </h2>
            <p className="mt-0.5 text-2xs" style={{ color: 'var(--ink-faded)' }}>
              {rows.length} 部作品
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {listLoading ? (
              <LoadingState variant="inline" />
            ) : listError ? (
              <p className="px-5 text-xs" style={{ color: 'var(--danger)' }}>{listError}</p>
            ) : rows.length === 0 ? (
              <p className="px-5 py-4 text-xs" style={{ color: 'var(--ink-ghost)' }}>
                还没有文集,点下方「新建文集」开始
              </p>
            ) : (
              <ul>
                {rows.map((row) => {
                  const active = row.contentItemId === selectedContentItemId;
                  return (
                    <li key={row.contentItemId}>
                      <button
                        type="button"
                        onClick={() => selectAnthology(row.contentItemId)}
                        className="w-full px-5 py-2 text-left"
                        style={active ? { background: 'var(--shelf)' } : undefined}
                      >
                        <div
                          className={`truncate text-sm ${active ? 'font-medium' : ''}`}
                          style={{ color: active ? 'var(--ink)' : 'var(--ink-faded)' }}
                        >
                          {row.title || '无标题'}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 底部 section:选中文集的章节列表 + 新增章节 */}
          {selectedRow && (
            <>
              <div
                className="flex shrink-0 items-center justify-between border-t px-5 pt-4 pb-2"
                style={{ borderColor: 'var(--separator)' }}
              >
                <div className="min-w-0">
                  <h3 className="truncate text-2xs font-medium uppercase"
                    style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}>
                    章节
                  </h3>
                  <p className="mt-0.5 truncate text-2xs" style={{ color: 'var(--ink-faded)' }}>
                    {selectedRow.title || '无标题'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEntryModal({ open: true, mode: 'create' })}
                  className="shrink-0 transition-colors hover:text-[var(--ink)]"
                  style={{ color: 'var(--ink-faded)' }}
                  aria-label="新增章节"
                >
                  <Plus size={14} strokeWidth={1.5} />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {entriesLoading ? (
                  <LoadingState variant="inline" />
                ) : entries.length === 0 ? (
                  <p className="px-5 py-3 text-xs" style={{ color: 'var(--ink-ghost)' }}>
                    还没有章节
                  </p>
                ) : (
                  <ul>
                    {entries.map((entry) => {
                      const active = entry.contentItemId === selectedEntryContentItemId;
                      return (
                        <li key={entry.id}>
                          <button
                            type="button"
                            onClick={() => entry.contentItemId && selectEntry(entry.contentItemId)}
                            className="w-full truncate px-5 py-1.5 text-left text-sm"
                            style={{
                              background: active ? 'var(--shelf)' : 'transparent',
                              color: active ? 'var(--ink)' : 'var(--ink-faded)',
                              fontWeight: active ? 500 : 400,
                            }}
                          >
                            {entry.name || '(空标题)'}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* footer:新建文集 */}
          <div
            className="shrink-0 border-t px-3 py-3"
            style={{ borderColor: 'var(--separator)' }}
          >
            <button
              type="button"
              onClick={() => setModal({ open: true, mode: 'create' })}
              className="flex w-full items-center justify-center gap-1.5 py-2 text-sm transition-colors hover:text-[var(--ink)]"
              style={{ color: 'var(--ink-faded)' }}
            >
              <Plus size={14} strokeWidth={1.5} />
              新建文集
            </button>
          </div>
        </aside>

        {/* 中:选中文集详情(min-w-0 + flex 让子 panel 撑满剩余宽度) */}
        <div className="flex min-w-0 flex-1 overflow-hidden">
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
      {entryModal.open && (
        <NodeFormModal
          modal={entryModal}
          onClose={() => setEntryModal({ open: false, mode: 'create' })}
          onSubmit={handleCreateEntry}
          scope="anthology"
        />
      )}
    </>
  );
};

/* 状态徽章 — 严格遵设计宪法 §3.0/§3.2:
 *   语义信号优先「文字 + 小点」,不糊色块;颜色只剩红/绿(蓝已砍)。
 *   - 草稿        → 灰字「草稿」(状态默认,无点)
 *   - 已发布      → 小绿点 + 灰字「已发布」(success)
 *   - 有未发布改动 → 小红点 + 灰字「有未发布改动」(待办/未完成 → danger 语义)
 * 颜色一律走 token (--success / --danger),不硬编码 rgba。 */
function StatusBadge({ status, hasUnpublishedChanges }: {
  status: 'committed' | 'published';
  hasUnpublishedChanges: boolean;
}) {
  if (status !== 'published') {
    return <span style={{ color: 'var(--ink-ghost)' }}>草稿</span>;
  }
  if (hasUnpublishedChanges) {
    return (
      <span className="inline-flex items-center gap-1" style={{ color: 'var(--ink-faded)' }}>
        <span className="inline-block size-1.5 rounded-full" style={{ background: 'var(--danger)' }} />
        有未发布改动
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1" style={{ color: 'var(--ink-faded)' }}>
      <span className="inline-block size-1.5 rounded-full" style={{ background: 'var(--success)' }} />
      已发布
    </span>
  );
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
