/**
 * PromptHandler anchor 注入单测 — 验证 <selection>/<cursor> 节按 anchor 类型正确注入。
 *
 * 测试三种状态：
 * - range  → 注入 <selection> 完整节（含内容），点名段落索引 + 文字预览
 * - cursor → 注入 <cursor> 完整节（含内容），点名段落索引
 * - none   → 不注入两节（注意 <instructions> 里有引用字样，须用闭合节标签 </selection> 区分）
 *
 * 注意：<instructions> 节里有 "见 <selection> / <cursor>" 这样的行内引用，
 * 因此不能用 `toContain('<selection>')` 简单检测，须检测闭合节标签 </selection> 或 </cursor>
 * 来区分"真正注入的节"与"<instructions> 里的引用文本"。
 */
import { PromptHandler } from './prompt.handler';

describe('PromptHandler anchor 注入', () => {
  const h = new PromptHandler();
  const base = {
    coreMemories: [],
    ownerProfile: { name: '主人', birthday: '', bio: '', interests: '' },
  };

  it('anchor=range 注入 <selection> 完整节，含段落序号和文字预览', () => {
    const s = h.buildSystemPrompt({
      ...base,
      anchor: {
        type: 'range',
        blockIndex: 1,
        startPath: [1, 0],
        endPath: [1, 0],
        textPreview: '某段开头',
      },
    });
    // 检测闭合节标签，区分注入的节与 <instructions> 里的行内引用
    expect(s).toContain('</selection>');
    expect(s).toContain('第 2 段'); // blockIndex=1 → 第 2 段（+1 转人类序号）
    expect(s).toContain('某段开头');
    expect(s).not.toContain('</cursor>');
  });

  it('anchor=range textPreview 恰好 40 字时追加省略号', () => {
    const fullPreview = '一'.repeat(40);
    const s = h.buildSystemPrompt({
      ...base,
      anchor: { type: 'range', blockIndex: 0, startPath: [0, 0], endPath: [0, 0], textPreview: fullPreview },
    });
    expect(s).toContain(`${fullPreview}…`);
  });

  it('anchor=cursor 注入 <cursor> 完整节，含段落序号', () => {
    const s = h.buildSystemPrompt({
      ...base,
      anchor: { type: 'cursor', blockIndex: 0, startPath: [0, 0] },
    });
    expect(s).toContain('</cursor>');
    expect(s).toContain('第 1 段'); // blockIndex=0 → 第 1 段
    expect(s).not.toContain('</selection>');
  });

  it('anchor=none 不注入两节（无闭合节标签）', () => {
    const s = h.buildSystemPrompt({ ...base, anchor: { type: 'none' } });
    expect(s).not.toContain('</selection>');
    expect(s).not.toContain('</cursor>');
  });

  it('anchor 缺省时不注入两节（无闭合节标签）', () => {
    const s = h.buildSystemPrompt({ ...base });
    expect(s).not.toContain('</selection>');
    expect(s).not.toContain('</cursor>');
  });
});
