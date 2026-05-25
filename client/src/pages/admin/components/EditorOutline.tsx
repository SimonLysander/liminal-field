/**
 * EditorOutline — 编辑器右侧大纲面板(笔记/文集编辑器共用)。
 *
 * 标题固定不滚;列表高度跟随内容、超 61.8vh 才滚动;左侧细线从标题下方起、长度随内容;
 * 仅可滚动时上下边缘渐隐(useScrollFade);当前阅读标题高亮(activeIndex)。
 * 原先两个编辑器各自重复一份,抽到此处去重。
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

  // 当前标题变化时,把激活项滚进大纲可视区(与展示端阅读大纲一致)
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || activeIndex == null) return;
    const el = nav.querySelector(`[data-h-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeIndex]);

  return (
    <div
      className="flex shrink-0 flex-col self-start px-4 pt-4"
      style={{
        width: 'var(--layout-sidebar)',
        marginTop: '0',
      }}
    >
      {/* 标题固定不滚 */}
      <div
        className="mb-3 shrink-0 text-xs font-semibold uppercase"
        style={{ color: 'var(--ink-ghost)', letterSpacing: '0.04em' }}
      >
        大纲
      </div>
      {/* 列表高度跟随内容、超上限才滚;左侧细线从标题下方开始、长度随内容 */}
      <nav
        ref={navRef}
        className="overflow-y-auto"
        style={{
          maxHeight: '61.8vh',
          borderLeft: '1px solid var(--separator)',
          maskImage: mask,
          WebkitMaskImage: mask,
        }}
      >
        {headings.length === 0 ? (
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
