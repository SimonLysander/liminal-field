import { NodeApi, type Descendant } from 'platejs';

/**
 * findBlockByText —— 在顶层块里定位 find 片段所在的块(Aurora 改稿用)。
 *
 * v1 块级粒度:命中 = 某个顶层块的纯文本 includes(find),且【全文唯一】
 * (只一个块命中,且该块内只出现一次)。块级天然绕开"find 横跨加粗/链接节点"
 * 的位置反算难题。不做归一化,精确失败即报 not-found。
 */
export type FindBlockResult =
  | { ok: true; blockIndex: number; blockText: string }
  | { ok: false; reason: 'not-found' | 'not-unique' };

export function findBlockByText(blocks: Descendant[], find: string): FindBlockResult {
  const needle = find;
  let hit: { blockIndex: number; blockText: string } | null = null;

  for (let i = 0; i < blocks.length; i++) {
    const text = NodeApi.string(blocks[i]);
    const first = text.indexOf(needle);
    if (first === -1) continue;
    // 同一块内出现两次 → 不唯一
    if (text.indexOf(needle, first + needle.length) !== -1) {
      return { ok: false, reason: 'not-unique' };
    }
    // 已在别的块命中过 → 不唯一
    if (hit) return { ok: false, reason: 'not-unique' };
    hit = { blockIndex: i, blockText: text };
  }

  return hit ? { ok: true, ...hit } : { ok: false, reason: 'not-found' };
}
