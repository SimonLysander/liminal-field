// 共享的 Plate 节点转换工具

import {
  getPluginByType,
  type Descendant,
  type SlateEditor,
  type TElement,
  type TText,
} from 'platejs';

type PlateNodeRecord = Record<string, unknown> & {
  children?: Descendant[];
  text?: string;
  type?: string;
};

function readNodeText(node: PlateNodeRecord): string {
  if (typeof node.text === 'string') return node.text;
  return (node.children ?? [])
    .map((child) => readNodeText(child as PlateNodeRecord))
    .join('');
}

export interface RegisteredNodeNormalization {
  nodes: TElement[];
  unsupportedTypes: string[];
}

/**
 * Markdown 插件可能解析出编辑器未注册的扩展节点。未知 inline 元素若按默认
 * block 渲染会制造空行；这里保留其文本、移除未知结构，且把类型上报给日志。
 */
export function normalizeRegisteredPlateNodes(
  editor: SlateEditor,
  nodes: TElement[],
): RegisteredNodeNormalization {
  const unsupportedTypes = new Set<string>();

  const normalizeNode = (
    node: PlateNodeRecord,
    atRoot: boolean,
  ): Descendant => {
    if (typeof node.text === 'string') return node as TText;

    if (node.type && !getPluginByType(editor, node.type)) {
      unsupportedTypes.add(node.type);
      const text = readNodeText(node);
      return atRoot
        ? ({ type: 'p', children: [{ text }] } as TElement)
        : ({ text } as TText);
    }

    return {
      ...node,
      children: (node.children ?? []).map((child) =>
        normalizeNode(child as PlateNodeRecord, false),
      ),
    } as TElement;
  };

  return {
    nodes: nodes.map((node) =>
      normalizeNode(node as PlateNodeRecord, true),
    ) as TElement[],
    unsupportedTypes: [...unsupportedTypes].sort(),
  };
}

/**
 * deserializeMd 会把 code_block 的所有行合并成单个 code_line，
 * 按 \n 拆分回多个 code_line 节点。
 */
export function fixCodeBlockLines(nodes: TElement[]): TElement[] {
  return nodes.map((node) => {
    if (node.type !== 'code_block') return node;
    const fixedChildren: Descendant[] = [];
    for (const child of node.children as TElement[]) {
      if (child.type !== 'code_line') {
        fixedChildren.push(child);
        continue;
      }
      const text = (child.children as TText[]).map((textNode) => textNode.text).join('');
      for (const line of text.split('\n')) {
        fixedChildren.push({ type: 'code_line', children: [{ text: line }] } as TElement);
      }
    }
    return { ...node, children: fixedChildren };
  });
}
