/**
 * digest/web-fetch — 直接复用 Aurora 的 web_fetch 工具，不改 schema 和 description。
 *
 * 设计决策：
 * - 替代了旧版 view 工具（view 是从 fetchedItemsMap 取 item 再调 fetcher.readFull，
 *   现在 agent 直接用 web_fetch 拿任意 URL 全文，更通用且省一层 ref 管理）。
 * - Aurora 的 web_fetch 已走 provider 抽象（Jina / DirectFetch），含 SSRF 防护、
 *   流式限量、Readability 正文提取，digest agent 无需重新实现。
 * - createWebFetchProviderFromEnv() **总会**返回 provider（默认 direct），所以
 *   web_fetch 始终可用，不同于 web_search 的可选挂载。
 */
import { createWebFetchTool as createAuroraWebFetchTool } from '../../agent/tools/web-fetch.tool';
import type { WebFetchProvider } from '../../agent/tools/web-fetch-provider';

export { createWebFetchProviderFromEnv } from '../../agent/tools/web-fetch-provider';
export type { WebFetchProvider };

/** 构建 digest agent 用的 web_fetch 工具（直接复用 Aurora 实现）。 */
export function createWebFetchTool(provider: WebFetchProvider) {
  return createAuroraWebFetchTool(provider);
}
