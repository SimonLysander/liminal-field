/*
 * ContentAdmin — 笔记/文集内容管理模块(壳子共享,scope 决定数据源)
 *
 * 布局：AdminStructurePanel（面包屑钻入列表）+ 中间内容预览 + 右侧上下文面板。
 * AdminShell 提供外层容器（h-screen + IconRail），本组件只负责内容区域。
 * scope:'notes'(默认,笔记 admin) / 'anthology'(文集 admin)——影响 URL 路径、
 * 数据源(structureApi 的 scope 过滤)、文案、跳转编辑路径、移动对话框等。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
// 编辑页跳转统一用 window.location.href（Plate inputRules 在 SPA 导航后不生效）
import { smoothBounce } from '@/lib/motion';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ContentVersionView } from '../components/ContentVersionView';
import { FormalSidePanel } from '../components/FormalSidePanel';
import { NodeFormModal } from '../components/NodeFormModal';
import { AdminStructurePanel } from '../components/AdminStructurePanel';
import { MoveToDialog } from '../components/MoveToDialog';
import { useAdminWorkspace } from '../hooks/useAdminWorkspace';
import { structureApi } from '@/services/structure';
import { useConfirm } from '@/contexts/ConfirmContext';
import { banner } from '@/components/ui/banner-api';

interface ContentAdminProps {
  scope?: 'notes' | 'anthology';
}

const ContentAdmin = ({ scope = 'notes' }: ContentAdminProps = {}) => {
  const workspace = useAdminWorkspace({ scope });
  const confirm = useConfirm();
  /* 选中节点的恢复由 useAdminWorkspace 的 URL 同步处理 */

  /* 节点同质化:右侧统一展示"当前节点"——选中的文档,或进入的文件夹本身;两者都是一篇笔记。 */
  const activeNode = workspace.selectedNode ?? workspace.currentFolderNode;

  /* 发布全部:对有子节点的节点,发布其子树(从 ··· 菜单触发)。 */
  const handlePublishAll = useCallback(async () => {
    if (!activeNode) return;
    const ok = await confirm({
      title: '发布全部',
      message: `将发布「${activeNode.name}」下的全部文档。`,
      confirmLabel: '确认发布',
    });
    if (!ok) return;
    await structureApi.batchPublish(activeNode.id);
    banner.success('已发布');
    workspace.reloadLevel();
    if (activeNode.contentItemId) {
      void workspace.loadFormalContent(activeNode.contentItemId);
    }
  }, [activeNode, confirm, workspace]);

  /* ---- TOC ----
   * 数据：来自 API 返回的 headings（formalContent 或 preview），不再解析 markdown
   * 交互：scroll spy + 点击跳转用 DOM ref（按索引定位，不匹配 ID）
   */
  const previewRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(-1);

  type TocEntry = { level: number; text: string; index: number };
  const headings = workspace.preview?.headings ?? workspace.formalContent.headings;
  const toc = useMemo<TocEntry[]>(
    () => headings.map((h, i) => ({ level: h.level, text: h.text, index: i })),
    [headings],
  );
  const latestHistoryEntry = useMemo(
    () => workspace.history.find(
      (entry) => entry.versionId === workspace.formalContent.latestVersion.versionId,
    ),
    [workspace.formalContent.latestVersion.versionId, workspace.history],
  );
  const canEditSummary = !!latestHistoryEntry && (latestHistoryEntry.source ?? 'user') === 'user';

  /** 获取预览区内所有 heading DOM 元素 */
  const getHeadingEls = useCallback(
    () => previewRef.current?.querySelectorAll<HTMLElement>('[data-heading-id]'),
    [],
  );

  /* Scroll spy */
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

  /* 点击跳转 + 高亮 */
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

  const editUrl = activeNode?.contentItemId
    ? `/admin/${scope}/${activeNode.contentItemId}/edit`
    : null;

  /* 学习入口：LearningProject 已删，学习视图按需访问即可，不再查询项目是否存在。
   * learnUrl 有值即显示「开始学习」入口；learningExists 固定 false（无"继续"区分）。
   * 仅 notes scope 有此入口（文集不学习）。
   * :id = 主题 NavigationNode id（学习页按它拉子节点=篇目;非 contentItemId）。 */
  const learningRootId = scope === 'notes' ? activeNode?.id : undefined;
  const learningExists = false;
  const learnUrl = learningRootId ? `/admin/notes/${learningRootId}/learn` : null;

  /* 侧栏顶部标题随 scope 切换:笔记 admin="笔记",文集 admin="文集"。 */
  const sectionTitle = scope === 'notes' ? '笔记' : '文集';

  return (
    <>
      {/* 面包屑钻入导航面板 */}
      <AdminStructurePanel
        nodes={workspace.nodes}
        loading={workspace.loading}
        error={workspace.error}
        selectedNodeId={workspace.selectedNode?.id ?? null}
        breadcrumb={workspace.breadcrumb}
        currentParentId={workspace.currentParentId}
        sectionTitle={sectionTitle}
        onReload={workspace.reloadLevel}
        onEnterFolder={workspace.enterFolder}
        onSelectNode={workspace.selectNode}
        onGoToBreadcrumb={workspace.goToBreadcrumb}
        // 底部"新建"在当前层级下建子页面:带上当前层级的完整路径(面包屑),让弹窗说明"在 X 下创建"。
        onAddChild={(pid) => workspace.openCreate(pid, workspace.breadcrumb.map((b) => b.name).join(' / '))}
        onReorder={workspace.reorderNodes}
      />

      {/* Main content area */}
      <main
        className="relative z-0 flex flex-1 flex-col overflow-hidden"
        style={{ background: 'var(--paper)' }}
      >
        <div className="flex flex-1 overflow-hidden">
          {/* Center — content preview */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div
              className="flex-1 overflow-y-auto px-10 py-9 max-[520px]:px-4"
              ref={previewRef}
            >
              <div className="mx-auto w-full max-w-[var(--layout-reading-max)]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeNode?.id ?? 'empty'}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -2 }}
                  transition={{ duration: 0.2, ease: smoothBounce }}
                >
                  {activeNode?.contentItemId ? (
                    <ContentVersionView
                      node={activeNode}
                      content={workspace.formalContent}
                      loading={workspace.contentLoading}
                      error={workspace.contentError}
                      preview={workspace.preview}
                      previewLoading={workspace.previewLoading}
                      canEditSummary={canEditSummary}
                      onSaveSummary={workspace.updateSummary}
                      onReload={() => workspace.loadFormalContent(activeNode.contentItemId!)}
                      onPublish={workspace.publishContent}
                      onUnpublish={workspace.unpublishContent}
                      onExitPreview={workspace.exitPreview}
                      onPublishPreview={workspace.publishPreview}
                      onEdit={workspace.openEdit}
                      onDelete={workspace.setDeleteTarget}
                      onMoveTo={workspace.setMoveTarget}
                      onAddChild={(n) =>
                        workspace.openCreate(
                          n.id,
                          // 完整路径:面包屑(到当前层)+ 选中的是子节点时再加它自己。
                          // (若 n 就是当前进入的文件夹,面包屑末端已含它,不重复加)
                          [
                            ...workspace.breadcrumb.map((b) => b.name),
                            ...(workspace.selectedNode?.id === n.id ? [n.name] : []),
                          ].join(' / '),
                        )
                      }
                      onPublishAll={activeNode.hasChildren ? handlePublishAll : undefined}
                    />
                  ) : (
                    <EmptyState title="未选择节点" subtitle="从左侧选择一个节点开始。" />
                  )}
                </motion.div>
              </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Right — contextual side panel */}
          <aside
            className="flex shrink-0 flex-col overflow-hidden px-5 py-7"
            style={{ width: 'var(--layout-context)' }}
          >
            {activeNode?.contentItemId ? (
              <FormalSidePanel
                toc={toc}
                activeIndex={activeIndex}
                onScrollToHeading={scrollToHeading}
                draftPresence={workspace.draftPresence}
                history={workspace.history}
                historyLoading={workspace.historyLoading}
                publishedVersionId={workspace.formalContent.publishedVersion?.versionId ?? null}
                activeVersionId={workspace.preview?.versionId ?? null}
                onEditDraft={() => {
                  if (editUrl) window.location.href = editUrl;
                }}
                onSelectVersion={workspace.previewVersion}
                learningExists={learningExists}
                onEnterLearning={() => {
                  // 整页导航(同编辑页):学习视图自带 Plate 编辑器,SPA 软导航会让 inputRules 失效
                  if (learnUrl) window.location.href = learnUrl;
                }}
              />
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
                  选择文档查看详情
                </p>
              </div>
            )}
          </aside>
        </div>
      </main>

      {/* Modals */}
      {workspace.modal.open && (
        <NodeFormModal
          modal={workspace.modal}
          onClose={workspace.closeModal}
          onSubmit={workspace.handleCreateOrEdit}
          scope={scope}
        />
      )}
      {workspace.deleteTarget && (
        <ConfirmDialog
          node={workspace.deleteTarget}
          onConfirm={workspace.handleDelete}
          onCancel={() => workspace.setDeleteTarget(null)}
        />
      )}
      {workspace.moveTarget && (
        <MoveToDialog
          node={workspace.moveTarget}
          scope={scope}
          onConfirm={(targetFolderId) =>
            workspace.moveNodeToFolder(workspace.moveTarget!.id, targetFolderId)
          }
          onClose={() => workspace.setMoveTarget(null)}
        />
      )}
    </>
  );
};

/* ---------- Shared primitives ---------- */

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24">
      <div className="text-base font-medium" style={{ color: 'var(--ink-ghost)' }}>{title}</div>
      <p className="mt-2 text-sm" style={{ color: 'var(--ink-ghost)', opacity: 0.6 }}>{subtitle}</p>
    </div>
  );
}

export default ContentAdmin;
