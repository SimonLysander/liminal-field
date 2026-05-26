import { cva } from 'class-variance-authority';

/**
 * 行内 suggestion 痕迹样式。两种导出并存:
 *
 * - inlineSuggestionClass(文本 leaf 用,主路径):直接固定 class,SuggestionLeaf 按 type 选
 *   insert / remove。**为什么不用 data-attribute selector**:PlateLeaf 不会把任意 data-* 透传到
 *   它实际渲染、带 className 的 DOM 元素,靠 `data-[inline-suggestion=...]:` 触发的 class 在 leaf
 *   上永不匹配 → 痕迹全黑无色。固定 class 与能正常上色的 HighlightLeaf / CodeLeaf 同模式。
 * - inlineSuggestionVariants(data-attribute,equation 等 element 节点沿用 platejs 模板):cva 生成
 *   `data-[inline-suggestion=...]:` 条件 class,仅当宿主元素自身挂了 data-inline-suggestion 才生效。
 *   保留以兼容 equation-node 模板,勿删。
 *
 * 颜色走 token(var(--mark-green)/var(--mark-red)),随 daylight / midnight 主题切换。
 * text-decoration-skip-ink:none —— 删除线 / 下划线穿过下沉笔画(g、p)不跳过,diff 完整可见。
 *
 * - insert(绿):浅绿底 + 绿字 + 绿下划线,强调「新增」
 * - remove(红):浅红底 + 红字 + 红删除线,强调「删除」
 */
const base = 'rounded-[2px] px-[2px] decoration-2 [text-decoration-skip-ink:none]';

export const inlineSuggestionClass = {
  insert: `${base} underline bg-[color-mix(in_srgb,var(--mark-green)_14%,transparent)] text-[var(--mark-green)] decoration-[var(--mark-green)]`,
  remove: `${base} line-through bg-[color-mix(in_srgb,var(--mark-red)_14%,transparent)] text-[var(--mark-red)] decoration-[var(--mark-red)]`,
} as const;

export const inlineSuggestionVariants = cva(
  [
    'rounded-[2px] px-[2px] decoration-2 [text-decoration-skip-ink:none]',
    'data-[inline-suggestion=insert]:bg-[color-mix(in_srgb,var(--mark-green)_14%,transparent)]',
    'data-[inline-suggestion=insert]:text-[var(--mark-green)]',
    'data-[inline-suggestion=insert]:underline',
    'data-[inline-suggestion=insert]:decoration-[var(--mark-green)]',
    'data-[inline-suggestion=remove]:bg-[color-mix(in_srgb,var(--mark-red)_14%,transparent)]',
    'data-[inline-suggestion=remove]:text-[var(--mark-red)]',
    'data-[inline-suggestion=remove]:line-through',
    'data-[inline-suggestion=remove]:decoration-[var(--mark-red)]',
  ].join(' '),
);
