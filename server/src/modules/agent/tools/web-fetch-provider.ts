/**
 * web-fetch-provider — Aurora 读 URL 的 provider 抽象。
 *
 * 与 web_search 互补:
 *   - web_search 给 query → 拿一堆 url + 摘要片段(浅)
 *   - web_fetch 给 url → 拿单页全文 markdown(深读)
 *
 * 默认 provider:auto(direct → Firecrawl → Jina Reader fallback)。direct 用服务器
 * 直抓 + Readability;Firecrawl 负责更强的 JS/反爬/AI-ready markdown;Jina 作为
 * 免费轻量 reader fallback。
 * 切换 provider 同 web-search-provider 模式:加 class + 工厂 case + .env 切换。
 *
 * 不自己写爬虫:SSRF / JS 渲染 / 反爬 / robots.txt 都是坑,业界成熟方案已经
 * 处理过,我们走中间商。
 */

export interface WebFetchOptions {
  /** 截断长度(字符);超出尾部省略。默认 30000 字符 */
  maxLength?: number;
}

export interface WebFetchAttempt {
  provider: string;
  status: 'ok' | 'error';
  kind?: WebFetchError['kind'];
  message?: string;
  durationMs?: number;
}

export interface WebFetchResponse {
  url: string;
  /** 已抽取/转换的 markdown 正文 */
  markdown: string;
  /** 是否被 maxLength 截断 */
  truncated: boolean;
  /** 实际 provider 名 */
  provider: string;
  /** auto provider 下记录每层尝试结果;单 provider 可不填 */
  attempts?: WebFetchAttempt[];
  /** provider 端耗时(秒,部分 provider 不提供) */
  responseTimeSec?: number;
}

export class WebFetchError extends Error {
  constructor(
    public readonly kind:
      | 'invalid_url'
      | 'not_found'
      | 'network'
      | 'timeout'
      | 'rate_limited'
      | 'forbidden'
      | 'too_large'
      | 'unknown',
    message: string,
    public readonly cause?: unknown,
    public readonly attempts?: WebFetchAttempt[],
  ) {
    super(message);
    this.name = 'WebFetchError';
  }
}

export interface WebFetchProvider {
  readonly name: string;
  /** 用于 external cache 区分 provider 链路版本;不填则使用 name。 */
  readonly cacheKey?: string;
  fetch(url: string, options: WebFetchOptions): Promise<WebFetchResponse>;
}

export class AutoWebFetchProvider implements WebFetchProvider {
  readonly name = 'auto';
  readonly cacheKey: string;

  constructor(private readonly providers: WebFetchProvider[]) {
    const chain = providers.map((p) => p.cacheKey ?? p.name).join('-');
    this.cacheKey = `auto:${chain}:v1`;
  }

  async fetch(
    url: string,
    options: WebFetchOptions,
  ): Promise<WebFetchResponse> {
    const attempts: WebFetchAttempt[] = [];
    for (const provider of this.providers) {
      const started = Date.now();
      try {
        const response = await provider.fetch(url, options);
        attempts.push({
          provider: provider.name,
          status: 'ok',
          durationMs: Date.now() - started,
        });
        return { ...response, attempts };
      } catch (err) {
        const kind = err instanceof WebFetchError ? err.kind : 'unknown';
        const message = err instanceof Error ? err.message : String(err);
        attempts.push({
          provider: provider.name,
          status: 'error',
          kind,
          message,
          durationMs: Date.now() - started,
        });
        if (kind === 'invalid_url') {
          throw new WebFetchError(kind, message, err, attempts);
        }
      }
    }

    const last = attempts[attempts.length - 1];
    throw new WebFetchError(
      last?.kind ?? 'network',
      `所有 web_fetch provider 均失败: ${attempts
        .map((a) => `${a.provider}:${a.kind ?? 'unknown'}`)
        .join(', ')}`,
      undefined,
      attempts,
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Firecrawl 实现 — POST https://api.firecrawl.dev/v2/scrape
// ──────────────────────────────────────────────────────────────────────────

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v2/scrape';

type FirecrawlScrapeResponse = {
  success?: boolean;
  error?: string;
  data?: {
    markdown?: string;
    metadata?: {
      sourceURL?: string;
      url?: string;
      title?: string;
    };
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseFirecrawlResponse(value: unknown): FirecrawlScrapeResponse {
  if (!isRecord(value)) return {};
  const data = isRecord(value.data) ? value.data : undefined;
  const metadata = data && isRecord(data.metadata) ? data.metadata : undefined;
  return {
    success: typeof value.success === 'boolean' ? value.success : undefined,
    error: typeof value.error === 'string' ? value.error : undefined,
    data: data
      ? {
          markdown:
            typeof data.markdown === 'string' ? data.markdown : undefined,
          metadata: metadata
            ? {
                sourceURL:
                  typeof metadata.sourceURL === 'string'
                    ? metadata.sourceURL
                    : undefined,
                url:
                  typeof metadata.url === 'string' ? metadata.url : undefined,
                title:
                  typeof metadata.title === 'string'
                    ? metadata.title
                    : undefined,
              }
            : undefined,
        }
      : undefined,
  };
}

function firecrawlErrorKind(status: number): WebFetchError['kind'] {
  if (status === 404) return 'not_found';
  if (status === 401 || status === 403) return 'forbidden';
  if (status === 408) return 'timeout';
  if (status === 402 || status === 429) return 'rate_limited';
  return 'unknown';
}

export class FirecrawlWebFetchProvider implements WebFetchProvider {
  readonly name = 'firecrawl';

  constructor(
    private readonly apiKey?: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async fetch(
    url: string,
    options: WebFetchOptions,
  ): Promise<WebFetchResponse> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new WebFetchError('invalid_url', `非法 URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new WebFetchError(
        'invalid_url',
        `仅支持 http/https URL,收到: ${parsed.protocol}`,
      );
    }

    const maxLength = Math.max(
      500,
      Math.min(100_000, options.maxLength ?? DEFAULT_MAX_LENGTH),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    let res: Response;
    try {
      res = await fetch(FIRECRAWL_BASE, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url,
          formats: ['markdown'],
          onlyMainContent: true,
          removeBase64Images: true,
          blockAds: true,
          timeout: this.timeoutMs,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new WebFetchError(
          'timeout',
          `Firecrawl 超时 (${this.timeoutMs}ms)`,
          err,
        );
      }
      throw new WebFetchError(
        'network',
        `Firecrawl 网络错误: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    clearTimeout(timer);

    const json = parseFirecrawlResponse(
      await res.json().catch(() => undefined),
    );

    if (!res.ok || json.success === false) {
      const kind = firecrawlErrorKind(res.status);
      const message = json.error || `Firecrawl HTTP ${res.status}`;
      throw new WebFetchError(
        kind,
        kind === 'rate_limited'
          ? `Firecrawl 限速或额度不足: ${message}`
          : `Firecrawl 抓取失败: ${message}`,
      );
    }

    const fullText = json.data?.markdown;
    if (!fullText) {
      throw new WebFetchError('not_found', `Firecrawl 返回空内容:${url}`);
    }

    const truncated = fullText.length > maxLength;
    const markdown = truncated ? fullText.slice(0, maxLength) : fullText;

    return {
      url: json.data?.metadata?.sourceURL ?? json.data?.metadata?.url ?? url,
      markdown,
      truncated,
      provider: this.name,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Jina AI Reader 实现 — GET https://r.jina.ai/{URL}
// ──────────────────────────────────────────────────────────────────────────

const JINA_BASE = 'https://r.jina.ai/';
/** Jina Reader 偶尔慢(等 JS 渲染),给宽松超时;模型可在 tool 调用层面进一步控制 */
const DEFAULT_TIMEOUT_MS = 30_000;
/** 默认返回截断长度——避免一篇长文档把 chat ctx 塞爆 */
const DEFAULT_MAX_LENGTH = 30_000;

export class JinaReaderProvider implements WebFetchProvider {
  readonly name = 'jina-reader';
  readonly cacheKey = 'jina';

  constructor(
    /** 可选 API key(不传也能用,只是限速更紧)。从 .env JINA_API_KEY 注入。 */
    private readonly apiKey?: string,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  async fetch(
    url: string,
    options: WebFetchOptions,
  ): Promise<WebFetchResponse> {
    // 简易 URL 校验:Jina 接受任意 http(s) URL,我们这里做下基础 sanity
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new WebFetchError('invalid_url', `非法 URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new WebFetchError(
        'invalid_url',
        `仅支持 http/https URL,收到: ${parsed.protocol}`,
      );
    }

    const maxLength = Math.max(
      500,
      Math.min(100_000, options.maxLength ?? DEFAULT_MAX_LENGTH),
    );

    // Jina Reader 的 URL 形式:r.jina.ai/{完整 URL}
    // 不要 encodeURIComponent 整个 URL — Jina 自己解析,encode 反而坏事(它接受原始 url)
    const endpoint = `${JINA_BASE}${url}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      // 让 Jina 直接返 markdown(默认行为,显式声明清晰)
      Accept: 'text/plain',
      // 提示 Jina 在文档头加上 title/url 行(便于模型快速看到元信息)
      'X-With-Generated-Alt': 'true',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    let res: Response;
    try {
      res = await fetch(endpoint, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new WebFetchError(
          'timeout',
          `Jina Reader 超时 (${this.timeoutMs}ms)`,
          err,
        );
      }
      throw new WebFetchError(
        'network',
        `Jina Reader 网络错误: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    clearTimeout(timer);

    if (res.status === 404) {
      throw new WebFetchError('not_found', `Jina Reader 找不到:${url}`);
    }
    if (res.status === 403) {
      throw new WebFetchError('forbidden', `目标站拒绝抓取:${url}`);
    }
    if (res.status === 429) {
      throw new WebFetchError(
        'rate_limited',
        'Jina Reader 限速;考虑配置 JINA_API_KEY 提速',
      );
    }
    if (!res.ok) {
      throw new WebFetchError(
        'unknown',
        `Jina Reader HTTP ${res.status}: ${await res.text().catch(() => '')}`,
      );
    }

    const fullText = await res.text();
    if (!fullText) {
      throw new WebFetchError('not_found', `Jina Reader 返回空内容:${url}`);
    }

    const truncated = fullText.length > maxLength;
    const markdown = truncated ? fullText.slice(0, maxLength) : fullText;

    return {
      url,
      markdown,
      truncated,
      provider: this.name,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// DirectFetch 实现 — 服务器直连抓取 + Readability 抽正文(国内服务器友好)
// ──────────────────────────────────────────────────────────────────────────
//
// 为什么需要:Jina/Firecrawl 等中间商的 endpoint 在国内访问不稳(GFW/Cloudflare
// 国内 ISP 路由问题)。国内站点(豆瓣/知乎/简书/微信文章 等)从国内服务器
// **直接 fetch 完全可达**,无需中间商。生产部署到阿里云国内服务器时,中间商
// 翻墙也违反 ToS。本 provider 是默认选择:零依赖国外服务,国内站点 100% 工作,
// 国际被墙站点 fetch 会失败但模型会 fallback 调 web_search。
//
// 实现:
//   - 原生 fetch + AbortController 超时 + size limit
//   - SSRF 防护:拒绝私网/loopback/link-local IP(模型给 url 不可信)
//   - Mozilla Readability(浏览器 Reader 模式同一算法)抽正文 → 去广告/侧栏/导航
//   - Turndown 把抽出的 HTML 转 Markdown 给模型读

// 重依赖(jsdom ~10MB)走 dynamic import:jest 加载 web-fetch.tool 的 spec
// 不会顺带把 jsdom 也吃进去(它内部有 ts 编译过不了的私有 syntax),且未使用
// web_fetch 的部署也不必常驻这些模块。
type DynLibs = {
  JSDOM: typeof import('jsdom').JSDOM;
  Readability: typeof import('@mozilla/readability').Readability;
  TurndownService: typeof import('turndown');
};
let dynLibs: DynLibs | undefined;
async function loadDynLibs(): Promise<DynLibs> {
  if (dynLibs) return dynLibs;
  const [{ JSDOM }, { Readability }, TurndownMod] = await Promise.all([
    import('jsdom'),
    import('@mozilla/readability'),
    import('turndown'),
  ]);
  // turndown 是 CJS default export
  const TurndownService = TurndownMod.default ?? TurndownMod;
  dynLibs = { JSDOM, Readability, TurndownService };
  return dynLibs;
}

/** 直抓默认 5MB 上限,防止误抓巨页吃光内存 */
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * SSRF 防护:拒绝指向私网/loopback 的 hostname。
 *
 * 检测以字符串形式出现的 IP 字面量(127.0.0.1 / 10.x / 192.168.x / 172.16-31.x
 * / 169.254.x / [::1] / [fc00::*]/ [fe80::*]),以及常见的 localhost 别名。
 * 不做 DNS 解析(那需要额外网络往返且仍有 TOCTOU 风险);若模型把 url 写成
 * 公网域名但 DNS 解析到私网,本层挡不住——但这种情况罕见且攻击面不大,
 * 部署侧网络防火墙是更合适的兜底。
 */
function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip [] for ipv6
  if (h === 'localhost' || h === '0.0.0.0') return true;
  if (
    h === '::1' ||
    h.startsWith('fe80:') ||
    h.startsWith('fc00:') ||
    h.startsWith('fd')
  )
    return true;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export class DirectFetchProvider implements WebFetchProvider {
  readonly name = 'direct';

  constructor(
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
    private readonly maxBytes: number = DEFAULT_MAX_BYTES,
  ) {}

  async fetch(
    url: string,
    options: WebFetchOptions,
  ): Promise<WebFetchResponse> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new WebFetchError('invalid_url', `非法 URL: ${url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new WebFetchError(
        'invalid_url',
        `仅支持 http/https URL,收到: ${parsed.protocol}`,
      );
    }
    if (isPrivateHost(parsed.hostname)) {
      throw new WebFetchError(
        'forbidden',
        `禁止抓取私网/loopback 地址:${parsed.hostname}`,
      );
    }

    const maxLength = Math.max(
      500,
      Math.min(100_000, options.maxLength ?? DEFAULT_MAX_LENGTH),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          // 装成普通浏览器:部分站点拒绝无 UA 的请求
          'User-Agent':
            'Mozilla/5.0 (compatible; AuroraBot/1.0; +https://github.com/anthropics)',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new WebFetchError(
          'timeout',
          `直抓超时 (${this.timeoutMs}ms): ${url}`,
          err,
        );
      }
      throw new WebFetchError(
        'network',
        `直抓网络错误: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    clearTimeout(timer);

    if (res.status === 404) {
      throw new WebFetchError('not_found', `404: ${url}`);
    }
    if (res.status === 403) {
      throw new WebFetchError('forbidden', `目标站拒绝(403): ${url}`);
    }
    if (res.status === 429) {
      throw new WebFetchError('rate_limited', `目标站限速(429): ${url}`);
    }
    if (!res.ok) {
      throw new WebFetchError('unknown', `HTTP ${res.status}: ${url}`);
    }

    // Content-Type 校验:非 HTML 直接报错(本 provider 只读 HTML 页面)
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType && !/text\/html|application\/xhtml/i.test(contentType)) {
      throw new WebFetchError(
        'unknown',
        `不支持的 Content-Type: ${contentType.split(';')[0]} (本工具只读 HTML 页面)`,
      );
    }

    // 流式读取 + size limit:防止恶意巨页吃内存
    const reader = res.body?.getReader();
    if (!reader) {
      throw new WebFetchError('unknown', '响应体为空');
    }
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > this.maxBytes) {
          await reader.cancel();
          throw new WebFetchError(
            'too_large',
            `页面超过 ${(this.maxBytes / 1024 / 1024).toFixed(0)}MB 上限`,
          );
        }
        chunks.push(value);
      }
    } catch (err) {
      if (err instanceof WebFetchError) throw err;
      throw new WebFetchError(
        'network',
        `读取响应体失败: ${err instanceof Error ? err.message : String(err)}`,
        err,
      );
    }
    const html = Buffer.concat(chunks).toString('utf-8');

    // Readability 在 JSDOM 里解析 + 抽正文。
    const { JSDOM, Readability, TurndownService } = await loadDynLibs();
    const dom = new JSDOM(html, { url, contentType: 'text/html' });
    const reader2 = new Readability(dom.window.document);
    const article = reader2.parse();

    // 抽不出正文(导航页/工具页/纯交互页)→ fallback 用整页 body 转 markdown
    const contentHtml = article?.content ?? dom.window.document.body.innerHTML;
    const title = article?.title ?? dom.window.document.title ?? '';

    // turndown:每个 provider 实例共享一份配置无副作用,但 lazy load 决定了
    // 这里只能临时 new(不能放 class field 因为类型在 lazy 之前没有)
    const turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
      bulletListMarker: '-',
    });
    const md = turndown.turndown(contentHtml).trim();
    const headerLine = title ? `# ${title}\n\n${url}\n\n` : `${url}\n\n`;
    const fullText = headerLine + md;

    const truncated = fullText.length > maxLength;
    const markdown = truncated ? fullText.slice(0, maxLength) : fullText;

    return {
      url,
      markdown,
      truncated,
      provider: this.name,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────
// 工厂:按 .env 配置返回实例
// ──────────────────────────────────────────────────────────────────────────

/**
 * 按 .env 选择 provider 并构造实例。
 *
 * 默认 auto:direct → Firecrawl → jina。Firecrawl 支持 keyless,配 key 只用于提额;
 * Jina 是最后一层轻量 reader fallback。
 * 切 direct:WEB_FETCH_PROVIDER=direct。
 * 切 firecrawl:WEB_FETCH_PROVIDER=firecrawl + FIRECRAWL_API_KEY=可选。
 * 切 jina:WEB_FETCH_PROVIDER=jina + JINA_API_KEY=可选。
 *
 * **总会**返回 provider,装配层无脑挂工具。
 */
export function createWebFetchProviderFromEnv(): WebFetchProvider {
  const provider = process.env.WEB_FETCH_PROVIDER?.toLowerCase() ?? 'auto';
  const jinaKey = process.env.JINA_API_KEY?.trim();
  const firecrawlKey = process.env.FIRECRAWL_API_KEY?.trim();

  const autoProviders = (): WebFetchProvider[] => [
    new DirectFetchProvider(),
    new FirecrawlWebFetchProvider(firecrawlKey || undefined),
    new JinaReaderProvider(jinaKey || undefined),
  ];

  if (provider === 'auto') {
    return new AutoWebFetchProvider(autoProviders());
  }
  if (provider === 'direct') {
    return new DirectFetchProvider();
  }
  if (provider === 'firecrawl') {
    return new FirecrawlWebFetchProvider(firecrawlKey || undefined);
  }
  if (provider === 'jina') {
    return new JinaReaderProvider(jinaKey || undefined);
  }

  // 未知 provider → 回 auto(直抓优先,失败再走 Firecrawl/Jina fallback)

  console.warn(
    `[web-fetch] 未知 WEB_FETCH_PROVIDER=${provider},fallback 到 auto`,
  );
  return new AutoWebFetchProvider(autoProviders());
}
