import { useEffect, useMemo } from 'react';
import { useEditorRef } from 'platejs/react';
import { Check, X } from 'lucide-react';
import type { Hunk } from '@/pages/admin/lib/compute-doc-diff';
import type { Decision } from '@/pages/admin/lib/use-proposal-controller';

/**
 * ProposalOverlay —— v3 改稿就地渲染(在 <Plate> 内调用)。
 *
 * 两套渲染机制分工:
 * - "红删"侧 → CSS Custom Highlight(只能高亮已存在的文本)
 *   对 replace/delete kind:通过 querySelectorAll 找到块对应的 DOM 节点,
 *   把其文本内容范围注册到 `CSS.highlights.set('proposal-del', new Highlight(...ranges))`
 * - "绿增"侧 → DOM overlay 浮层
 *   对 insert/replace kind:在参考块 DOM 节点之后,
 *   渲染一个 `<div.proposal-ins contentEditable={false}>` 显示绿底新文
 * - hunk 浮按钮:每个 pending hunk 旁绝对定位 `[✓] [✗]`
 *
 * 不进 Plate 节点树,editor.children 始终干净 —— 避免 serializeMd 把 diff mark
 * 写进 markdown 污染原文(v1/v2 踩过的坑)。
 *
 * DOM 节点查找策略:
 * 通过 `[data-slate-editor]` 容器 + `querySelectorAll(':scope > [data-slate-node]')`
 * 按 blockIdx 定位块 DOM 节点,不依赖 `DOMEditor.toDOMNode`(需要 slate-dom 直接依赖),
 * 完全类型安全,无需 @ts-expect-error。
 *
 * 浏览器兼容:CSS Custom Highlight 需 Chrome 105+/Safari 17.2+/Firefox 140+(2026 已普及)。
 * 不支持的环境:console 警告,只渲染浮层 + 浮按钮(无红删高亮),用户仍能审批。
 *
 * 容器要求:调用方需在 editor DOM 容器上设 `position: relative`(Task 6 在 PlateEditor 接入时处理)。
 */

interface Props {
  hunks: Hunk[];
  decisions: Map<string, Decision>;
  onAcceptOne: (id: string) => void;
  onRejectOne: (id: string) => void;
}

const HIGHLIGHT_NAME = 'proposal-del';

/** 通过 data-slate-node 属性按索引找到编辑器容器内的块 DOM 节点 */
function getBlockDomNode(blockIdx: number): HTMLElement | null {
  const editorEl = document.querySelector('[data-slate-editor]');
  if (!editorEl) return null;
  // Slate 每个块元素带 data-slate-node="element",按文档顺序排列
  const blocks = editorEl.querySelectorAll<HTMLElement>(':scope > [data-slate-node]');
  return blocks[blockIdx] ?? null;
}

export function ProposalOverlay({ hunks, decisions, onAcceptOne, onRejectOne }: Props) {
  // useEditorRef 获取 editor 实例,用于 useEffect 依赖:
  // editor 实例变化(如重新挂载)时触发高亮重算
  const editor = useEditorRef();

  // 维护 CSS.highlights 注册(红删高亮)
  useEffect(() => {
    if (typeof CSS === 'undefined' || !('highlights' in CSS)) {
      if (import.meta.env.DEV) {
        console.warn('[ProposalOverlay] CSS Custom Highlight API 不支持,降级到无红删高亮');
      }
      return;
    }

    const ranges: Range[] = [];

    for (const hunk of hunks) {
      // 已裁决的 hunk 不再高亮
      if (decisions.has(hunk.id)) continue;
      if (hunk.kind !== 'delete' && hunk.kind !== 'replace') continue;

      const blockIdx = hunk.blockPath?.[0];
      if (typeof blockIdx !== 'number') continue;

      const domNode = getBlockDomNode(blockIdx);
      if (!domNode) continue;

      try {
        const range = document.createRange();
        range.selectNodeContents(domNode);
        ranges.push(range);
      } catch (err) {
        if (import.meta.env.DEV) {
          console.error('[ProposalOverlay] DOM range 创建失败', { blockIdx, err });
        }
      }
    }

    // CSS Custom Highlight API —— W3C 标准,Chrome 105+ / Safari 17.2+ / Firefox 140+
    // lib.dom 已收录此 API(TypeScript 5.x 起),无需 @ts-expect-error
    const highlight = new Highlight(...ranges);
    CSS.highlights.set(HIGHLIGHT_NAME, highlight);

    return () => {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    };
    // editor 作为依赖确保 editor 内容变化后重新计算 DOM ranges
  }, [editor, hunks, decisions]);

  // 绿增浮层 + 浮按钮:根据 pending hunks 计算位置。
  // 位置依赖 hunks / decisions 变化;布局变化由调用方触发 hunks 更新来驱动,
  // 此处无需 editor 作为依赖(DOM 查询通过 data-slate-editor 属性直接访问)。
  const overlays = useMemo(() => {
    return hunks
      .filter((hunk) => !decisions.has(hunk.id))
      .map((hunk) => {
        try {
          const blockIdx = hunk.blockPath?.[0];
          if (typeof blockIdx !== 'number') return null;

          // 参考 DOM 节点取法:
          // - replace/delete: 取 blockIdx 对应的块(被改动/删除的那块)
          // - insert: 取 blockIdx - 1(插入点之前的那块);若 blockIdx=0 则取 blocks[0]
          const refIdx =
            hunk.kind === 'insert' ? Math.max(0, blockIdx - 1) : blockIdx;

          const domNode = getBlockDomNode(refIdx);
          if (!domNode) return null;

          // 计算相对于 [data-slate-editor] 容器的偏移量
          const editorEl = document.querySelector('[data-slate-editor]') as HTMLElement | null;
          if (!editorEl) return null;

          const nodeRect = domNode.getBoundingClientRect();
          const editorRect = editorEl.getBoundingClientRect();

          // insert 的浮层跟在参考块下方;replace/delete 的浮层覆盖在块位置
          const topOffset =
            hunk.kind === 'insert'
              ? nodeRect.bottom - editorRect.top
              : nodeRect.top - editorRect.top;

          const leftOffset = nodeRect.left - editorRect.left;

          return {
            hunk,
            top: topOffset,
            left: leftOffset,
            width: nodeRect.width,
          };
        } catch (err) {
          if (import.meta.env.DEV) {
            console.error('[ProposalOverlay] overlay 位置计算失败', { hunk, err });
          }
          return null;
        }
      })
      .filter(
        (
          x,
        ): x is {
          hunk: Hunk;
          top: number;
          left: number;
          width: number;
        } => x !== null,
      );
  }, [hunks, decisions]);

  return (
    <>
      {overlays.map(({ hunk, top, left, width }) => (
        <div
          key={hunk.id}
          style={{
            position: 'absolute',
            top,
            left,
            width,
            // 外层容器不捕获指针事件,防止遮挡下方编辑器交互
            pointerEvents: 'none',
          }}
        >
          {/* 绿增浮层:replace / insert 时显示新内容 */}
          {(hunk.kind === 'insert' || hunk.kind === 'replace') && hunk.newText && (
            <div className="proposal-ins">{hunk.newText}</div>
          )}

          {/* 浮按钮:接受/拒绝,单独恢复 pointerEvents 使其可点击 */}
          <div
            className="proposal-hunk-actions"
            style={{ right: -120, top: 0, pointerEvents: 'auto' }}
          >
            <button
              type="button"
              onClick={() => onAcceptOne(hunk.id)}
              aria-label="接受这处改动"
              style={{
                background: 'var(--mark-green, #3F9D57)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '2px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={() => onRejectOne(hunk.id)}
              aria-label="拒绝这处改动"
              style={{
                background: 'var(--mark-red, #D24B3E)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '2px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
    </>
  );
}
