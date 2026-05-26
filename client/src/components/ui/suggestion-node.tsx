'use client';

/**
 * SuggestionLeaf —— SuggestionPlugin 的行内 leaf 渲染器。
 *
 * 为什么需要它(踩过的坑):
 *   @platejs/suggestion 的 BaseSuggestionPlugin 在 node.isLeaf=true 上把 diff 数据写到 leaf
 *   节点上(key 形如 `suggestion_<id>`,值 = { type: 'insert' | 'remove' | 'update', ... }),
 *   但**不带任何渲染组件**。不配 component,痕迹数据在树里存在(accept/reject 能跑),但
 *   视觉完全看不见。
 *
 * 上色用【直接固定 className】(inlineSuggestionClass)、不用 data-attribute selector:
 *   PlateLeaf 不会把任意 data-* 透传到它实际渲染的 DOM 元素,靠 `data-[...]:` 触发的 class
 *   永不匹配 → 全黑。与 HighlightLeaf / CodeLeaf 同模式,按 type 选 insert/remove 一组 class。
 *
 * insert / remove 之外的 type(update / replace):
 *   落默认(无样式),不强行涂色误导。diffToSuggestions 对常规文本 diff 主要产 insert + remove。
 */

import type { PlateLeafProps } from 'platejs/react';

import { PlateLeaf } from 'platejs/react';
import { getInlineSuggestionData } from '@platejs/suggestion';

import { inlineSuggestionClass } from '@/lib/suggestion';

export function SuggestionLeaf(props: PlateLeafProps) {
  // leaf 上的 suggestion_<id> 数据:包含 type / userId / createdAt
  // 类型断言:getInlineSuggestionData 要求 TSuggestionText,PlateLeafProps.leaf 是宽松 TText
  const data = getInlineSuggestionData(props.leaf as never);
  // 只把 insert / remove 映射到视觉(其它 type 落默认无样式,不强行涂色误导)
  const className =
    data?.type === 'insert'
      ? inlineSuggestionClass.insert
      : data?.type === 'remove'
        ? inlineSuggestionClass.remove
        : undefined;

  return (
    <PlateLeaf {...props} className={className}>
      {props.children}
    </PlateLeaf>
  );
}
