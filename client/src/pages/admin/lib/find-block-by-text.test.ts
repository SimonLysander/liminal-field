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
  it('精确命中:返回块下标与块文本', () => {
    const r = findBlockByText(doc, '讲方法');
    expect(r).toEqual({ ok: true, blockIndex: 1, blockText: '第二段讲方法。' });
  });
  it('命中跨叶子(加粗+普通)的块', () => {
    const r = findBlockByText(doc, '第二段讲方法');
    expect(r).toEqual({ ok: true, blockIndex: 1, blockText: '第二段讲方法。' });
  });
  it('找不到:reason=not-found', () => {
    expect(findBlockByText(doc, '不存在的话')).toEqual({ ok: false, reason: 'not-found' });
  });
  it('多块命中:reason=not-unique', () => {
    const dup = [
      { type: 'p', children: [{ text: '重复句。' }] },
      { type: 'p', children: [{ text: '重复句。' }] },
    ] as unknown as Descendant[];
    expect(findBlockByText(dup, '重复句')).toEqual({ ok: false, reason: 'not-unique' });
  });
  it('单块内出现两次:reason=not-unique', () => {
    const twice = [{ type: 'p', children: [{ text: 'abab' }] }] as unknown as Descendant[];
    expect(findBlockByText(twice, 'ab')).toEqual({ ok: false, reason: 'not-unique' });
  });
});
