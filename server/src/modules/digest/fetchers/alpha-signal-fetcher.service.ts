/**
 * AlphaSignalFetcher — AlphaSignal sitemap.xml 解析（FetcherKind.alpha_signal）。
 *
 * endpoint: https://alphasignal.ai/sitemap.xml
 * config 期望：{}
 *
 * 解析：regex 提取 <loc>（/news/ 路径）和紧邻 <lastmod>，不引 XML 解析库。
 * title = URL 最后 segment 转可读（slug.replace(/-/g, ' ')）。
 * snippet = ''（首页 sitemap 无正文，详情需 web_fetch 深读）。
 */
import { Injectable, Logger } from '@nestjs/common';

import type { InfoSource } from '../info-source.entity';
import {
  FetcherKind,
  type SourceFetcher,
  type FetchedItem,
  type FetchOptions,
} from './fetcher.interface';
import { httpGetText, applyTimeWindow } from './http.utils';
import { matchesAnyKeyword } from './keyword-match.util';

const DEFAULT_LIMIT = 30;
const ENDPOINT = 'https://alphasignal.ai/sitemap.xml';

@Injectable()
export class AlphaSignalFetcher implements SourceFetcher {
  readonly kind = FetcherKind.alpha_signal;
  readonly supportsServerQuery = false;

  private readonly logger = new Logger(AlphaSignalFetcher.name);

  async fetch(
    source: InfoSource,
    options?: FetchOptions,
  ): Promise<FetchedItem[]> {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const since = options?.since;
    const until = options?.until;
    const keywords = options?.keywords;

    this.logger.debug(
      `[fetch] 「${source.name}」 url=${ENDPOINT} limit=${limit} since=${since?.toISOString() ?? 'none'} keywords=${keywords?.join('|') ?? 'none'}`,
    );
    const t0 = Date.now();

    let xml: string;
    try {
      xml = await httpGetText(ENDPOINT, { label: source.name });
      this.logger.debug(
        `[fetch] 「${source.name}」 拉取完成 xmlLen=${xml.length} duration=${Date.now() - t0}ms`,
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `[fetch] 「${source.name}」 fetch 失败 err=${e.message}`,
        e.stack,
      );
      throw new Error(`alpha_signal: fetch failed - ${e.message}`);
    }

    const items = parseAlphaSignalSitemap(xml);

    // 按发布时间倒序（lastmod）
    items.sort((a, b) => {
      if (!a.publishedAt && !b.publishedAt) return 0;
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return b.publishedAt.getTime() - a.publishedAt.getTime();
    });

    const afterSince = applyTimeWindow(items, since, until);

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
 * 从 sitemap XML 提取 /news/ 路径的条目。
 * 每个 <url> 块内匹配 <loc> 和 <lastmod>（lastmod 紧跟 loc 后）。
 */
function parseAlphaSignalSitemap(xml: string): FetchedItem[] {
  const items: FetchedItem[] = [];

  // 匹配 <url>...</url> 块（sitemap 标准结构）
  const urlBlockRe = /<url>([\s\S]*?)<\/url>/g;
  let block: RegExpExecArray | null;

  while ((block = urlBlockRe.exec(xml)) !== null) {
    const content = block[1];

    // 只处理 /news/ 路径
    const locMatch =
      /<loc>(https:\/\/alphasignal\.ai\/news\/[^<]+)<\/loc>/.exec(content);
    if (!locMatch) continue;

    const loc = locMatch[1];
    const lastmodMatch = /<lastmod>([^<]+)<\/lastmod>/.exec(content);
    const publishedAt = lastmodMatch ? new Date(lastmodMatch[1]) : undefined;

    // slug = URL 最后 segment
    const slug = loc.split('/').filter(Boolean).pop() ?? '';
    const title = slug.replace(/-/g, ' ');

    items.push({
      itemGuid: loc, // URL 直接当 guid，唯一性强
      title,
      url: loc,
      publishedAt,
      snippet: '',
    });
  }

  return items;
}
