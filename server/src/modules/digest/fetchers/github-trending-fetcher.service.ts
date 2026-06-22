/**
 * GithubTrendingFetcher — GitHub Trending HTML scrape（FetcherKind.github_trending）。
 *
 * endpoint: https://github.com/trending/<language>?since=daily
 * config 期望：{ language: 'typescript' }
 *
 * 不引 cheerio，用 regex 提取：
 * - h2.h3 区块内找 href="/owner/repo"（排除 /apps/ /login 等系统路径，只取 /<word>/<word> 格式）
 * - description 在 h2 后第一个 <p class="col-9 color-fg-muted..."> 里
 *
 * publishedAt = undefined（GitHub Trending 没有每日时间戳）。
 * snippet = description（HTML 解码后截 800）。
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

const DEFAULT_LIMIT = 25;

@Injectable()
export class GithubTrendingFetcher implements SourceFetcher {
  readonly kind = FetcherKind.github_trending;
  readonly supportsServerQuery = false;

  private readonly logger = new Logger(GithubTrendingFetcher.name);

  async fetch(
    source: InfoSource,
    options?: FetchOptions,
  ): Promise<FetchedItem[]> {
    const cfg = source.config as { language?: string };
    const language = cfg?.language ?? '';
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const since = options?.since;
    const until = options?.until;
    const keywords = options?.keywords;

    const url = `https://github.com/trending/${encodeURIComponent(language)}?since=daily`;

    this.logger.debug(
      `[fetch] 「${source.name}」 url=${url} limit=${limit} since=${since?.toISOString() ?? 'none'} keywords=${keywords?.join('|') ?? 'none'}`,
    );
    const t0 = Date.now();

    let html: string;
    try {
      html = await httpGetText(url, { label: source.name });
      this.logger.debug(
        `[fetch] 「${source.name}」 拉取完成 htmlLen=${html.length} duration=${Date.now() - t0}ms`,
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `[fetch] 「${source.name}」 fetch 失败 err=${e.message}`,
        e.stack,
      );
      throw new Error(`github_trending: fetch failed - ${e.message}`);
    }

    const items = parseGithubTrending(html);

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
 * 从 GitHub Trending HTML 提取 repo 列表。
 * 策略：按 <article class="Box-row"> 切分每个 repo 块，在块内分别提取 owner/repo 和 description。
 * 比全局正则更稳健，避免跨 repo 匹配混乱。
 */
function parseGithubTrending(html: string): FetchedItem[] {
  const items: FetchedItem[] = [];

  // 每个 trending repo 都包裹在 <article class="Box-row"> 里
  const articleBlocks = html.split(
    /<article\s[^>]*class="[^"]*Box-row[^"]*"[^>]*>/,
  );

  for (let i = 1; i < articleBlocks.length; i++) {
    const block = articleBlocks[i];

    // 找 href="/owner/repo"（纯 2 段路径，排除系统路径 /apps/ /login 等）
    const repoMatch = /href="\/([\w.-]+)\/([\w.-]+)"/.exec(block);
    if (!repoMatch) continue;

    const owner = repoMatch[1];
    const repo = repoMatch[2];

    // 排除非 repo 路径（starts with apps, login, marketplace, topics 等）
    const systemPaths = [
      'apps',
      'login',
      'marketplace',
      'topics',
      'trending',
      'explore',
    ];
    if (systemPaths.includes(owner.toLowerCase())) continue;

    // description 在 <p class="col-9 color-fg-muted ..."> 里
    const descMatch =
      /<p\s[^>]*class="[^"]*col-9[^"]*color-fg-muted[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(
        block,
      );
    const rawDesc = descMatch ? descMatch[1].trim() : '';
    const description = decodeHtmlEntities(
      rawDesc
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );

    items.push({
      itemGuid: `gh_${owner}_${repo}`,
      title: `${owner}/${repo}`,
      url: `https://github.com/${owner}/${repo}`,
      publishedAt: undefined,
      snippet: description.slice(0, 800),
    });
  }

  return items;
}

/** 解码常见 HTML 实体 */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
