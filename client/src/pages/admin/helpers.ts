import type { TreeNode } from './types';

export function formatDate(iso?: string) {
  if (!iso) return '--';
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function parseError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function updateNodeInTree(
  nodes: TreeNode[],
  id: string,
  updater: (node: TreeNode) => TreeNode,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.id === id) return updater(node);
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, id, updater) };
    }
    return node;
  });
}

export function removeNodeFromTree(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => {
      if (!node.children) return node;
      return { ...node, children: removeNodeFromTree(node.children, id) };
    });
}

export function insertChildInTree(nodes: TreeNode[], parentId: string, child: TreeNode): TreeNode[] {
  return nodes.map((node) => {
    if (node.id === parentId) {
      return {
        ...node,
        isExpanded: true,
        children: [...(node.children ?? []), child],
      };
    }

    if (!node.children) return node;
    return { ...node, children: insertChildInTree(node.children, parentId, child) };
  });
}

export function countNodes(nodes: TreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countNodes(node.children ?? []), 0);
}

export function findNodeInTree(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeInTree(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function findParentId(nodes: TreeNode[], nodeId: string, parentId: string | null = null): string | null {
  for (const node of nodes) {
    if (node.id === nodeId) return parentId;
    if (node.children) {
      const found = findParentId(node.children, nodeId, node.id);
      if (found !== undefined && found !== null) return found;
      if (node.children.some((c) => c.id === nodeId)) return node.id;
    }
  }
  return null;
}

/**
 * Get the sibling list that contains `nodeId`.
 * Returns [siblings, parentId].
 */
export function getSiblings(nodes: TreeNode[], nodeId: string): [TreeNode[], string | null] {
  if (nodes.some((n) => n.id === nodeId)) return [nodes, null];
  for (const node of nodes) {
    if (node.children) {
      if (node.children.some((c) => c.id === nodeId)) return [node.children, node.id];
      const found = getSiblings(node.children, nodeId);
      if (found[0].length > 0) return found;
    }
  }
  return [[], null];
}

/**
 * Move a node in the tree. Returns a new tree with the node in its new position.
 * - `position === 'before'`: insert before targetNodeId in its sibling list
 * - `position === 'after'`: insert after targetNodeId in its sibling list
 * - `position === 'inside'`: insert as last child of targetNodeId (must be a folder)
 */
export function moveNodeInTree(
  nodes: TreeNode[],
  sourceId: string,
  targetId: string,
  position: 'before' | 'after' | 'inside',
): TreeNode[] {
  const sourceNode = findNodeInTree(nodes, sourceId);
  if (!sourceNode) return nodes;

  /* Step 1: remove source from tree */
  let result = removeNodeFromTree(nodes, sourceId);

  /* Step 2: insert at new position */
  if (position === 'inside') {
    result = updateNodeInTree(result, targetId, (target) => ({
      ...target,
      isExpanded: true,
      children: [...(target.children ?? []), sourceNode],
    }));
  } else {
    result = insertBeforeOrAfter(result, targetId, sourceNode, position);
  }

  return result;
}

function insertBeforeOrAfter(
  nodes: TreeNode[],
  targetId: string,
  toInsert: TreeNode,
  position: 'before' | 'after',
): TreeNode[] {
  const idx = nodes.findIndex((n) => n.id === targetId);
  if (idx !== -1) {
    const copy = [...nodes];
    const insertIdx = position === 'before' ? idx : idx + 1;
    copy.splice(insertIdx, 0, toInsert);
    return copy;
  }

  return nodes.map((node) => {
    if (!node.children) return node;
    return {
      ...node,
      children: insertBeforeOrAfter(node.children, targetId, toInsert, position),
    };
  });
}
