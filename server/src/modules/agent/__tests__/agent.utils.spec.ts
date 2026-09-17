import { hasRepeatedInvalidToolNames } from '../agent.utils';

describe('hasRepeatedInvalidToolNames', () => {
  it('仅在同一个工具连续达到指定轮数时返回 true', () => {
    expect(
      hasRepeatedInvalidToolNames(
        [new Set(['write_draft', 'web_fetch']), new Set(['write_draft'])],
        2,
      ),
    ).toBe(true);
    expect(
      hasRepeatedInvalidToolNames(
        [new Set(['write_draft']), new Set(['web_fetch'])],
        2,
      ),
    ).toBe(false);
  });

  it('中间轮次没有无效调用时不连续', () => {
    expect(
      hasRepeatedInvalidToolNames(
        [new Set(['write_draft']), new Set(), new Set(['write_draft'])],
        2,
      ),
    ).toBe(false);
  });

  it('拒绝无效的连续次数配置', () => {
    expect(() => hasRepeatedInvalidToolNames([], 0)).toThrow(RangeError);
  });
});
