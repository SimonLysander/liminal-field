/*
 * MarkdownTocPanel — 阅读端右栏「大纲」面板
 *
 * 职责:
 *   - 接收已构建好的 toc 数组(id 跟正文 [data-heading-id] 一一对应)
 *   - 监听 centerRef(中区滚动容器)滚动,scroll spy 高亮当前章节(accent 紫)
 *   - 点击条目:平滑滚动到对应 heading;目标短暂闪烁(toc-flash keyframe)
 *   - 长列表上下渐隐(useScrollFade);短列表不被误淡
 *   - 容器始终预留宽度(toc 空时只省内层,保住外壳宽度避免内容加载后布局抖动)
 *
 * 用法:父组件提供 toc + 中区滚动容器 centerRef。
 *   toc 来源不限:可来自后端 API headings 字段(笔记)或前端从 DOM 提取(文集)。
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useScrollFade } from '@/hooks/use-scroll-fade';

export type TocEntry = { level: number; text: string; id: string };

export function MarkdownTocPanel({
  toc,
  centerRef,
}: {
  toc: TocEntry[];
  centerRef: RefObject<HTMLDivElement | null>;
}) {
  const tocPanelRef = useRef<HTMLDivElement>(null);
  const [activeToc, setActiveToc] = useState('');

  /* 大纲列表仅可滚动时才上下渐隐(toc.length 变化触发重算) */
  const tocMask = useScrollFade(tocPanelRef, [toc.length]);

  /*
   * Scroll spy 阈值:标题的 getBoundingClientRect().top 必须 <= 容器顶 + 50px
   * 才视为"当前激活"。50px 而非更大值(如 120),避免紧邻子标题同时落入阈值
   * 导致点父标题高亮跳到子标题。
   * 从后往前找,第一个满足阈值的就是当前 active(就是最深进入视口的那个)。
   */
  const handleScroll = useCallback(() => {
    const container = centerRef.current;
    if (!container || toc.length === 0) return;
    const threshold = container.getBoundingClientRect().top + 50;
    const headingEls = container.querySelectorAll('[data-heading-id]');
    for (let i = headingEls.length - 1; i >= 0; i--) {
      const el = headingEls[i] as HTMLElement;
      if (el.getBoundingClientRect().top <= threshold) {
        setActiveToc(el.getAttribute('data-heading-id') || '');
        return;
      }
    }
    if (toc[0]) setActiveToc(toc[0].id);
  }, [toc, centerRef]);

  useEffect(() => {
    const el = centerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll, centerRef]);

  /* active 项变更时自动把它滚到面板可见区(长大纲尤其需要) */
  useEffect(() => {
    if (!activeToc || !tocPanelRef.current) return;
    const activeEl = tocPanelRef.current.querySelector(`[data-toc-id="${activeToc}"]`);
    activeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeToc]);

  /*
   * 点击 TOC 条目时滚动到对应标题,并短暂高亮目标 heading。
   * 闪烁意义:相邻标题(h2 紧接 h3)间距很小,滚动位移几乎不可感知,
   * 闪一下让用户确认"确实跳到了这里"。
   */
  const scrollToHeading = (headingId: string) => {
    const container = centerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-heading-id="${headingId}"]`) as HTMLElement | null;
    if (!el) return;
    const top =
      el.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop -
      16;
    container.scrollTo({ top, behavior: 'smooth' });
    /* 通过 CSS class 触发 toc-flash keyframe,与 React style 解耦 */
    el.classList.remove('toc-highlight');
    void el.offsetWidth;
    el.classList.add('toc-highlight');
    el.addEventListener('animationend', () => el.classList.remove('toc-highlight'), { once: true });
  };

  /* 外壳始终渲染:占住 layout-sidebar 宽度;toc 空时仅省内层,保布局稳定 */
  return (
    <div
      className="hidden shrink-0 flex-col self-start px-4 md:flex"
      style={{ width: 'var(--layout-sidebar)', marginTop: '8vh' }}
    >
      {toc.length > 0 && (
        <>
          <div
            className="mb-3 shrink-0 text-2xs font-semibold uppercase tracking-label"
            style={{ color: 'var(--ink-ghost)' }}
          >
            大纲
          </div>
          <div
            ref={tocPanelRef}
            className="overflow-y-auto"
            style={{
              maxHeight: '61.8vh',
              borderLeft: '1px solid var(--separator)',
              maskImage: tocMask,
              WebkitMaskImage: tocMask,
            }}
          >
            {toc.map((item) => (
              <div
                key={item.id}
                data-toc-id={item.id}
                className="cursor-pointer truncate rounded-lg py-[5px] pr-2 text-sm transition-colors duration-200 hover:bg-[var(--shelf)]"
                style={{
                  /* 当前阅读章节用 accent(进行中,符合 accent 纲领) */
                  color: activeToc === item.id ? 'var(--accent)' : 'var(--ink-faded)',
                  fontWeight: activeToc === item.id ? 600 : 400,
                  paddingLeft: `${(item.level - 1) * 10 + 8}px`,
                }}
                onClick={() => scrollToHeading(item.id)}
              >
                {item.text}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
