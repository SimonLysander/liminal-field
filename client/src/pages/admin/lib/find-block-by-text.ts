import { NodeApi, type Descendant } from 'platejs';

/**
 * findBlockByText —— 在顶层块里定位 find 片段所在的块(Aurora 改稿用)。
 *
 * v1 块级粒度:命中 = 某个顶层块的纯文本 includes(find),且【全文唯一】
 * (只一个块命中,且该块内只出现一次)。块级天然绕开"find 横跨加粗/链接节点"
 * 的位置反算难题。
 *
 * v2 容错（新增）：
 *   原始 find 没命中时，尝试常见的「markdown 标记残留」清理后再匹配一次：
 *     - 行首 markdown 标记：`#`、`##`、`###`、`>`、`-`、`*`、`+`、`1.`、`1)` 等
 *     - 首尾空白
 *   模型即使把 `find: "# 论独处的能力"` 误抄进 markdown 前缀，编辑器纯文本里只是
 *   "论独处的能力"，命中失败原因可定位——清理后重试一次，能救回 90% 的此类失败。
 *
 *   返回 matchedNeedle:实际命中 blockText 时用的那个字符串(可能 ≠ 入参 find)。
 *   调用方(applyProposedEdits)用 matchedNeedle 而非原始 find 去做 String.replace,
 *   否则带前缀的 find 在去前缀的 blockText 里 replace 不到,白命中。
 *
 *   不做的：
 *   - 内联 markdown 标记（`**bold**` / `[link](...)`）—— 影响替换语义且歧义大，留给模型自己处理
 *   - 换行符 → 空格 —— 多行/跨块的 find 是设计上不支持的（prompt 已告诫），不容错否则歧义大
 */
export type FindBlockResult =
  | {
      ok: true;
      blockIndex: number;
      blockText: string;
      /** 实际命中 blockText 的字符串（可能是 find 也可能是清理 markdown 标记后的版本） */
      matchedNeedle: string;
    }
  | { ok: false; reason: 'not-found' | 'not-unique' };

/**
 * 清理行首 markdown 标记 + 首尾空白。
 * 只做一次清理（不递归），避免把 "## 标题" 这种合法多级标记错位剥掉。
 *
 * 正则覆盖：
 * - `^#{1,6}\s+` → 标题（h1-h6）
 * - `^>\s+` → 引用
 * - `^[-*+]\s+` → 无序列表
 * - `^\d+[.)]\s+` → 有序列表（1. / 1)）
 */
function stripLeadingMarkdownMarkers(s: string): string {
  return s
    .trim()
    .replace(/^(?:#{1,6}|>|[-*+]|\d+[.)])\s+/, '')
    .trim();
}

/**
 * 在 blocks 里搜 needle：单块命中 + 全文唯一才算成功。
 * 返回命中块下标、块文本、命中所用 needle；歧义返回 not-unique；找不到返回 null（由外层决定要不要再试）。
 */
function searchOnce(
  blocks: Descendant[],
  needle: string,
): FindBlockResult | null {
  if (needle.length === 0) return null;
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

  if (!hit) return null;
  return { ok: true, ...hit, matchedNeedle: needle };
}

export function findBlockByText(
  blocks: Descendant[],
  find: string,
): FindBlockResult {
  // 第一次：原文匹配
  const direct = searchOnce(blocks, find);
  if (direct) return direct;

  // 第二次：清理行首 markdown 标记 + 首尾空白再试。
  // 仅当清理后字符串与原文不同时才重试，否则纯粹重复一次浪费 CPU。
  const cleaned = stripLeadingMarkdownMarkers(find);
  if (cleaned !== find && cleaned.length > 0) {
    const retry = searchOnce(blocks, cleaned);
    if (retry) return retry;
  }

  return { ok: false, reason: 'not-found' };
}
