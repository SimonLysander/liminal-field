/**
 * FetcherInterface — 信息源拉取的统一抽象（Fetcher 插件架构 v2）。
 *
 * v2 关键变化（vs 老 v1）：
 * - 路由 key 从 InfoSourceType（rss/webpage/api/mailbox 4 种 discriminator）
 *   升级为 FetcherKind（11 种具体抓取实现）。
 *   理由：实测 23 个源里 13 个不走 RSS（arxiv API / HN Firebase / 掘金 POST /
 *   知乎日报 / GitHub Trending HTML / sitemap scrape …），用 type 当 key 没法
 *   区分这些细分能力。
 * - fetch 接收整个 InfoSource 实例而非裸 config，让 fetcher 拿到 source.name
 *   用于日志、source.config 自己 cast。
 * - 接口新增 keywords 形参：能服务端 query 的源（arxiv / HN Algolia）原生 query；
 *   不能的源 fetcher 内部本地 title+snippet OR 过滤——对调用方透明。
 * - 删除 search? / readFull?（外部无人调，能力被 keywords + web_fetch 覆盖）。
 */
import type { InfoSource } from '../info-source.entity';

/**
 * 信息源抓取方式枚举 — 每种 kind 对应一个 Fetcher 实现类。
 *
 * 加新源 = 加新 kind + 实现一个 Fetcher。
 * registry 自动按 kind 路由，工具层完全不感知。
 */
export enum FetcherKind {
  /** 通用 RSS/Atom 解析（量子位/Latent/Simon Willison/dev.to/Lobsters/OpenAI … 9 站共用） */
  rss = 'rss',
  /** arXiv 官方 API（export.arxiv.org/api/query），config: { category: 'cs.AI' } */
  arxiv = 'arxiv',
  /** HuggingFace daily papers JSON API */
  hf_papers = 'hf_papers',
  /** Hacker News Firebase API（topstories + item/<id>） */
  hn_firebase = 'hn_firebase',
  /** V2EX 官方 API（/api/topics/latest.json） */
  v2ex = 'v2ex',
  /** 掘金 POST API（recommend_cate_feed），config: { cateId } */
  juejin = 'juejin',
  /** 知乎日报移动端 API（news-at.zhihu.com/api/4/news/latest） */
  zhihu_daily = 'zhihu_daily',
  /** 阮一峰科技爱好者周刊（GitHub Issues 自荐池） */
  ruanyf_weekly = 'ruanyf_weekly',
  /** GitHub Trending HTML 解析，config: { language: 'typescript' } */
  github_trending = 'github_trending',
  /** The Batch 列表页 HTML scrape（DeepLearning.AI） */
  the_batch = 'the_batch',
  /** AlphaSignal sitemap.xml + 详情页 scrape */
  alpha_signal = 'alpha_signal',
}

/** 统一"信息源条目" —— 所有 kind 的 fetcher 都输出这个形状 */
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
  /**
   * 关键词过滤（OR 语义：命中任一即返回）。
   * 能服务端 query 的源（arxiv/HN Algolia） → 拼进 query 参数；
   * 不能的源 → fetcher 内部本地过滤 title+snippet。
   * 对调用方完全透明。
   */
  keywords?: string[];
}

export interface SourceFetcher {
  /** 路由 key — registry 按此分发 */
  readonly kind: FetcherKind;
  /**
   * 是否原生支持服务端 keyword 检索。
   * - true：keywords 传给 server，能命中历史而非仅最近窗口（arxiv / HN Algolia）
   * - false：fetcher 内部本地过滤最近窗口（绝大多数 RSS / 第三方 API）
   * 调用方目前无需关心，留作 prompt 提示用（"keyword 在这类源上仅过滤最近窗口"）。
   */
  readonly supportsServerQuery: boolean;

  /**
   * 拉取该源最新条目。
   * @param source 完整 InfoSource 实例（fetcher 自己读 source.config / source.name）
   * @param options limit / since / keywords
   */
  fetch(source: InfoSource, options?: FetchOptions): Promise<FetchedItem[]>;
}
