import { describe, it, expect } from 'vitest';
import { findBlockByText } from './find-block-by-text';
import type { Descendant } from 'platejs';

// 简化的 Plate 节点:顶层块 + 文本叶子(findBlockByText 只读文本,不关心富文本细节)
const doc = [
  { type: 'p', children: [{ text: '第一段讲背景。' }] },
  { type: 'p', children: [{ text: '第二段', bold: true }, { text: '讲方法。' }] },
  { type: 'p', children: [{ text: '第三段讲结论。' }] },
] as unknown as Descendant[];

describe('findBlockByText', () => {
  it('精确命中:返回块下标 + 块文本 + matchedNeedle(=入参 find)', () => {
    const r = findBlockByText(doc, '讲方法');
    expect(r).toEqual({
      ok: true,
      blockIndex: 1,
      blockText: '第二段讲方法。',
      matchedNeedle: '讲方法',
    });
  });
  it('命中跨叶子(加粗+普通)的块', () => {
    const r = findBlockByText(doc, '第二段讲方法');
    expect(r).toEqual({
      ok: true,
      blockIndex: 1,
      blockText: '第二段讲方法。',
      matchedNeedle: '第二段讲方法',
    });
  });
  it('找不到:reason=not-found', () => {
    expect(findBlockByText(doc, '不存在的话')).toEqual({
      ok: false,
      reason: 'not-found',
    });
  });
  it('多块命中:reason=not-unique', () => {
    const dup = [
      { type: 'p', children: [{ text: '重复句。' }] },
      { type: 'p', children: [{ text: '重复句。' }] },
    ] as unknown as Descendant[];
    expect(findBlockByText(dup, '重复句')).toEqual({
      ok: false,
      reason: 'not-unique',
    });
  });
  it('单块内出现两次:reason=not-unique', () => {
    const twice = [
      { type: 'p', children: [{ text: 'abab' }] },
    ] as unknown as Descendant[];
    expect(findBlockByText(twice, 'ab')).toEqual({
      ok: false,
      reason: 'not-unique',
    });
  });

  // ── v2 容错:行首 markdown 标记残留 ─────────────────────────────────────────
  describe('v2 markdown 标记容错', () => {
    // 模拟一篇文档:有 heading(纯文本"论独处的能力"),有列表项,有引用
    const docWithStructure = [
      { type: 'h1', children: [{ text: '论独处的能力' }] },
      { type: 'p', children: [{ text: '正文段落。' }] },
      { type: 'li', children: [{ text: '清单项目一' }] },
      { type: 'blockquote', children: [{ text: '引用一段名言' }] },
    ] as unknown as Descendant[];

    it('find 带 heading 前缀(模型误抄 markdown 语法) → 清理后命中,matchedNeedle 是清理后的纯文本', () => {
      const r = findBlockByText(docWithStructure, '# 论独处的能力');
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.blockIndex).toBe(0);
        expect(r.matchedNeedle).toBe('论独处的能力');
      }
    });

    it('find 带多级 heading 前缀(### 论独处)同样能容错', () => {
      const r = findBlockByText(docWithStructure, '### 论独处的能力');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.matchedNeedle).toBe('论独处的能力');
    });

    it('find 带列表前缀(- 清单项目一)能容错', () => {
      const r = findBlockByText(docWithStructure, '- 清单项目一');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.matchedNeedle).toBe('清单项目一');
    });

    it('find 带引用前缀(> 引用)能容错', () => {
      const r = findBlockByText(docWithStructure, '> 引用一段名言');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.matchedNeedle).toBe('引用一段名言');
    });

    it('find 带有序列表前缀(1. xxx)能容错', () => {
      const ord = [
        { type: 'li', children: [{ text: '第一条' }] },
      ] as unknown as Descendant[];
      const r = findBlockByText(ord, '1. 第一条');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.matchedNeedle).toBe('第一条');
    });

    it('find 首尾有空白也能命中(trim 兜底)', () => {
      const r = findBlockByText(docWithStructure, '  正文段落。  ');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.matchedNeedle).toBe('正文段落。');
    });

    it('原文本身已包含 # 字符(无歧义路径) → 优先直接命中,不动 matchedNeedle', () => {
      const withHash = [
        { type: 'p', children: [{ text: '价格是 #100 美金' }] },
      ] as unknown as Descendant[];
      const r = findBlockByText(withHash, '#100');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.matchedNeedle).toBe('#100');
    });

    it('清理后还是找不到 → 老老实实 reason=not-found,不强行匹配', () => {
      const r = findBlockByText(docWithStructure, '# 完全不存在的话');
      expect(r).toEqual({ ok: false, reason: 'not-found' });
    });

    it('清理后清空(纯前缀如 "# ") → 不报错也不假命中', () => {
      const r = findBlockByText(docWithStructure, '# ');
      // 原文 "# " 在 docWithStructure 里也找不到 → not-found
      expect(r).toEqual({ ok: false, reason: 'not-found' });
    });
  });
});
