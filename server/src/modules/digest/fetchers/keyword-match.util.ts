/**
 * keyword 匹配 —— 全部 fetcher 共用(替代各源重复的子串版 matchesAnyKeyword)。
 *
 * 语义:keywords 是「正则」数组,OR —— title+snippet 命中任一正则即返回。
 * 设计:
 * - 每个 pattern 按正则编译('i' 不区分大小写、'u' 支持 Unicode/中文);
 *   非法正则或超长(>200)→ 降级为「字面子串」(转义元字符后匹配),绝不抛错丢条目。
 * - 来源是 agent(可信),原生 RegExp 足够;不引 re2 native 依赖(避免 Docker 部署编译负担)。
 *   超长降级 + 编译缓存兜住病态/重复 pattern,实务上 ReDoS 风险可忽略。
 * - 子串版的硬伤(`agent` 误中 `agentic`、`ai` 在中英混排里泛滥)靠正则词边界 `\bagent\b` 治;
 *   中文无 `\b`,agent 可用交替正则(`科技|大模型`)表达,比纯子串精准。
 */
import type { FetchedItem } from './fetcher.interface';

const MAX_PATTERN_LEN = 200;
const reCache = new Map<string, RegExp>();

/** 把字面串里的正则元字符转义,供「非法正则降级」时按字面匹配 */
function escapeLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 编译 pattern → RegExp(带缓存);非法/超长降级为字面匹配,不抛错 */
function compile(pattern: string): RegExp {
  const cached = reCache.get(pattern);
  if (cached) return cached;
  let re: RegExp;
  try {
    if (pattern.length > MAX_PATTERN_LEN) throw new Error('pattern too long');
    re = new RegExp(pattern, 'iu');
  } catch {
    // 非法正则(或超长)→ 退回字面子串,保证 agent 写错也不丢匹配能力
    re = new RegExp(escapeLiteral(pattern), 'i');
  }
  // pattern 来自 agent、量很小;上限兜底防极端情况下缓存无界增长
  if (reCache.size > 500) reCache.clear();
  reCache.set(pattern, re);
  return re;
}

/** title+snippet 命中任一正则即返回(OR、不区分大小写) */
export function matchesAnyKeyword(
  item: FetchedItem,
  keywords: string[],
): boolean {
  const haystack = `${item.title} ${item.snippet}`;
  return keywords.some((k) => k.length > 0 && compile(k).test(haystack));
}
