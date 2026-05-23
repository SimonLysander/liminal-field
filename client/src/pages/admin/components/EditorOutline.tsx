/**
 * EditorOutline — 编辑器右侧大纲面板(笔记/文集编辑器共用)。
 *
 * 与展示端笔记目录同一套:黄金比例 61.8vh 高度上限、离顶 8vh、上下渐隐、当前项靠左截断。
 * 原先两个编辑器各自重复一份,抽到此处去重。
 */

import type { HeadingEntry } from '../lib/markdown-toc';

const TOC_MASK = 'linear-gradient(to bottom, transparent 0, #000 28px, #000 calc(100% - 28px), transparent 100%)';

export function EditorOutline({
  headings,
  onJump,
}: {
  headings: HeadingEntry[];
  /** 点击大纲项跳转到对应标题(按出现顺序的 index) */
  onJump: (index: number) => void;
}) {
  return (
    <div
      className="flex min-h-0 shrink-0 flex-col self-start overflow-y-auto px-4 py-10"
      style={{
        width: 'var(--layout-sidebar)',
        marginTop: '8vh',
        maxHeight: '61.8vh',
        maskImage: TOC_MASK,
        WebkitMaskImage: TOC_MASK,
      }}
    >
      <div
        className="mb-3 text-xs font-semibold uppercase"
        style={{ color: 'var(--ink-ghost)', letterSpacing: '0.04em' }}
      >
        大纲
      </div>
      <nav>
        {headings.length === 0 ? (
          <p className="py-6 text-center text-sm" style={{ color: 'var(--ink-ghost)' }}>
            使用标题构建文档结构
          </p>
        ) : (
          headings.map((h) => (
            <button
              key={`${h.index}-${h.text}`}
              className="outline-heading-btn w-full truncate rounded-lg py-1.5 text-left text-sm transition-colors duration-100"
              style={{
                paddingLeft: `${(h.level - 1) * 10 + 8}px`,
                paddingRight: 8,
                color: 'var(--ink-faded)',
                fontWeight: 400,
              }}
              onClick={() => onJump(h.index)}
            >
              {h.text}
            </button>
          ))
        )}
      </nav>
    </div>
  );
}
