/**
 * period.util.ts — 简报「期」的周期归属计算。
 *
 * 背景:简报的「期」应按时间周期划分(日刊/周刊/月刊),同一周期内重复生成应视为
 * 「同一期的更新」而非新期。本工具把"一次生成"映射到稳定的 periodKey,commit 节点
 * 按 (topicId, periodKey) upsert 硬覆盖 → 同期重复生成自动覆盖旧的、只留最新一次。
 *
 * 周期粒度按 stc.cron 自动推断(需求方决策:按 cron 推断,不额外加配置项):
 *   日刊 cron(如 0 8 * * *)→ 每天一期;周刊(0 0 * * 1)→ 每周一期;月刊(0 0 1 * *)→ 每月一期。
 *
 * periodKey = 该次生成所属周期的"起点"(≤ 生成时刻的最近一次 cron 计划时刻)的本地日期
 * (YYYY-MM-DD)。同一周期内任意时刻(定时触发 / 管理员手动补生成)都对齐到同一起点 →
 * 同一个 periodKey → upsert 命中同一条 → 覆盖。
 *
 * 假设:周期粒度 ≥ 1 天(日/周/月简报)。若未来支持小时级简报,需把 key 精度下探到时分
 * (否则同日两期 key 会撞)——当前产品形态不涉及,故用日期保证可读性。
 *
 * 跨粒度切换兼容:不同粒度算出的起点日期天然不同(日=当天 / 周=周一 / 月=1 号),历史期
 * 各自保留、不冲突,只是切换点处期序节奏变化(已与需求方对齐,属可接受)。
 */
import { CronTime } from 'cron';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * 用 stc.cron 估算一个周期的毫秒长度(react-agent 兜底"本期收集窗口"、本工具回退枚举起点都用)。
 * 思路:CronTime.sendAt() 给下次,getNextDateFrom 给再下次 → 两次差即 period。解析失败兜底 7 天。
 */
export function periodFromCron(cron: string): number {
  try {
    const ct = new CronTime(cron);
    const next1 = ct.sendAt().toJSDate();
    const next2 = ct.getNextDateFrom(next1).toJSDate();
    return next2.getTime() - next1.getTime();
  } catch {
    return WEEK_MS; // 7 天兜底
  }
}

/** 本地日期 YYYY-MM-DD(不带时区尾巴,周期起点天然对齐到本地自然日/周/月)。 */
function formatLocalDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 找 ≤ at 的最近一次 cron 计划时刻(= 当前周期起点)。
 * 从 at 往前退 ~2.2 个周期开始向后枚举 scheduled 时刻,取最后一个不超过 at 的。
 * 比"用 periodMs 直接减"精确——避免月份不等长(28~31 天)导致的边界漂移。
 */
function currentPeriodStart(cron: string, at: Date): Date {
  const ct = new CronTime(cron);
  const back = periodFromCron(cron) * 2.2;
  let cursor = new Date(at.getTime() - back);
  // last 初始化为 null:若 2.2 周期窗口内无任何调度事件(异常 cron / periodFromCron 严重低估
  // 实际周期),不能把回溯起点(cursor,约 2.2 周期前)误当周期起点返回——那会静默写错 periodKey、
  // 把当前期当成历史旧期新建。退化为 at(当前时刻 → 当天 key),保证落在当前期。
  let last: Date | null = null;
  // 上限 64 次迭代防异常 cron 死循环(2.2 周期内正常只枚举 2~3 次就越过 at)
  for (let i = 0; i < 64; i++) {
    const next = ct.getNextDateFrom(cursor).toJSDate();
    if (next.getTime() > at.getTime()) break;
    last = next;
    cursor = next;
  }
  return last ?? at;
}

/**
 * 计算一次生成的周期标识 periodKey。
 * cron 缺失或解析失败时退化为按生成当天(仍是稳定 key,不会崩)。
 */
export function computePeriodKey(cron: string | undefined, at: Date): string {
  if (!cron) return formatLocalDate(at);
  try {
    return formatLocalDate(currentPeriodStart(cron, at));
  } catch {
    return formatLocalDate(at);
  }
}
