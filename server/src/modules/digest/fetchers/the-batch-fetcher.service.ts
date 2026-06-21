/**
 * TheBatchFetcher — DeepLearning.AI The Batch 列表页 HTML scrape（FetcherKind.the_batch）。
 *
 * endpoint: https://www.deeplearning.ai/the-batch/
 * config 期望：{}
 *
 * 解析策略（不引 cheerio，regex 提取）：
 * 1. 抓所有 href="/the-batch/issue-NNN/" 链接（期刊链接）
 * 2. 紧邻的 <h2> 文本作为 title（无法精确关联时退化为 slug）
 * publishedAt = undefined（首页无单篇时间戳）
 * snippet = ''（详情需 web_fetch 深读）
 */
import { Injectable, Logger } from '@nestjs/common';

import type { InfoSource } from '../info-source.entity';
import {
  FetcherKind,
  type SourceFetcher,
  type FetchedItem,
  type FetchOptions,
} from './fetcher.interface';

const DEFAULT_LIMIT = 20;
const SNIPPET_MAX_LENGTH = 800;
const DEFAULT_UA = 'Mozilla/5.0 (LimialFieldBot/1.0)';
const ENDPOINT = 'https://www.deeplearning.ai/the-batch/';

@Injectable()
export class TheBatchFetcher implements SourceFetcher {
  readonly kind = FetcherKind.the_batch;
  readonly supportsServerQuery = false;

  private readonly logger = new Logger(TheBatchFetcher.name);

  async fetch(
    source: InfoSource,
    options?: FetchOptions,
  ): Promise<FetchedItem[]> {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const since = options?.since;
    const keywords = options?.keywords;

    this.logger.debug(
      `[fetch] 「${source.name}」 url=${ENDPOINT} limit=${limit} since=${since?.toISOString() ?? 'none'} keywords=${keywords?.join('|') ?? 'none'}`,
    );
    const t0 = Date.now();

    let html: string;
    try {
      const res = await fetch(ENDPOINT, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': DEFAULT_UA },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      html = await res.text();
      this.logger.debug(
        `[fetch] 「${source.name}」 拉取完成 htmlLen=${html.length} duration=${Date.now() - t0}ms`,
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `[fetch] 「${source.name}」 fetch 失败 err=${e.message}`,
        e.stack,
      );
      throw new Error(`the_batch: fetch failed - ${e.message}`);
    }

    const items = parseTheBatch(html);

    // since 和 keywords 过滤（publishedAt=undefined，since 过滤对本 fetcher 无效）
    const afterSince = since
      ? items.filter((it) => it.publishedAt && it.publishedAt > since)
      : items;

    const afterKeywords =
      keywords && keywords.length > 0
        ? afterSince.filter((it) => matchesAnyKeyword(it, keywords))
        : afterSince;

    const result = afterKeywords.slice(0, limit);
    this.logger.log(
      `[fetch] 「${source.name}」 完成 total=${items.length} afterSince=${afterSince.length} afterKeywords=${afterKeywords.length} returned=${result.length}`,
    );
    return result;
  }
}

/**
 * 从 The Batch 首页 HTML 提取 issue 链接列表。
 * 策略：先找所有 issue 链接（href="/the-batch/issue-NNN/" 或通用文章链接），
 * 再在链接附近找 <h2> 标签文本作为 title，去重后返回。
 */
function parseTheBatch(html: string): FetchedItem[] {
  const items: FetchedItem[] = [];
  const seen = new Set<string>();

  // 匹配 /the-batch/issue-NNN/ 链接（最确定的期刊链接）
  const issueRe =
    /href="(\/the-batch\/issue-(\d+)\/)"[^>]*>([\s\S]*?)(?=href="|<\/a>)/g;
  let m: RegExpExecArray | null;

  while ((m = issueRe.exec(html)) !== null) {
    const path = m[1];
    const slug = `issue-${m[2]}`;
    if (seen.has(path)) continue;
    seen.add(path);

    // title：从 href 附近找 <h2> 内容
    const afterHref = html.slice(m.index, m.index + 600);
    const h2Match = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(afterHref);
    const rawTitle = h2Match ? h2Match[1].replace(/<[^>]*>/g, '').trim() : slug;

    items.push({
      itemGuid: `thebatch_${slug}`,
      title: rawTitle || slug,
      url: `https://www.deeplearning.ai${path}`,
      publishedAt: undefined,
      snippet: '',
    });
  }

  // 如果 issue 链接一个都没抓到，降级抓通用文章链接
  if (items.length === 0) {
    const genericRe = /href="(\/the-batch\/([\w-]+)\/)"[^>]*/g;
    const excluded = new Set(['tag', 'page', 'category', 'author']);
    while ((m = genericRe.exec(html)) !== null) {
      const path = m[1];
      const slug = m[2];
      if (seen.has(path) || excluded.has(slug)) continue;
      seen.add(path);

      items.push({
        itemGuid: `thebatch_${slug}`,
        title: slug.replace(/-/g, ' '),
        url: `https://www.deeplearning.ai${path}`,
        publishedAt: undefined,
        snippet: ''.slice(0, SNIPPET_MAX_LENGTH),
      });
    }
  }

  return items;
}

function matchesAnyKeyword(item: FetchedItem, keywords: string[]): boolean {
  const haystack = `${item.title} ${item.snippet}`.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}
