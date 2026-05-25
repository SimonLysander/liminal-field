import { estimateTokens } from './token-estimate';

describe('estimateTokens', () => {
  it('纯中文按 ~1 token/字 估', () => {
    expect(estimateTokens('量子计算')).toBeGreaterThanOrEqual(4);
    expect(estimateTokens('量子计算')).toBeLessThanOrEqual(8);
  });
  it('纯英文按 ~0.3 token/字符 估', () => {
    const t = estimateTokens('hello world foo');
    expect(t).toBeGreaterThanOrEqual(4);
    expect(t).toBeLessThanOrEqual(10);
  });
  it('空串 → 0', () => {
    expect(estimateTokens('')).toBe(0);
  });
  it('对象/数组先 JSON.stringify 再估', () => {
    expect(estimateTokens([{ role: 'user', text: 'hi' }])).toBeGreaterThan(0);
  });
});
