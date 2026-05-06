// 共享的 Plate 节点转换工具

import type { TElement } from 'platejs';

/**
 * deserializeMd 会把 code_block 的所有行合并成单个 code_line，
 * 按 \n 拆分回多个 code_line 节点。
 */
export function fixCodeBlockLines(nodes: TElement[]): TElement[] {
  return nodes.map((node) => {
    if (node.type !== 'code_block') return node;
    const fixedChildren: TElement[] = [];
    for (const child of node.children as TElement[]) {
      if (child.type !== 'code_line') {
        fixedChildren.push(child);
        continue;
      }
      const text = (child.children as { text: string }[]).map((c) => c.text).join('');
      for (const line of text.split('\n')) {
        fixedChildren.push({ type: 'code_line', children: [{ text: line }] } as TElement);
      }
    }
    return { ...node, children: fixedChildren };
  });
}
