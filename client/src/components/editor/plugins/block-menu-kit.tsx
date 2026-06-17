/**
 * BlockMenuKit — Plate plugin 给每个顶层块挂 hover affordance
 *
 * 设计：用 render.aboveNodes（RenderNodeWrapper），外包一层 group 容器 → CSS hover 让 ⋮⋮ 浮现。
 * 只处理顶层块（path.length === 1），嵌套块（列表项内的段落、引用内的段落）不挂。
 *
 * API 说明：RenderNodeWrapper 是"高阶"形式：
 *   外层函数 (outerProps) → 返回一个 (elementProps) => ReactNode | undefined
 * readOnly 检查用 editor.dom.readOnly（与 block-draggable.tsx 一致）。
 *
 * 重构说明：createBlockMenuNodeWrapper 从 block-menu.tsx 移入此文件并设为私有。
 * 内部符号全用 camelCase（非 PascalCase），使 react-refresh/only-export-components
 * 不将其识别为组件，从而让 allowConstantExport: true 覆盖唯一导出（BlockMenuKit 常量），
 * 无需在 eslint.config.js 中维护 allowExportNames 例外条目。
 */

import { createPlatePlugin } from 'platejs/react';
import type { Path, TElement } from 'platejs';
import type { PlateElementProps, RenderNodeWrapper } from 'platejs/react';

import { BlockMenu } from '@/components/ui/block-menu';

/**
 * makeBlockMenuWrapper — 顶层块的 group 外壳工厂，供 aboveNodes 回调使用。
 * 私有：仅在此文件内被 blockMenuAboveNodes 调用，不对外导出。
 * 接受固定的 blockPath / blockNode，返回符合 RenderNodeWrapper 内层签名的渲染函数。
 * 使用 camelCase 命名，避免 react-refresh 将其识别为组件。
 */
function makeBlockMenuWrapper(blockPath: Path, blockNode: TElement) {
  return function renderBlockMenuWrapper({ children }: PlateElementProps) {
    return (
      <div className="group relative">
        {/* 定位到块左侧，contentEditable=false 避免编辑器把点击当文本操作 */}
        <div
          className="absolute -left-7 top-1 select-none"
          contentEditable={false}
        >
          <BlockMenu blockPath={blockPath} blockNode={blockNode} />
        </div>
        {children}
      </div>
    );
  };
}

/**
 * blockMenuAboveNodes — 满足 RenderNodeWrapper 签名：
 *   (outerProps) => (elementProps) => ReactNode | undefined
 *
 * 外层检查条件（顶层、非 readOnly），返回渲染函数；否则返回 undefined 跳过包裹。
 * camelCase 命名，避免 react-refresh 将其识别为组件导出。
 */
const blockMenuAboveNodes: RenderNodeWrapper = ({ editor, element, path }) => {
  // 嵌套块跳过（避免列表项内段落也长 ⋮⋮）
  if (!path || path.length !== 1) return undefined;
  // readOnly 时不渲染 affordance
  if (editor.dom.readOnly) return undefined;

  return makeBlockMenuWrapper(path, element as TElement);
};

const blockMenuPlugin = createPlatePlugin({
  key: 'block-menu',
  render: {
    aboveNodes: blockMenuAboveNodes,
  },
});

export const BlockMenuKit = [blockMenuPlugin];
