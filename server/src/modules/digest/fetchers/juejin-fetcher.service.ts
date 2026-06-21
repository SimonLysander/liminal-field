/**
 * JuejinFetcher — 掘金推荐文章 POST API（FetcherKind.juejin）。
 *
 * endpoint: https://api.juejin.cn/recommend_api/v1/article/recommend_cate_feed（POST）
 * config 期望：{ cateId: '6809637767543259144' }（前端分类 ID，也可传后端 ID）
 *
 * 响应校验：先检查 err_no === 0，否则 throw，让 registry.fetchMany 兜底 status=failed。
 */
import { Injectable, Logger } from '@nestjs/common';

import type { InfoSource } from '../info-source.entity';
import {
  FetcherKind,
  type SourceFetcher,
  type FetchedItem,
  type FetchOptions,
} from './fetcher.interface';
import { httpPostJson } from './http.utils';

const DEFAULT_LIMIT = 20;
const SNIPPET_MAX_LENGTH = 800;
const ENDPOINT =
  'https://api.juejin.cn/recommend_api/v1/article/recommend_cate_feed';

interface JuejinArticleInfo {
  article_id: string;
  title: string;
  brief_content?: string;
  ctime: string;
}

interface JuejinDataItem {
  article_info: JuejinArticleInfo;
}

interface JuejinResponse {
  err_no: number;
  err_msg?: string;
  data: JuejinDataItem[];
}

@Injectable()
export class JuejinFetcher implements SourceFetcher {
  readonly kind = FetcherKind.juejin;
  readonly supportsServerQuery = false;

  private readonly logger = new Logger(JuejinFetcher.name);

  async fetch(
    source: InfoSource,
    options?: FetchOptions,
  ): Promise<FetchedItem[]> {
    const cfg = source.config as { cateId?: string };
    const cateId = cfg?.cateId ?? '6809637767543259144';
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const since = options?.since;
    const keywords = options?.keywords;

    this.logger.debug(
      `[fetch] 「${source.name}」 url=${ENDPOINT} cateId=${cateId} limit=${limit} since=${since?.toISOString() ?? 'none'} keywords=${keywords?.join('|') ?? 'none'}`,
    );
    const t0 = Date.now();

    let body: JuejinResponse;
    try {
      body = await httpPostJson<JuejinResponse>(
        ENDPOINT,
        {
          id_type: 2,
          client_type: 2608,
          sort_type: 200,
          cate_id: cateId,
          cursor: '0',
          limit: limit,
        },
        { label: source.name },
      );
      this.logger.debug(
        `[fetch] 「${source.name}」 拉取完成 items=${body.data?.length ?? 0} duration=${Date.now() - t0}ms`,
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `[fetch] 「${source.name}」 fetch 失败 err=${e.message}`,
        e.stack,
      );
      throw new Error(`juejin: fetch failed - ${e.message}`);
    }

    // 掘金 API 错误码
    if (body.err_no !== 0) {
      throw new Error(
        `juejin: API error err_no=${body.err_no} msg=${body.err_msg ?? ''}`,
      );
    }

    const items: FetchedItem[] = body.data.map(({ article_info }) => ({
      itemGuid: `juejin_${article_info.article_id}`,
      title: article_info.title,
      url: `https://juejin.cn/post/${article_info.article_id}`,
      publishedAt: new Date(parseInt(article_info.ctime, 10) * 1000),
      snippet: (article_info.brief_content ?? '').slice(0, SNIPPET_MAX_LENGTH),
    }));

    // 按发布时间倒序
    items.sort((a, b) => {
      if (!a.publishedAt && !b.publishedAt) return 0;
      if (!a.publishedAt) return 1;
      if (!b.publishedAt) return -1;
      return b.publishedAt.getTime() - a.publishedAt.getTime();
    });

    const afterSince = since
      ? items.filter((it) => it.publishedAt && it.publishedAt > since)
      : items;

    const afterKeywords =
      keywords && keywords.length > 0
        ? afterSince.filter((it) => matchesAnyKeyword(it, keywords))
        : afterSince;

    const result = afterKeywords.slice(0, limit);
    this.logger.log(
      `[fetch] 「${source.name}」 完成 total=${body.data.length} afterSince=${afterSince.length} afterKeywords=${afterKeywords.length} returned=${result.length}`,
    );
    return result;
  }
}

function matchesAnyKeyword(item: FetchedItem, keywords: string[]): boolean {
  const haystack = `${item.title} ${item.snippet}`.toLowerCase();
  return keywords.some((k) => haystack.includes(k.toLowerCase()));
}
