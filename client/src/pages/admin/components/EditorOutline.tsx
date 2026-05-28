/**
 * EditorOutline — 编辑器大纲面板(笔记/文集编辑器共用)。
 *
 * 新布局(2026-05-28)挪到左侧栏 [2,1] cell,内部不再渲染 "大纲" 标题——
 * label 已挪到 [1,1] 顶栏(跟返回按钮一组,符合 Notion 派各栏独立顶栏)。
 *
 * 列表高度跟随内容、超 61.8vh 才滚动;左侧细线从顶起、长度随内容;
 * 仅可滚动时上下边缘渐隐(useScrollFade);当前阅读标题高亮(activeIndex)。
 */

import { useEffect, useRef } from 'react';
import { useScrollFade } from '@/hooks/use-scroll-fade';
import type { HeadingEntry } from '../lib/markdown-toc';

export function EditorOutline({
  headings,
  onJump,
  activeIndex,
}: {
  headings: HeadingEntry[];
  /** 点击大纲项跳转到对应标题(按出现顺序的 index) */
  onJump: (index: number) => void;
  /** 当前滚到的标题 index(scroll-spy),用于高亮;未提供则不高亮 */
  activeIndex?: number;
}) {
  const navRef = useRef<HTMLElement>(null);
  // 仅在列表可滚动时才渐隐上下缘,内容随项数变化时重算
  const mask = useScrollFade(navRef, [headings.length]);
  const hasHeadings = headings.length > 0;

  // 当前标题变化时,把激活项滚进大纲可视区(与展示端阅读大纲一致)
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || activeIndex == null) return;
    const el = nav.querySelector(`[data-h-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <div className="flex shrink-0 flex-col self-start px-3 pt-2">
      {/* 列表高度跟随内容、超上限才滚;左侧细线 = 标题列表的"书脊",从顶起、长度随内容。
          空状态不画线:没有标题就没有结构可代表;且占位文案的 py-6 会把书脊撑到 ~65px,
          让一条线浮在一行小字旁(线包住的是 padding 不是文字),显得突兀 —— 故仅有标题时才画。 */}
      <nav
        ref={navRef}
        className="overflow-y-auto"
        style={{
          maxHeight: '61.8vh',
          borderLeft: hasHeadings ? '1px solid var(--separator)' : 'none',
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      >
        {!hasHeadings ? (
          <p className="py-6 text-center text-sm" style={{ color: 'var(--ink-ghost)' }}>
            使用标题构建文档结构
          </p>
        ) : (
          headings.map((h) => {
            const isActive = h.index === activeIndex;
            return (
              <button
                key={`${h.index}-${h.text}`}
                data-h-index={h.index}
                className="outline-heading-btn w-full truncate rounded-lg py-1.5 text-left text-sm transition-colors duration-100"
                style={{
                  paddingLeft: `${(h.level - 1) * 10 + 8}px`,
                  paddingRight: 8,
                  // 当前标题 = 长春花紫(与展示端阅读大纲一致),其余墨灰
                  color: isActive ? 'var(--accent)' : 'var(--ink-faded)',
                  fontWeight: isActive ? 600 : 400,
                }}
                onClick={() => onJump(h.index)}
              >
                {h.text}
              </button>
            );
          })
        )}
      </nav>
    </div>
  );
}
