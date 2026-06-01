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
/* 钻入式左栏改造后:Plus icon 不再用(底部按钮改"新作/新篇"纯字),lucide 直接拆。 */
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

/* 左栏条目卡数据(来自 admin detail.entries):带状态/时间,供副信息展示 */
interface AnthologyEntryListItem {
  nodeId: string;
  title: string;
  publishedVersionId: string | null;
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
  /* URL 状态(对齐笔记 admin at 心智 + 文集场景化 chapter):
   *   ?at=文集contentItemId         → 文集态:左栏钻入到该文集,中区显示文集详情
   *   ?at=文集id&chapter=条目id     → 章节态:钻入文集 + 选中某条目,中区显示章节详情
   *   (无参数)                       → 文集层:展示文集列表
   * 笔记单层只用 ?at=(选中即钻入);文集双层 ?at=(钻入文集)+ ?chapter=(选中章节)。 */
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedContentItemId = searchParams.get('at') ?? null;
  const selectedEntryContentItemId = searchParams.get('chapter') ?? null;
  const confirm = useConfirm();

  const [rows, setRows] = useState<AnthologyRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [modal, setModal] = useState<ModalState>({ open: false, mode: 'create' });
  /* 章节列表与新建章节弹窗独立于文集弹窗
   * 左栏 entries 不用 structure children(只有 name),改用 admin detail 拿到带状态/时间的完整字段,
   * 让条目卡能展示「状态徽章 · M/D 更新」副信息(对齐文集卡设计)。 */
  const [entries, setEntries] = useState<AnthologyEntryListItem[]>([]);
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

  /* 当前文集变化 → 拉它的 admin detail,取 entries(带 publishedVersionId/hasUnpublishedChanges/updatedAt 完整字段) */
  const loadEntries = useCallback(async (contentItemId: string) => {
    setEntriesLoading(true);
    try {
      const d = await workspaceApi.getById('anthology', contentItemId, {
        visibility: 'all',
      }) as unknown as { entries: AnthologyEntryListItem[] };
      setEntries(d.entries ?? []);
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
    void loadEntries(selectedRow.contentItemId);
  }, [selectedRow, loadEntries]);

  const selectAnthology = (contentItemId: string) => {
    /* 切文集 = 钻入到该文集(at=文集id),清掉 node(选中的条目) */
    const next = new URLSearchParams();
    next.set('at', contentItemId);
    setSearchParams(next, { replace: true });
  };

  /** 章节层 → 文集层(钻入式导航的"返回"):清空 URL,左栏自动切回文集列表 */
  const backToCollections = () => {
    setSearchParams({}, { replace: true });
  };

  const selectEntry = (entryContentItemId: string) => {
    if (!selectedContentItemId) return;
    const next = new URLSearchParams();
    next.set('at', selectedContentItemId);
    next.set('chapter', entryContentItemId);
    setSearchParams(next, { replace: true });
  };

  const handleCreateEntry = async (payload: NodeSubmitPayload) => {
    if (!selectedRow) return;
    const dto = payload.node as { name: string };
    try {
      const created = await structureApi.createNode({
        name: dto.name, type: 'DOC', scope: 'anthology', parentId: selectedRow.navId,
      });
      await Promise.all([loadEntries(selectedRow.contentItemId), loadList()]);
      setEntryModal({ open: false, mode: 'create' });
      if (created.contentItemId) {
        /* ?at=文集id 让编辑器返回时能定位到条目态(at=文集 & node=条目) */
        window.location.href = `/admin/anthology/${created.contentItemId}/edit?at=${selectedRow.contentItemId}`;
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
      {/* h-full + w-full:
       *  - Topbar 是 absolute right-3 top-3(不占布局空间),不该用 calc 减 topbar 高度
       *  - 父 wrapper 是 flex flex-1(100vh),main 用 h-full 撑满,aside footer 才能贴底
       *  - calc(100vh - 52) 会让 main 短 52px,footer 视觉上离 viewport 底有空隙——
       *    这就是用户看到的"footer 没贴底"老 bug */}
      <main className="flex h-full w-full overflow-hidden">
        {/* 左:钻入式渐进导航(笔记 AdminStructurePanel 同交互心智) + 卷宗气韵视觉
         *
         *  视图层级由 URL 推断:
         *    - 无 ?node= → 文集层(目录扉页:展示文集列表)
         *    - 有 ?node= → 章节层(展开该文集的目录页:展示章节列表,顶部《文集名》点击=返回)
         *    - 章节层 + ?entry= → 章节高亮(但中右栏 + 左栏列表都还在,只切高亮项)
         *
         *  卷宗感落地:
         *    - 全栏字体 var(--font-reading)(霞鹜文楷 LXGW 阅读体)
         *    - 顶部题签「文 集」/《文集名》二字间 letterSpacing 模拟全角空格
         *    - 题签下一根 1px 极淡墨线(扉页装饰)
         *    - 章节用中文数字「一/二/三」编号 + 全角空格 + 篇名
         *    - 选中态:仅字色加深 + font-medium,无 bg 块、无装饰条、无 hover bg(用户审美:任何 hover bg 都算"卡片动效")
         *    - 底部「新 作」/「新 篇」二字按钮,letterSpacing 同题签气韵
         *
         *  设计宪法对齐:无栏线分隔(右无 border-r);Tailwind 优先,CSS 变量必 inline;字号走 text-* token。 */}
        {/* 左:钻入式 + 大卡片视觉,基本布局对齐 /admin/notes 左栏(4 段)
         *  4 段结构(抄笔记):
         *    1. 顶部 px-5 pt-5 pb-1:h2 标题(text-base font-semibold) + 计数副信息(text-2xs ink-ghost)
         *    2. caption mt-3 px-5 pb-2:section 类别(text-2xs uppercase font-semibold)
         *    3. list flex-1 overflow-y-auto px-2.5 pb-4:大卡片列表
         *    4. footer flex items-center justify-between px-3 py-1.5:左[刷新] 右[新建]
         *  钻入态:
         *    - 顶部 h2 = 当前文集名;副信息 = "‹ 文集"(可点返回);caption = "条目"
         *  视觉:
         *    - 大卡片:rounded-lg px-3 py-2,双行(标题 text-base + 副信息 text-2xs)
         *    - active = bg-shelf + 标题 font-medium(用户认可的"卡片状")
         *    - hover **绝不变 bg**(严禁卡片动效) */}
        <aside
          className="flex shrink-0 flex-col overflow-hidden"
          style={{ width: '200px', background: 'var(--sidebar-bg)' }}
        >
          {/* (1) 顶部标题区 */}
          <div className="px-5 pt-5 pb-1">
            {selectedRow ? (
              <>
                <button
                  type="button"
                  onClick={backToCollections}
                  className="nav-item flex items-center gap-1 text-2xs transition-colors hover:text-[var(--ink)]"
                  style={{ color: 'var(--ink-ghost)', outline: 'none', WebkitTapHighlightColor: 'transparent' }}
                  aria-label="返回文集列表"
                >
                  <span>‹</span> 文集
                </button>
                {/* h2 文集名 可点 = 切回文集态(清 ?entry= 保留 ?node=);用户认知"想看文集就点这里" */}
                <button
                  type="button"
                  onClick={() => selectAnthology(selectedRow.contentItemId)}
                  className="nav-item mt-1 block w-full truncate text-left text-base font-semibold transition-colors hover:text-[var(--ink-faded)]"
                  style={{ color: 'var(--ink)', letterSpacing: '-0.01em', outline: 'none', WebkitTapHighlightColor: 'transparent' }}
                  aria-label="查看文集本身"
                >
                  {selectedRow.title || '无标题'}
                </button>
              </>
            ) : (
              <>
                <div
                  className="text-base font-semibold"
                  style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}
                >
                  文集
                </div>
                <div className="mt-1 text-2xs" style={{ color: 'var(--ink-ghost)' }}>
                  {rows.length} 部
                </div>
              </>
            )}
          </div>

          {/* (2) section caption */}
          <div className="mt-3 px-5 pb-2">
            <span
              className="text-2xs font-semibold uppercase"
              style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}
            >
              {selectedRow ? '条目' : '目录'}
            </span>
          </div>

          {/* (3) list area:大卡片 */}
          <div className="flex-1 overflow-y-auto px-2.5 pb-4">
            {selectedRow ? (
              /* 章节层 */
              entriesLoading ? (
                <LoadingState variant="inline" />
              ) : entries.length === 0 ? (
                <p className="px-2.5 py-2 text-2xs" style={{ color: 'var(--ink-ghost)' }}>
                  暂无条目
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {entries.map((entry) => {
                    const active = entry.nodeId === selectedEntryContentItemId;
                    const isPublished = !!entry.publishedVersionId;
                    const updateYmd = entry.updatedAt
                      ? new Date(entry.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
                      : '--';
                    return (
                      <li key={entry.nodeId}>
                        <button
                          type="button"
                          onClick={() => selectEntry(entry.nodeId)}
                          className="nav-item block w-full rounded-lg px-3 py-2 text-left focus:outline-none focus-visible:outline-none"
                          style={{
                            background: active ? 'var(--shelf)' : 'transparent',
                            outline: 'none',
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          <div
                            className="truncate text-base"
                            style={{
                              color: active ? 'var(--ink)' : 'var(--ink-light)',
                              fontWeight: active ? 500 : 400,
                            }}
                          >
                            {entry.title || '无标题'}
                          </div>
                          {/* 状态点(compact) + M/D 更新 — 紧凑信息行 */}
                          <div
                            className="mt-1 flex items-center gap-1.5 truncate text-2xs"
                            style={{ color: 'var(--ink-ghost)' }}
                          >
                            <StatusBadge
                              status={isPublished ? 'published' : 'committed'}
                              hasUnpublishedChanges={entry.hasUnpublishedChanges}
                              compact
                            />
                            <span>{updateYmd} 更新</span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              /* 文集层 */
              listLoading ? (
                <LoadingState variant="inline" />
              ) : listError ? (
                <p className="px-2.5 text-2xs" style={{ color: 'var(--danger)' }}>{listError}</p>
              ) : rows.length === 0 ? (
                <p className="px-2.5 py-2 text-2xs" style={{ color: 'var(--ink-ghost)' }}>
                  尚无文集
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
                          className="nav-item block w-full rounded-lg px-3 py-2 text-left focus:outline-none focus-visible:outline-none"
                          style={{
                            background: active ? 'var(--shelf)' : 'transparent',
                            outline: 'none',
                            WebkitTapHighlightColor: 'transparent',
                          }}
                        >
                          <div
                            className="truncate text-base"
                            style={{
                              color: active ? 'var(--ink)' : 'var(--ink-light)',
                              fontWeight: active ? 500 : 400,
                            }}
                          >
                            {row.title || '无标题'}
                          </div>
                          <div
                            className="mt-0.5 flex items-center gap-1.5 text-2xs"
                            style={{ color: 'var(--ink-ghost)' }}
                          >
                            <span>{row.entryCount} 篇</span>
                            <span>·</span>
                            <StatusBadge
                              status={row.status}
                              hasUnpublishedChanges={row.hasUnpublishedChanges}
                            />
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            )}
          </div>

          {/* (4) footer:[刷新] [新建] */}
          <div
            className="flex items-center justify-between px-3 py-1.5"
            style={{ borderTop: '0.5px solid var(--separator)' }}
          >
            <button
              type="button"
              onClick={() => selectedRow ? void loadEntries(selectedRow.contentItemId) : void loadList()}
              className="nav-item flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:text-[var(--ink)]"
              style={{ color: 'var(--ink-faded)' }}
            >
              刷新
            </button>
            <button
              type="button"
              onClick={() =>
                selectedRow
                  ? setEntryModal({ open: true, mode: 'create' })
                  : setModal({ open: true, mode: 'create' })
              }
              className="nav-item flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition-colors hover:text-[var(--ink)]"
              style={{ color: 'var(--ink)' }}
            >
              + 新建
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
 *   - 草稿        → 灰字「草稿」(默认,无点)
 *   - 已发布      → 小绿点 + 灰字「已发布」(success)
 *   - 有未发布改动 → 小红点 + 灰字「有未发布改动」(danger 语义)
 *   - compact 模式 → 只显示点,无文字(配合 ListRow 卡片副信息使用,节省空间);
 *                   草稿无文字时显示灰点,保持有形可视。 */
function StatusBadge({ status, hasUnpublishedChanges, compact }: {
  status: 'committed' | 'published';
  hasUnpublishedChanges: boolean;
  compact?: boolean;
}) {
  if (compact) {
    const bg =
      status !== 'published' ? 'var(--ink-ghost)' :
      hasUnpublishedChanges ? 'var(--danger)' :
      'var(--success)';
    const label =
      status !== 'published' ? '草稿' :
      hasUnpublishedChanges ? '有未发布改动' : '已发布';
    return (
      <span
        className="inline-block size-1.5 shrink-0 rounded-full"
        style={{ background: bg }}
        title={label}
        aria-label={label}
      />
    );
  }
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

/* chineseNumeral 已退役(卷宗气韵改卡片视觉后,章节列表不再用中文编号)。 */

function EmptyHint() {
  /* w-full 必须:父级是横向 flex 容器,默认 flex item 宽是内容自然宽,
   * 不撑满 → 内部 items-center 没法水平居中。这个 bug 反复栽,记在 [[feedback_flex_item_full_width]]. */
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2">
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
