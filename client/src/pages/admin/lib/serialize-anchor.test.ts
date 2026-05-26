import { describe, it, expect } from 'vitest';
import { serializeAnchor } from './serialize-anchor';

const blocks = [
  { type: 'p', children: [{ text: '第一段。' }] },
  { type: 'p', children: [{ text: '第二段长一点的文字内容用于预览测试,这后面还有更多文字。' }] },
] as unknown as import('platejs').Descendant[];

describe('serializeAnchor', () => {
  it('选区为 null → type=none', () => {
    expect(serializeAnchor(blocks, null)).toEqual({ type: 'none' });
  });
  it('选区折叠(光标态)→ type=cursor + blockIndex', () => {
    const sel = { anchor: { path: [1, 0], offset: 3 }, focus: { path: [1, 0], offset: 3 } };
    const r = serializeAnchor(blocks, sel);
    expect(r.type).toBe('cursor');
    if (r.type === 'cursor') {
      expect(r.blockIndex).toBe(1);
      expect(r.startPath).toEqual([1, 0]);
    }
  });
  it('单块选区 → type=range + textPreview(前 40 字)', () => {
    // offset: 11 = 汉字"第二段长一点的文字内容"结尾位置（11 个汉字 × 1 UTF-16 unit）
    const sel = { anchor: { path: [1, 0], offset: 0 }, focus: { path: [1, 0], offset: 11 } };
    const r = serializeAnchor(blocks, sel);
    expect(r.type).toBe('range');
    if (r.type === 'range') {
      expect(r.blockIndex).toBe(1);
      expect(r.textPreview).toBe('第二段长一点的文字内容');
      expect(r.startPath).toEqual([1, 0]);
      expect(r.endPath).toEqual([1, 0]);
    }
  });
  it('跨块选区:blockIndex 取起点块', () => {
    const sel = { anchor: { path: [0, 0], offset: 0 }, focus: { path: [1, 0], offset: 4 } };
    const r = serializeAnchor(blocks, sel);
    expect(r.type).toBe('range');
    if (r.type === 'range') {
      expect(r.blockIndex).toBe(0);
    }
  });
  it('textPreview 超过 40 字截断', () => {
    const long = [{ type: 'p', children: [{ text: 'x'.repeat(80) }] }] as unknown as import('platejs').Descendant[];
    const sel = { anchor: { path: [0, 0], offset: 0 }, focus: { path: [0, 0], offset: 80 } };
    const r = serializeAnchor(long, sel);
    if (r.type === 'range') {
      expect(r.textPreview?.length).toBe(40);
    }
  });
});
