import { PlateElement } from 'platejs/react';
import type { PlateElementProps } from 'platejs/react';
import { ProposalActions } from './proposal-actions';

/**
 * ProposalNewElement —— AI 提议的新段落渲染器。
 *
 * 视觉:绿底,左边线绿色,内嵌右侧浮 ✓✗。
 * 与 ProposalOldElement 配对显示在原文下方(由 applyProposalToEditor 控制顺序)。
 */
export function ProposalNewElement(props: PlateElementProps) {
  const hunkId = (props.element as { hunkId?: string }).hunkId;
  return (
    <PlateElement
      {...props}
      className="proposal-new-block"
      style={{
        position: 'relative',
        background: 'color-mix(in srgb, var(--mark-green, #3F9D57) 18%, transparent)',
        borderLeft: '2px solid var(--mark-green, #3F9D57)',
        padding: '2px 8px',
        margin: '4px 0',
      }}
      data-hunk-id={hunkId}
    >
      {props.children}
      <ProposalActions hunkId={hunkId} />
    </PlateElement>
  );
}
