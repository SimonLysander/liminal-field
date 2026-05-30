import { describe, it, expect } from 'vitest';
import { computeDocDiff } from './compute-doc-diff';
import type { Descendant } from 'platejs';

// 测试辅助:直接构造 Plate 节点,模拟 deserializeMd 的产出
function p(text: string): Descendant {
  return { type: 'p', children: [{ text }] } as never;
}

function h(text: string, level: number = 1): Descendant {
  return { type: `h${level}`, children: [{ text }] } as never;
}

describe('computeDocDiff', () => {
  it('纯插入新段 → 出 1 个 kind=insert hunk', () => {
    const old = [p('第一段。')];
    const newChildren = [p('第一段。'), p('第二段。')];
    const hunks = computeDocDiff(old, newChildren);
    expect(hunks.length).toBe(1);
    expect(hunks[0].kind).toBe('insert');
  });

  it('纯删除一段 → 出 1 个 kind=delete hunk', () => {
    const old = [p('第一段。'), p('第二段。')];
    const newChildren = [p('第一段。')];
    const hunks = computeDocDiff(old, newChildren);
    expect(hunks.length).toBe(1);
    expect(hunks[0].kind).toBe('delete');
  });

  it('块替换 + 字符级 inline diff → 出 1 个 kind=replace hunk,有 inlineDiff', () => {
    const old = [p('奥林匹克运动会始于1896年雅典。')];
    const newChildren = [p('奥林匹克运动会始于现代1896年雅典。')];
    const hunks = computeDocDiff(old, newChildren);
    expect(hunks.length).toBe(1);
    expect(hunks[0].kind).toBe('replace');
    expect(hunks[0].inlineDiff).toBeDefined();
    expect(hunks[0].inlineDiff!.some((seg) => seg.kind === 'ins' && seg.text.includes('现代'))).toBe(true);
  });

  it('结构变化(段→标题)→ 出 1 个 kind=replace 块级兜底,inlineDiff 可缺省', () => {
    const old = [p('冬季项目')];
    const newChildren = [h('冬季项目')];
    const hunks = computeDocDiff(old, newChildren);
    expect(hunks.length).toBe(1);
    expect(hunks[0].kind).toBe('replace');
    // 结构变化场景 inlineDiff 可缺省(整块红/绿),不强制
  });

  it('完全等价改动 → 出 0 hunks', () => {
    const old = [p('第一段。'), p('第二段。')];
    const newChildren = [p('第一段。'), p('第二段。')];
    const hunks = computeDocDiff(old, newChildren);
    expect(hunks).toEqual([]);
  });

  it('多处独立改动 → 出多个 hunks,顺序按 blockPath', () => {
    const old = [p('段一。'), p('段二。'), p('段三。')];
    const newChildren = [p('段一改。'), p('段二。'), p('段三改。')];
    const hunks = computeDocDiff(old, newChildren);
    expect(hunks.length).toBe(2);
    expect((hunks[0].blockPath?.[0] ?? -1) < (hunks[1].blockPath?.[0] ?? -1)).toBe(true);
  });

  it('块签名撞:两个相同段 + 修改一个 → LCS 按 index 顺序匹配,不退化', () => {
    const old = [p('今日。'), p('其他。'), p('今日。')];
    const newChildren = [p('今日改。'), p('其他。'), p('今日。')];
    const hunks = computeDocDiff(old, newChildren);
    expect(hunks.length).toBe(1);
    expect(hunks[0].kind).toBe('replace');
    expect(hunks[0].blockPath?.[0]).toBe(0);
  });

  it('insert + delete 在不相邻位置 → 不误合并为 replace', () => {
    // 旧:A, B
    // 新:C, A  (B 被删,C 插在开头)
    const old = [p('A 段。'), p('B 段。')];
    const newChildren = [p('C 段。'), p('A 段。')];
    const hunks = computeDocDiff(old, newChildren);
    // 应该出 2 个 hunks(insert + delete),不是 1 个 replace
    expect(hunks.length).toBe(2);
    expect(hunks.find((h) => h.kind === 'insert')).toBeDefined();
    expect(hunks.find((h) => h.kind === 'delete')).toBeDefined();
    expect(hunks.find((h) => h.kind === 'replace')).toBeUndefined();
  });
});
