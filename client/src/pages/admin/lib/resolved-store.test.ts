import { describe, it, expect, beforeEach } from 'vitest';
import { readResolved, markResolved, __clearAllResolvedForTest } from './resolved-store';

describe('resolved-store', () => {
  beforeEach(() => {
    __clearAllResolvedForTest();
  });

  it('初始读取为空集合', () => {
    expect(readResolved().size).toBe(0);
  });

  it('mark + read 来回一致', () => {
    markResolved('call_a');
    markResolved('call_b');
    const set = readResolved();
    expect(set.size).toBe(2);
    expect(set.has('call_a')).toBe(true);
    expect(set.has('call_b')).toBe(true);
  });

  it('mark 同一 callId 多次幂等(不重复)', () => {
    markResolved('call_a');
    markResolved('call_a');
    markResolved('call_a');
    expect(readResolved().size).toBe(1);
  });

  it('空 callId 不被记录', () => {
    markResolved('');
    expect(readResolved().size).toBe(0);
  });

  it('cap 200:超过则淘汰最早的', () => {
    for (let i = 0; i < 220; i++) markResolved(`call_${i}`);
    const set = readResolved();
    expect(set.size).toBe(200);
    // 最早的 20 个应被淘汰
    expect(set.has('call_0')).toBe(false);
    expect(set.has('call_19')).toBe(false);
    expect(set.has('call_20')).toBe(true);
    expect(set.has('call_219')).toBe(true);
  });

  it('JSON 损坏时读取降级为空集合,不抛错', () => {
    window.localStorage.setItem('v3-resolved-callids', '{not json');
    expect(() => readResolved()).not.toThrow();
    expect(readResolved().size).toBe(0);
  });

  it('非数组 JSON 时读取降级为空集合', () => {
    window.localStorage.setItem('v3-resolved-callids', '{"foo":"bar"}');
    expect(readResolved().size).toBe(0);
  });
});
