import { PlateElement } from 'platejs/react';
import type { PlateElementProps } from 'platejs/react';
import { ProposalActions } from './proposal-actions';

/**
 * ProposalOldElement —— 被替换或被删除的旧段落渲染器。
 *
 * 视觉:红底 + line-through,左边线红色,内嵌右侧浮 ✓✗。
 * 节点属性 `hunkId` 用于按钮回调时找回对应的 hunk。
 */
export function ProposalOldElement(props: PlateElementProps) {
  const hunkId = (props.element as { hunkId?: string }).hunkId;
  return (
    <PlateElement
      {...props}
      className="proposal-old-block"
      style={{
        position: 'relative',
        background: 'color-mix(in srgb, var(--mark-red, #D24B3E) 18%, transparent)',
        borderLeft: '2px solid var(--mark-red, #D24B3E)',
        padding: '2px 8px',
        margin: '4px 0',
        textDecoration: 'line-through',
        textDecorationColor: 'var(--mark-red, #D24B3E)',
      }}
      data-hunk-id={hunkId}
    >
      {props.children}
      <ProposalActions hunkId={hunkId} />
    </PlateElement>
  );
}
