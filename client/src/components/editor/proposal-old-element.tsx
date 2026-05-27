import { PlateElement } from 'platejs/react';
import type { PlateElementProps } from 'platejs/react';

/**
 * ProposalOldElement —— 被替换或被删除的旧段落渲染器。
 *
 * 视觉:红底 + line-through,左边线红色。
 * **不渲染 ProposalActions**(接受/拒绝按钮只在配对的 proposal-new 块下方一对,
 * 避免一个 hunk 渲染 4 个按钮的冗余)。
 *
 * 节点属性 `hunkId` 仍存到 element,供 controller 反查节点。
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
        padding: '4px 12px',
        margin: '4px 0',
        textDecoration: 'line-through',
        textDecorationColor: 'var(--mark-red, #D24B3E)',
      }}
      data-hunk-id={hunkId}
    >
      {props.children}
    </PlateElement>
  );
}
