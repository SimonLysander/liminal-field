import { PlateElement } from 'platejs/react';
import type { PlateElementProps } from 'platejs/react';
import { ProposalActions } from './proposal-actions';
import { useProposalElementActive } from './use-proposal-element-active';

/**
 * ProposalNewElement —— AI 提议的新段落渲染器。
 *
 * 视觉:绿底,左边线绿色,**内部底部独立一行 ✓✗ 按钮**(代表整个 hunk 的接受/拒绝)。
 * 与 ProposalOldElement 配对显示在原文下方(由 applyProposalToEditor 控制顺序)。
 * 一个 hunk 一对按钮(挂在绿块上),不在 old 块上重复。
 *
 * active 高亮:当前聚焦 hunk(快捷键 Y/N 操作目标)左边线变粗 + box-shadow 强调,
 * inactive hunk 半透明削弱。点击区域可切焦点(setActiveHunkId)。
 */
export function ProposalNewElement(props: PlateElementProps) {
  const hunkId = (props.element as { hunkId?: string }).hunkId;
  const { ref, isActive } = useProposalElementActive(hunkId);
  return (
    <PlateElement
      {...props}
      ref={ref}
      className="proposal-new-block"
      style={{
        position: 'relative',
        // 新增/提议 = accent(长春花紫),跟项目主题色 + 接受按钮统一;
        // 绿色专留"已发布/成功",不在 diff 里用(否则语义打架)
        background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
        borderLeft: isActive
          ? '4px solid var(--accent)'
          : '2px solid var(--accent)',
        padding: '4px 12px 6px 12px',
        margin: '4px 0',
        boxShadow: isActive ? '0 0 0 1.5px var(--accent)' : 'none',
        opacity: isActive ? 1 : 0.78,
        transition: 'opacity 120ms ease, box-shadow 120ms ease',
      }}
      data-hunk-id={hunkId}
    >
      {props.children}
      <ProposalActions hunkId={hunkId} />
    </PlateElement>
  );
}
