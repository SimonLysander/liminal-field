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

  /** 章节层 → 文集层(钻入式导航的"返回"):清空 URL,左栏自动切回文集列表 */
  const backToCollections = () => {
    setSearchParams({}, { replace: true });
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
        <aside
          className="flex shrink-0 flex-col"
          style={{
            width: '200px',
            background: 'var(--sidebar-bg)',
            fontFamily: 'var(--font-reading)',
          }}
        >
          {/* 顶部题签:文集层=「文 集」(letterSpacing 模拟空格);章节层=《文集名》(可点返回) */}
          <div className="shrink-0 px-5 pt-7 pb-3">
            {selectedRow ? (
              <button
                type="button"
                onClick={backToCollections}
                className="block w-full truncate text-left text-base transition-colors hover:text-[var(--ink-faded)]"
                style={{ color: 'var(--ink)', fontFamily: 'inherit' }}
                aria-label="返回文集列表"
              >
                《{selectedRow.title || '无标题'}》
              </button>
            ) : (
              <h2
                className="text-base"
                style={{ color: 'var(--ink)', letterSpacing: '0.5em' }}
              >
                文集
              </h2>
            )}
            {/* 扉页装饰线:不是栏分隔,只是题签下方一笔 */}
            <div className="mt-2 h-px" style={{ background: 'var(--separator)' }} />
          </div>

          {/* 列表区:文集层 or 章节层,二者只渲染一个 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {selectedRow ? (
              /* ── 章节层 ── */
              entriesLoading ? (
                <LoadingState variant="inline" />
              ) : entries.length === 0 ? (
                <p className="py-2 text-sm" style={{ color: 'var(--ink-ghost)' }}>
                  暂无篇章
                </p>
              ) : (
                <ul className="space-y-3">
                  {entries.map((entry, i) => {
                    const active = entry.contentItemId === selectedEntryContentItemId;
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => entry.contentItemId && selectEntry(entry.contentItemId)}
                          className="block w-full truncate text-left text-sm transition-colors"
                          style={{
                            color: active ? 'var(--ink)' : 'var(--ink-faded)',
                            fontWeight: active ? 600 : 400,
                            fontFamily: 'inherit',
                            lineHeight: 1.6,
                          }}
                        >
                          {/* 中文数字编号 + 篇名(1em margin-left 模拟全角空格,避开 lint
                            *  对 U+3000 的 no-irregular-whitespace 报错) */}
                          <span style={{ fontWeight: active ? 700 : 600, color: active ? 'var(--ink)' : 'var(--ink-light)' }}>
                            {chineseNumeral(i + 1)}
                          </span>
                          <span style={{ marginLeft: '1em' }}>{entry.name || '无标题'}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              /* ── 文集层 ── */
              listLoading ? (
                <LoadingState variant="inline" />
              ) : listError ? (
                <p className="py-2 text-sm" style={{ color: 'var(--danger)' }}>{listError}</p>
              ) : rows.length === 0 ? (
                <p className="py-2 text-sm" style={{ color: 'var(--ink-ghost)' }}>
                  尚无文集
                </p>
              ) : (
                <ul className="space-y-3">
                  {rows.map((row) => (
                    <li key={row.contentItemId}>
                      <button
                        type="button"
                        onClick={() => selectAnthology(row.contentItemId)}
                        className="flex w-full items-center justify-between gap-2 text-left text-sm transition-colors hover:text-[var(--ink)]"
                        style={{
                          color: 'var(--ink-light)',
                          fontFamily: 'inherit',
                          lineHeight: 1.6,
                        }}
                      >
                        <span className="min-w-0 truncate">
                          {row.title || '无标题'}
                        </span>
                        {/* 钻入暗示:一个小三角,极淡 */}
                        <span className="shrink-0 text-2xs" style={{ color: 'var(--ink-ghost)' }}>
                          ▸
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>

          {/* footer:文集层=「新 作」,章节层=「新 篇」。letterSpacing 同题签气韵 */}
          <div className="shrink-0 px-5 py-4">
            <button
              type="button"
              onClick={() =>
                selectedRow
                  ? setEntryModal({ open: true, mode: 'create' })
                  : setModal({ open: true, mode: 'create' })
              }
              className="block w-full text-sm transition-colors hover:text-[var(--ink)]"
              style={{
                color: 'var(--ink-faded)',
                fontFamily: 'inherit',
                letterSpacing: '0.5em',
                textAlign: 'center',
              }}
            >
              {selectedRow ? '新篇' : '新作'}
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

/** 中文数字 1..99(99 后回落到阿拉伯)。卷宗气韵:章节编号"一/二/三/十一/二十一"古朴。 */
const ZH_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function chineseNumeral(n: number): string {
  if (n < 0) return String(n);
  if (n < 10) return ZH_DIGITS[n];
  if (n === 10) return '十';
  if (n < 20) return '十' + ZH_DIGITS[n - 10];
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return ZH_DIGITS[tens] + '十' + (ones === 0 ? '' : ZH_DIGITS[ones]);
  }
  return String(n);
}

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
