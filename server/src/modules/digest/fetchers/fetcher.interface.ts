/**
 * FetcherInterface — 信息源拉取的统一抽象。
 *
 * 设计决策：
 * - FetchedItem 是跨 type 的统一数据形状，下游（AI 判定、去重）只接触这个类型，
 *   不需要关心具体是 RSS / Webpage / API / Mailbox。
 * - search / readFull 是可选能力，没实现的 fetcher 直接 throw；调用方按需 try/catch。
 * - config 使用 Record<string, unknown> 对应 InfoSource.config（Mixed 字段），
 *   具体 fetcher 内部自行 cast 并校验。
 */
import type { InfoSourceType } from '../info-source.entity';

/** 统一的"信息源条目" —— 所有 type 的 fetcher 都输出这个形状 */
export interface FetchedItem {
  /** RSS guid / 网页 URL / API id —— 唯一标识，保证非空 */
  itemGuid: string;
  title: string;
  url: string;
  publishedAt?: Date;
  /** 摘要正文（去 HTML 标签后纯文本，<= 800 字符） */
  snippet: string;
}

export interface FetchOptions {
  /** 取多少条（fetcher 内部硬上限，比如 RSS 一般 50） */
  limit?: number;
  /** 只要这个时间之后发的 */
  since?: Date;
}

export interface SourceFetcher {
  readonly type: InfoSourceType;

  /** 拉源最新条目 */
  fetch(
    config: Record<string, unknown>,
    options?: FetchOptions,
  ): Promise<FetchedItem[]>;

  /**
   * 在源里搜某主题（可选实现）。
   * RSS 实现：在 fetch 结果里 full-text 过滤（含 query 子串的 items）。
   * 没实现的 fetcher 直接 throw NotImplementedException。
   */
  search?(
    config: Record<string, unknown>,
    query: string,
    options?: FetchOptions,
  ): Promise<FetchedItem[]>;

  /**
   * 拉某条 item 的全文（可选实现）。
   * RSS 实现：返回 content:encoded 字段（如有），无则 throw。
   */
  readFull?(config: Record<string, unknown>, itemGuid: string): Promise<string>;
}
