import type { Hunk } from './compute-doc-diff';
import { PROPOSAL_OLD, PROPOSAL_NEW } from '@/components/editor/proposal-plugin';

/**
 * applyProposalToEditor —— v3.1 一次性把 Hunk[] 展开成 editor.children 节点占位。
 *
 * 操作策略:
 *   - replace: setNodes 把原节点改为 proposal-old + insertNodes 把 newBlocks(标记 proposal-new)插在其后
 *   - delete:  setNodes 把原节点改为 proposal-old(用户接受 → 删,拒绝 → 改回 p)
 *   - insert:  insertNodes 把 newBlocks(标记 proposal-new)插在 blockPath 位置
 *
 * **从后往前**处理:按 blockPath[0] 降序排列,防止前面的 insert/remove 操作让后面
 * blockPath 漂移(每次 insertNodes 都会让后续 index +1)。
 *
 * 调用者(useProposalController.setProposal)在 React render scope 内调用,Plate 内部
 * 用 editor.tf.* 操作触发 onChange,但 readOnly 守卫已生效,不写回 bodyMarkdown
 * (沿用 v2 §6.5 状态机)。
 */
export function applyProposalToEditor(editor: unknown, hunks: Hunk[]): void {
  const ed = editor as never as {
    tf: {
      setNodes: (props: unknown, opts: { at: number[] }) => void;
      insertNodes: (nodes: unknown[], opts: { at: number[] }) => void;
      removeNodes: (opts: { at: number[] }) => void;
    };
  };

  // 从后往前:blockPath[0] 大的先处理,防止前面操作导致后面 blockPath 失效
  const sorted = [...hunks].sort(
    (a, b) => (b.blockPath?.[0] ?? 0) - (a.blockPath?.[0] ?? 0),
  );

  for (const h of sorted) {
    if (!h.blockPath) continue;
    const at = h.blockPath;
    try {
      if (h.kind === 'replace') {
        // 原节点标记为 proposal-old(保留原文供红删线展示),新节点紧随其后插入
        ed.tf.setNodes({ type: PROPOSAL_OLD, hunkId: h.id }, { at });
        if (h.newBlocks && h.newBlocks.length > 0) {
          const tagged = h.newBlocks.map((b) => ({
            ...(b as object),
            type: PROPOSAL_NEW,
            hunkId: h.id,
          }));
          ed.tf.insertNodes(tagged, { at: [at[0] + 1] });
        }
      } else if (h.kind === 'delete') {
        // 仅标记 proposal-old,无新节点;接受时 removeNodes,拒绝时 setNodes({ type: 'p' })
        ed.tf.setNodes({ type: PROPOSAL_OLD, hunkId: h.id }, { at });
      } else if (h.kind === 'insert') {
        // 直接在 blockPath 插入 proposal-new 节点
        if (h.newBlocks && h.newBlocks.length > 0) {
          const tagged = h.newBlocks.map((b) => ({
            ...(b as object),
            type: PROPOSAL_NEW,
            hunkId: h.id,
          }));
          ed.tf.insertNodes(tagged, { at });
        }
      }
      if (typeof window !== 'undefined' && import.meta.env.DEV) {
        console.debug(`[apply-proposal] ${h.kind} hunkId=${h.id} at=${JSON.stringify(at)}`);
      }
    } catch (err) {
      if (typeof window !== 'undefined' && import.meta.env.DEV) {
        console.error('[apply-proposal] 展开失败', err, h);
      }
    }
  }
}
