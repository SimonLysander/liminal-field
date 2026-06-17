/**
 * BlockMenuKit — Plate plugin 给每个顶层块挂 hover affordance
 *
 * 设计：用 render.aboveNodes（RenderNodeWrapper），外包一层 group 容器 → CSS hover 让 ⋮⋮ 浮现。
 * 只处理顶层块（path.length === 1），嵌套块（列表项内的段落、引用内的段落）不挂。
 *
 * API 说明：RenderNodeWrapper 是"高阶"形式：
 *   外层函数 (outerProps) → 返回一个 (elementProps) => ReactNode | undefined
 * readOnly 检查用 editor.dom.readOnly（与 block-draggable.tsx 一致）。
 * JSX 部分（createBlockMenuNodeWrapper）在 block-menu.tsx，此文件是纯 .ts 无 JSX，
 * 避免 react-refresh/only-export-components 对非组件导出报错。
 */

import { createPlatePlugin } from 'platejs/react';
import type { TElement } from 'platejs';
import type { RenderNodeWrapper } from 'platejs/react';

import { createBlockMenuNodeWrapper } from '@/components/ui/block-menu';

/**
 * BlockMenuWrapper — 满足 RenderNodeWrapper 签名：
 *   (outerProps) => (elementProps) => ReactNode | undefined
 *
 * 外层检查条件（顶层、非 readOnly），返回渲染函数；否则返回 undefined 跳过包裹。
 */
const BlockMenuWrapper: RenderNodeWrapper = ({ editor, element, path }) => {
  // 嵌套块跳过（避免列表项内段落也长 ⋮⋮）
  if (!path || path.length !== 1) return undefined;
  // readOnly 时不渲染 affordance
  if (editor.dom.readOnly) return undefined;

  return createBlockMenuNodeWrapper(path, element as TElement);
};

export const BlockMenuPlugin = createPlatePlugin({
  key: 'block-menu',
  render: {
    aboveNodes: BlockMenuWrapper,
  },
});

export const BlockMenuKit = [BlockMenuPlugin];
