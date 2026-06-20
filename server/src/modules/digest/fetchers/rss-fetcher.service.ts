/**
 * RssFetcher — RSS 信息源的具体拉取实现。
 *
 * 设计要点：
 * - 依赖 rss-parser 库，不手写 XML 解析；parseURL 走库内置 http(s) 请求。
 * - itemGuid 退化链：item.guid → item.link → `${url}#${index}`，确保不空。
 * - snippet 退化链：contentSnippet → stripHtml(content) → stripHtml(description) → ''，截 800 字符。
 * - options.since 过滤在排序后、limit 截断前执行（先按发布时间倒序）。
 * - readFull 从 rss-parser 扩展字段 'content:encoded' 读全文，不发第二次 HTTP。
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import Parser from 'rss-parser';

import { InfoSourceType } from '../info-source.entity';
import type {
  SourceFetcher,
  FetchedItem,
  FetchOptions,
} from './fetcher.interface';

// rss-parser 自定义字段：让 content:encoded 出现在类型里
type CustomItem = {
  'content:encoded'?: string;
  'content:encodedSnippet'?: string;
};

type RssItem = Parser.Item & CustomItem;

const DEFAULT_LIMIT = 50;
const SNIPPET_MAX_LENGTH = 800;

/** 简单去 HTML 标签 + 解码常见 HTML 实体 */
function stripHtml(html: string | undefined | null): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ') // 去标签，替换为空格避免词粘连
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ') // 合并多余空白
    .trim();
}

/** 校验 url 是合法的 http(s):// 地址 */
function isValidHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

@Injectable()
export class RssFetcher implements SourceFetcher {
  readonly type = InfoSourceType.rss;
  private readonly logger = new Logger(RssFetcher.name);

  /**
   * 拉 RSS 源最新条目并转换为 FetchedItem[]。
   * 流程：校验 url → parseURL → 转换 → 排序 → since 过滤 → limit 截断
   */
  async fetch(
    config: Record<string, unknown>,
    options?: FetchOptions,
  ): Promise<FetchedItem[]> {
    const { url } = config as { url?: string };

    if (!isValidHttpUrl(url)) {
      throw new BadRequestException('rss: url invalid');
    }

    const limit = options?.limit ?? DEFAULT_LIMIT;
    const since = options?.since;

    this.logger.debug(
      `[RssFetcher.fetch] 开始拉取 url=${url} limit=${limit} since=${since?.toISOString() ?? 'none'}`,
    );
    const t0 = Date.now();

    // rss-parser 需要声明自定义字段才能在结果里拿到
    const parser = new Parser<Record<string, unknown>, CustomItem>({
      customFields: {
        item: [
          ['content:encoded', 'content:encoded'],
          ['content:encodedSnippet', 'content:encodedSnippet'],
        ],
      },
    });

    let rawItems: RssItem[];
    try {
      const feed = await parser.parseURL(url);
      rawItems = feed.items;
      this.logger.debug(
        `[RssFetcher.fetch] 拉取完成 items=${rawItems.length} duration=${Date.now() - t0}ms`,
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `[RssFetcher.fetch] parseURL 失败 url=${url} err=${e.message}`,
        e.stack,
      );
      throw new Error('rss: fetch failed');
    }

    // 转换为统一 FetchedItem
    const items: FetchedItem[] = rawItems.map((item, index) => {
      const itemGuid = item.guid ?? item.link ?? `${url}#${index}`;

      const publishedAt = parseDate(item.isoDate ?? item.pubDate);

      const snippet = buildSnippet(item);

      return {
        itemGuid,
        title: item.title ?? '(无标题)',
        url: item.link ?? '',
        publishedAt,
        snippet,
      };
    });

    // 按发布时间倒序（无时间的排末尾）
    items.sort((a, b) => {
      if (!a.publishedAt && !b.publishedAt) return 0;
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return b.publishedAt.getTime() - a.publishedAt.getTime();
    });

    // since 过滤：只保留 publishedAt > since 的条目
    const filtered = since
      ? items.filter((it) => it.publishedAt && it.publishedAt > since)
      : items;

    const result = filtered.slice(0, limit);
    this.logger.log(
      `[RssFetcher.fetch] 完成 url=${url} total=${rawItems.length} after_filter=${filtered.length} returned=${result.length}`,
    );
    return result;
  }

  /**
   * 在 fetch 结果里做 full-text 过滤（title + snippet 含 query 子串）。
   */
  async search(
    config: Record<string, unknown>,
    query: string,
    options?: FetchOptions,
  ): Promise<FetchedItem[]> {
    this.logger.debug(`[RssFetcher.search] query="${query}"`);
    const items = await this.fetch(config, options);
    const q = query.toLowerCase();
    return items.filter(
      (it) =>
        it.title.toLowerCase().includes(q) ||
        it.snippet.toLowerCase().includes(q),
    );
  }

  /**
   * 返回指定 itemGuid 的全文（content:encoded）。
   * 因为 rss-parser 不支持单条请求，需重新 fetch 整个 feed 再找。
   * 如果 content:encoded 不存在则抛错。
   */
  async readFull(
    config: Record<string, unknown>,
    itemGuid: string,
  ): Promise<string> {
    this.logger.debug(`[RssFetcher.readFull] itemGuid=${itemGuid}`);

    const { url } = config as { url?: string };
    if (!isValidHttpUrl(url)) {
      throw new BadRequestException('rss: url invalid');
    }

    const parser = new Parser<Record<string, unknown>, CustomItem>({
      customFields: {
        item: [['content:encoded', 'content:encoded']],
      },
    });

    let rawItems: RssItem[];
    try {
      const feed = await parser.parseURL(url);
      rawItems = feed.items;
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `[RssFetcher.readFull] parseURL 失败 url=${url}`,
        e.stack,
      );
      throw new Error('rss: fetch failed');
    }

    // 找到 guid 或 link 匹配的条目
    const found = rawItems.find(
      (item, index) =>
        (item.guid ?? item.link ?? `${url}#${index}`) === itemGuid,
    );

    const fullContent = found?.['content:encoded'];
    if (!fullContent) {
      throw new Error('rss: full content not available');
    }

    return fullContent;
  }
}

/** 解析 isoDate / pubDate 字符串为 Date，无法解析返回 undefined */
function parseDate(raw: string | undefined | null): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? undefined : d;
}

/** 按退化链构建 snippet，截断到 SNIPPET_MAX_LENGTH */
function buildSnippet(item: RssItem): string {
  const raw =
    item.contentSnippet ??
    stripHtml(item['content:encoded']) ??
    stripHtml(item.content) ??
    stripHtml(item.summary) ??
    '';
  return raw.slice(0, SNIPPET_MAX_LENGTH);
}
