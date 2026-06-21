/**
 * Fetcher 共性 HTTP 工具 —— 给所有 Fetcher 用,带重试 + 退避 + 超时。
 *
 * 为什么需要:
 * - 之前 10 个 fetcher 各自裸 fetch,单次失败就 throw,没重试机制
 * - 工业级 fetcher 应该容忍 1-2 次瞬时失败(DNS/TLS 握手/连接重置)
 * - 配合 FetcherRegistry.fetchMany 的 Promise.allSettled,
 *   单源即使重试后仍失败也不阻塞其他源 — browse 工具返 status='partial' 给 agent
 *
 * 重试策略:
 * - 最多 retries 次重试(默认 1 次,共 2 次尝试)
 * - 指数退避:第 N 次重试前等 backoffMs * 2^(N-1)(默认 backoffMs=500 → 500ms, 1500ms)
 * - 只对网络层/timeout 失败重试;HTTP 4xx(语义错误) 直接 throw 不重试
 */
import { Logger } from '@nestjs/common';

const logger = new Logger('FetcherHttp');

export interface HttpFetchOptions {
  /** AbortSignal timeout 毫秒;默认 15000 */
  timeoutMs?: number;
  /** 重试次数(不含首次);默认 1(即最多 2 次尝试) */
  retries?: number;
  /** 首次退避毫秒;默认 500。退避 = backoffMs * 2^(retryIdx) */
  backoffMs?: number;
  /** 自定义 headers 合并(UA / Content-Type 等) */
  headers?: Record<string, string>;
  /** HTTP method;默认 GET */
  method?: 'GET' | 'POST';
  /** POST body(method=POST 时使用) */
  body?: string;
  /** 日志前缀(fetcher 名 / 源名),用于多源并发时区分日志 */
  label?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_BACKOFF_MS = 500;
const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36';

/**
 * 带重试 + 超时的 HTTP 抓取。
 *
 * @returns Response(若 HTTP 状态非 2xx 也返回 — fetcher 自己决定是否 throw,
 *          因为有些 API 把 200 但 body 含 err_no=xxx 的也算成功响应)
 * @throws Error 网络层失败/timeout 重试耗尽后
 */
export async function httpFetch(
  url: string,
  options: HttpFetchOptions = {},
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const labelPrefix = options.label ? `[${options.label}] ` : '';

  const headers: Record<string, string> = {
    'User-Agent': DEFAULT_UA,
    ...options.headers,
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: options.method ?? 'GET',
        body: options.body,
        signal: AbortSignal.timeout(timeoutMs),
        headers,
      });
      if (attempt > 0) {
        logger.log(
          `${labelPrefix}重试第 ${attempt} 次成功 url=${url} t=${Date.now() - t0}ms`,
        );
      }
      return res;
    } catch (err) {
      lastErr = err;
      const reason = err instanceof Error ? err.message : String(err);
      // 还有重试机会:退避等待后下一轮
      if (attempt < retries) {
        const wait = backoffMs * Math.pow(2, attempt);
        logger.warn(
          `${labelPrefix}第 ${attempt + 1} 次失败,${wait}ms 后重试 url=${url} reason=${reason}`,
        );
        await sleep(wait);
        continue;
      }
      // 用尽重试次数 → 抛出
      logger.error(
        `${labelPrefix}重试耗尽(共 ${retries + 1} 次) url=${url} reason=${reason}`,
      );
      throw err;
    }
  }
  // 理论上不可达(循环里要么 return 要么 throw),兜底
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

/** 简化:GET + 期望 JSON 响应,2xx 才解析,4xx/5xx throw */
export async function httpGetJson<T = unknown>(
  url: string,
  options: HttpFetchOptions = {},
): Promise<T> {
  const res = await httpFetch(url, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} url=${url}`);
  }
  return (await res.json()) as T;
}

/** 简化:GET + 期望 HTML/文本响应 */
export async function httpGetText(
  url: string,
  options: HttpFetchOptions = {},
): Promise<string> {
  const res = await httpFetch(url, options);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} url=${url}`);
  }
  return res.text();
}

/** 简化:POST + JSON body + 期望 JSON 响应 */
export async function httpPostJson<T = unknown>(
  url: string,
  body: object,
  options: Omit<HttpFetchOptions, 'method' | 'body'> = {},
): Promise<T> {
  const res = await httpFetch(url, {
    ...options,
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} url=${url}`);
  }
  return (await res.json()) as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
