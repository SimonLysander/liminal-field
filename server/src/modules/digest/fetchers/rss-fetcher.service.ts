/**
 * RssFetcher — 通用 RSS/Atom 信息源拉取实现（FetcherKind.rss）。
 *
 * 适用范围：23 seed 源里 9 个走原生 RSS（量子位/Latent/Simon Willison/dev.to/Lobsters/
 *   OpenAI/InfoQ/少数派/Pragmatic Engineer/Import AI/Every…）。
 *
 * v2 关键变化（Fetcher 插件架构重构）：
 * - kind 字段（取代 type），新增 supportsServerQuery=false（RSS 协议无 query 参数）
 * - fetch(source, opts) 新签名：第 1 参直接接 InfoSource 实例（让 fetcher 拿到 source.name 写日志）
 * - 内置 keywords 本地过滤：title + snippet 任一含 keywords 中任一关键词即命中（OR 语义、不区分大小写）
 *   对调用方透明 —— browse 工具不用感知 RSS 没有原生 query
 * - 删 search? / readFull?（外部无调用，能力被 keywords + web_fetch 替代）
 *
 * 实现要点：
 * - 依赖 rss-parser 库（不手写 XML）；parseURL 走库内置 http(s)
 * - itemGuid 退化链：item.guid → item.link → `${url}#${index}`，保证非空
 * - snippet 退化链：contentSnippet → stripHtml(content:encoded) → stripHtml(description) → ''，截 800 字符
 * - options.since 过滤在排序后、limit 截断前；keywords 过滤在 since 之后
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import Parser from 'rss-parser';

import type { InfoSource } from '../info-source.entity';
import {
  FetcherKind,
  type SourceFetcher,
  type FetchedItem,
  type FetchOptions,
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
  readonly kind = FetcherKind.rss;
  // RSS 协议无原生 query 参数，keywords 只能本地过滤最近窗口（agent prompt 会提示这一点）
  readonly supportsServerQuery = false;

  private readonly logger = new Logger(RssFetcher.name);

  /**
   * 拉 RSS 源最新条目并转换为 FetchedItem[]。
   * 流程：校验 url → parseURL → 排序 → since 过滤 → keywords 过滤 → limit 截断
   */
  async fetch(
    source: InfoSource,
    options?: FetchOptions,
  ): Promise<FetchedItem[]> {
    const { url } = source.config as { url?: string };

    if (!isValidHttpUrl(url)) {
      throw new BadRequestException(
        `rss: source 「${source.name}」 的 config.url 不合法 (${String(url)})`,
      );
    }

    const limit = options?.limit ?? DEFAULT_LIMIT;
    const since = options?.since;
    const keywords = options?.keywords;

    this.logger.debug(
      `[fetch] 「${source.name}」 url=${url} limit=${limit} since=${since?.toISOString() ?? 'none'} keywords=${keywords?.join('|') ?? 'none'}`,
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
        `[fetch] 「${source.name}」 拉取完成 items=${rawItems.length} duration=${Date.now() - t0}ms`,
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `[fetch] 「${source.name}」 parseURL 失败 url=${url} err=${e.message}`,
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
    const afterSince = since
      ? items.filter((it) => it.publishedAt && it.publishedAt > since)
      : items;

    // keywords 过滤：title + snippet 任一含任一 keyword 即命中（不区分大小写、OR 语义）
    const afterKeywords =
      keywords && keywords.length > 0
        ? afterSince.filter((it) => matchesAnyKeyword(it, keywords))
        : afterSince;

    const result = afterKeywords.slice(0, limit);
    this.logger.log(
      `[fetch] 「${source.name}」 完成 total=${rawItems.length} afterSince=${afterSince.length} afterKeywords=${afterKeywords.length} returned=${result.length}`,
    );
    return result;
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

/** 不区分大小写、OR 语义：title 或 snippet 含 keywords 中任一即返回 true */
function matchesAnyKeyword(item: FetchedItem, keywords: string[]): boolean {
  const haystack = `${item.title} ${item.snippet}`.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}
