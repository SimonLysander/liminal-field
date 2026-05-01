/**
 * 图标尺寸预设 — 与设计系统 §7 对齐。
 * 全局统一使用这些预设，禁止散写 size/strokeWidth。
 */
export const ICON = {
  sm:      { size: 14, strokeWidth: 1.5 },
  md:      { size: 16, strokeWidth: 1.5 },
  lg:      { size: 20, strokeWidth: 1.5 },
  xl:      { size: 24, strokeWidth: 1.2 },
  display: { size: 32, strokeWidth: 1.0 },
} as const;
