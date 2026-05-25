import { splitForCompaction } from './compaction-split';
import { estimateTokens } from './token-estimate';

const msg = (role: string, text: string) => ({ role, content: text });

describe('splitForCompaction', () => {
  it('总占比 < T:不压缩', () => {
    const msgs = [msg('user', 'hi'), msg('assistant', 'yo')];
    const r = splitForCompaction(msgs, {
      window: 10000,
      fixedTokens: 100,
      triggerRatio: 0.6,
      keepRatio: 0.3,
    });
    expect(r.toCompact).toEqual([]);
    expect(r.toKeep).toEqual(msgs);
  });
  it('总占比 ≥ T:压缩最老的,保留最近原文在 keepRatio 额度内', () => {
    const big = 'x'.repeat(1000);
    const msgs = Array.from({ length: 50 }, (_, i) =>
      msg(i % 2 ? 'assistant' : 'user', big),
    );
    const r = splitForCompaction(msgs, {
      window: 10000,
      fixedTokens: 0,
      triggerRatio: 0.6,
      keepRatio: 0.3,
    });
    expect(r.toCompact.length).toBeGreaterThan(0);
    const keptTokens = r.toKeep.reduce((s, m) => s + estimateTokens(m), 0);
    expect(keptTokens).toBeLessThanOrEqual(10000 * 0.3 + 400);
  });
  it('保底:固定开销挤压时至少保留最近 1 条', () => {
    const big = 'x'.repeat(10000);
    const msgs = [msg('user', big), msg('assistant', big)];
    const r = splitForCompaction(msgs, {
      window: 1000,
      fixedTokens: 900,
      triggerRatio: 0.6,
      keepRatio: 0.3,
    });
    expect(r.toKeep.length).toBeGreaterThanOrEqual(1);
  });
  it('空消息 → 两边空', () => {
    const r = splitForCompaction([], {
      window: 1000,
      fixedTokens: 0,
      triggerRatio: 0.6,
      keepRatio: 0.3,
    });
    expect(r.toCompact).toEqual([]);
    expect(r.toKeep).toEqual([]);
  });
});
