/**
 * web-search-provider — Aurora 联网搜索的 provider 抽象。
 *
 * 为什么抽象:国内服务器调"搜索 API 中间商"(中间商自己出海搜 Google/Bing),
 * 不同中间商 API 稳定性/价格/质量各异(Tavily/Serper.dev/SerpAPI/Brave/...),
 * 抽象一层让切换 provider 只改 .env 不动消费方。
 *
 * 首发 provider:Tavily(免费 1000 次/月自动续 + LLM 友好返回结构)。
 * 切换 provider 只需:1) 加一个 `XxxWebSearchProvider implements WebSearchProvider`,
 * 2) `createWebSearchProviderFromEnv` 加一个 case,3) `.env` 改 `WEB_SEARCH_PROVIDER`。
 */

export interface WebSearchOptions {
  /** 1-10,默认 5 */
  maxResults?: number;
  /** 'general' 通用 / 'news' 偏新闻类(provider 决定是否支持) */
  topic?: 'general' | 'news';
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  /** provider 已抽取的摘要片段(LLM 可直接读) */
  content: string;
  /** 0-1 相关度分数(部分 provider 提供;无则 undefined) */
  score?: number;
}

export interface WebSearchResponse {
  query: string;
  /** provider 内置答案合成(若支持),否则 undefined */
  answer?: string;
  results: WebSearchResultItem[];
  /** 实际搜索 provider 名,便于排障 */
  provider: string;
  /** provider 端耗时(秒) */
  responseTimeSec?: number;
}

/**
 * 错误分类:
 * - missing_key:配置缺失(没设 TAVILY_API_KEY 等),归 `status:invalid`(用户层错误)
 * - network/timeout:第三方不可达,归 `status:error`
 * - rate_limited:超限,归 `status:error` 带提示
 * - bad_request:query 太短/参数非法,归 `status:invalid`
 */
export class WebSearchError extends Error {
  constructor(
    public readonly kind:
      | 'missing_key'
      | 'network'
      | 'timeout'
      | 'rate_limited'
      | 'bad_request'
      | 'unknown',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WebSearchError';
  }
}

export interface WebSearchProvider {
  readonly name: string;
  search(query: string, options: WebSearchOptions): Promise<WebSearchResponse>;
}

// ──────────────────────────────────────────────────────────────────────────
// Tavily 实现
// ──────────────────────────────────────────────────────────────────────────

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
/** 第三方 API 防雪崩兜底超时 — Tavily basic search 一般 < 3s,留 15s 富余 */
const DEFAULT_TIMEOUT_MS = 15_000;

interface TavilyRawResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

interface TavilyRawResponse {
  query: string;
  answer?: string;
  results?: TavilyRawResult[];
  response_time?: number;
}

export class TavilyWebSearchProvider implements WebSearchProvider {
  readonly name = 'tavily';

  constructor(
    private readonly apiKey: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async search(
    query: string,
    options: WebSearchOptions,
  ): Promise<WebSearchResponse> {
    if (!this.apiKey) {
      throw new WebSearchError('missing_key', 'TAVILY_API_KEY 未配置');
    }
    if (!query || query.trim().length === 0) {
      throw new WebSearchError('bad_request', 'query 不能为空');
    }

    const maxResults = Math.max(1, Math.min(10, options.maxResults ?? 5));
    const topic = options.topic ?? 'general';

    // AbortController 兜底超时(原生 fetch 在 Node 18+ 支持)
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(TAVILY_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          query,
          topic,
          max_results: maxResults,
          search_depth: 'basic',
          // Tavily 的 include_answer 会让 API 多花 1-2 秒做总结;
          // 我们这里默认开 'basic' (短答案) — 写作场景需要"有依据"
          include_answer: 'basic',
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new WebSearchError(
          'timeout',
          `Tavily 请求超时 (${this.timeoutMs}ms)`,
          err,
        );
      }
      throw new WebSearchError(
        'network',
        `Tavily 网络错误: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    clearTimeout(timer);

    if (res.status === 401) {
      throw new WebSearchError('missing_key', 'Tavily API key 无效或失效');
    }
    if (res.status === 429) {
      throw new WebSearchError('rate_limited', 'Tavily 请求超限,稍后重试');
    }
    if (!res.ok) {
      throw new WebSearchError(
        'unknown',
        `Tavily 返回 HTTP ${res.status}: ${await res.text().catch(() => '')}`,
      );
    }

    const raw = (await res.json()) as TavilyRawResponse;
    const results = (raw.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    }));

    return {
      query: raw.query ?? query,
      answer: raw.answer,
      results,
      provider: this.name,
      responseTimeSec: raw.response_time,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 工厂:按 .env 配置返回实例
// ──────────────────────────────────────────────────────────────────────────

/**
 * 按 .env 选择 provider 并构造实例。
 *
 * 当前只有 tavily;切 provider 时此处加 case + 实现新 class 即可。
 * 没配 key → 返 undefined,装配层据此决定不挂载 web_search 工具(模型看不到就不会调)。
 */
export function createWebSearchProviderFromEnv():
  | WebSearchProvider
  | undefined {
  const provider = process.env.WEB_SEARCH_PROVIDER?.toLowerCase() ?? 'tavily';

  if (provider === 'tavily') {
    const key = process.env.TAVILY_API_KEY?.trim();
    if (!key) return undefined;
    return new TavilyWebSearchProvider(key);
  }

  // 切换 provider 时这里 fall-through 提示

  console.warn(`[web-search] 未知 WEB_SEARCH_PROVIDER=${provider},工具未挂载`);
  return undefined;
}
