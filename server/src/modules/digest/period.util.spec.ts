/**
 * period.util 契约测试 —「期」的周期归属是 digest upsert 去重的根基,算错会让
 * 同期重复生成无法覆盖(冒出多期)或不同期被误判同期(互相覆盖丢内容)。
 *
 * 断言用本地时间构造,与运行时区无关(构造与格式化都走本地):
 *   2026-06-22 周一 / 06-24 周三 / 07-01 周三(下一周,起点 06-29) / 06-01 周一。
 */
import { computePeriodKey, periodFromCron } from './period.util';

describe('periodFromCron', () => {
  it('日报 cron → 1 天', () => {
    expect(periodFromCron('0 0 * * *')).toBe(24 * 60 * 60 * 1000);
  });

  it('周报 cron → 7 天', () => {
    expect(periodFromCron('0 0 * * 1')).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('无效 cron → 7 天兜底', () => {
    expect(periodFromCron('not a cron')).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('computePeriodKey', () => {
  it('周报:同一周内不同时刻 → 同一 periodKey(同期重复生成可 upsert 覆盖)', () => {
    const wed = new Date(2026, 5, 24, 12, 0, 0); // 周三 12:00
    const fri = new Date(2026, 5, 26, 9, 30, 0); // 同周五 09:30
    expect(computePeriodKey('0 0 * * 1', wed)).toBe(
      computePeriodKey('0 0 * * 1', fri),
    );
  });

  it('周报:periodKey = 本周起点(周一)日期', () => {
    const wed = new Date(2026, 5, 24, 12, 0, 0); // 周三 → 本周一 06-22
    expect(computePeriodKey('0 0 * * 1', wed)).toBe('2026-06-22');
  });

  it('周报:跨周 → 不同 periodKey(新一期)', () => {
    const thisWeek = new Date(2026, 5, 24, 12, 0, 0); // 06-22 那周
    const nextWeek = new Date(2026, 6, 1, 12, 0, 0); // 07-01 周三 → 06-29 那周
    expect(computePeriodKey('0 0 * * 1', thisWeek)).toBe('2026-06-22');
    expect(computePeriodKey('0 0 * * 1', nextWeek)).toBe('2026-06-29');
  });

  it('日报:同一天不同时刻 → 同 key;隔天 → 不同 key', () => {
    const morning = new Date(2026, 5, 24, 8, 0, 0);
    const evening = new Date(2026, 5, 24, 20, 0, 0);
    const nextDay = new Date(2026, 5, 25, 8, 0, 0);
    expect(computePeriodKey('0 0 * * *', morning)).toBe(
      computePeriodKey('0 0 * * *', evening),
    );
    expect(computePeriodKey('0 0 * * *', morning)).not.toBe(
      computePeriodKey('0 0 * * *', nextDay),
    );
  });

  it('月报:月内任意时刻 → 月起点(1 号)日期', () => {
    const mid = new Date(2026, 5, 24, 12, 0, 0); // 6 月中
    expect(computePeriodKey('0 0 1 * *', mid)).toBe('2026-06-01');
  });

  it('cron 缺失 → 退化为生成当天日期,不崩', () => {
    const d = new Date(2026, 5, 24, 12, 0, 0);
    expect(computePeriodKey(undefined, d)).toBe('2026-06-24');
  });
});
