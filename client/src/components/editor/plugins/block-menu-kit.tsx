/* eslint-disable react-refresh/only-export-components --
 * 本文件仅 export 一个 const 数组 BlockMenuKit；内部 BlockMenuRow 是合法的
 * React 组件（需要 PascalCase 才能调 useState、命中 react-hooks/rules-of-hooks）。
 * react-refresh 规则会误把内部 PascalCase 视作"组件 + 非组件"混合，HMR 对本文件
 * 失效在所难免——但本文件改动频度极低、HMR 失效不影响开发体验，故局部禁用此规则。
 */

/**
 * BlockMenuKit — Plate plugin 给每个顶层块挂 hover affordance
 *
 * 设计：用 render.aboveNodes（RenderNodeWrapper），外包一层 group 容器 → CSS hover 让 ⋮⋮ 浮现。
 * 只处理顶层块（path.length === 1），嵌套块（列表项内的段落、引用内的段落）不挂。
 *
 * 块菜单 open 态：BlockMenuRow 持有 useState menuOpen，传给 BlockMenu 受控，
 * 同时给容器加 selected 背景 → 用户在弹窗里翻菜单时清楚知道在操作哪个块。
 *
 * API 说明：RenderNodeWrapper 是"高阶"形式：
 *   外层函数 (outerProps) → 返回一个 (elementProps) => ReactNode | undefined
 * readOnly 检查用 editor.dom.readOnly（与 block-draggable.tsx 一致）。
 */

import { useState } from 'react';
import { createPlatePlugin } from 'platejs/react';
import type { Path, TElement } from 'platejs';
import type { PlateElementProps, RenderNodeWrapper } from 'platejs/react';

import { BlockMenu } from '@/components/ui/block-menu';

/**
 * BlockMenuRow — 顶层块的渲染容器，承载 hover affordance + 菜单 open 高亮。
 * 私有（不导出）：仅由 blockMenuAboveNodes 引用。
 * PascalCase 以满足 react-hooks/rules-of-hooks（useState 必须在合法 React 组件里调）。
 */
function BlockMenuRow({
  blockPath,
  blockNode,
  children,
}: {
  blockPath: Path;
  blockNode: TElement;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      className={`group relative rounded-md transition-colors duration-150 ${
        menuOpen ? 'bg-[var(--hover-overlay)]' : ''
      }`}
    >
      {/* 定位到块左侧，contentEditable=false 避免编辑器把点击当文本操作 */}
      <div
        className="absolute -left-7 top-1 select-none"
        contentEditable={false}
      >
        <BlockMenu
          blockPath={blockPath}
          blockNode={blockNode}
          open={menuOpen}
          onOpenChange={setMenuOpen}
        />
      </div>
      {children}
    </div>
  );
}

/**
 * blockMenuAboveNodes — 满足 RenderNodeWrapper 签名：
 *   (outerProps) => (elementProps) => ReactNode | undefined
 *
 * 外层检查条件（顶层、非 readOnly），返回渲染函数；否则返回 undefined 跳过包裹。
 * 渲染函数把逻辑委托给 BlockMenuRow（真正的 React 组件，可以 useState）。
 * camelCase 命名，避免 react-refresh 将其识别为组件导出。
 */
const blockMenuAboveNodes: RenderNodeWrapper = ({ editor, element, path }) => {
  // 嵌套块跳过（避免列表项内段落也长 ⋮⋮）
  if (!path || path.length !== 1) return undefined;
  // readOnly 时不渲染 affordance
  if (editor.dom.readOnly) return undefined;

  return function renderBlockMenuWrapper({ children }: PlateElementProps) {
    return (
      <BlockMenuRow blockPath={path} blockNode={element as TElement}>
        {children}
      </BlockMenuRow>
    );
  };
};

const blockMenuPlugin = createPlatePlugin({
  key: 'block-menu',
  render: {
    aboveNodes: blockMenuAboveNodes,
  },
});

export const BlockMenuKit = [blockMenuPlugin];
