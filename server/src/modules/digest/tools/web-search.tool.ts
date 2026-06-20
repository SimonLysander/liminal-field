/**
 * digest/web-search — 直接复用 Aurora 的 web_search 工具，不改 schema 和 description。
 *
 * 设计决策：
 * - Aurora 的 description 已经是"联网搜索"语义，digest agent 同样适用，无需覆写。
 * - provider 由 createWebSearchProviderFromEnv() 构造；没配 TAVILY_API_KEY 返 undefined，
 *   factory 据此决定不挂 web_search（LLM 看不到 → 不会调），与 Aurora 装配层行为一致。
 * - 这层只是 re-export 封装，方便 digest 模块内引用路径统一，且未来可按需覆写 description。
 */
import { createWebSearchTool as createAuroraWebSearchTool } from '../../agent/tools/web-search.tool';
import type { WebSearchProvider } from '../../agent/tools/web-search-provider';

export { createWebSearchProviderFromEnv } from '../../agent/tools/web-search-provider';
export type { WebSearchProvider };

/** 构建 digest agent 用的 web_search 工具（直接复用 Aurora 实现）。 */
export function createWebSearchTool(provider: WebSearchProvider) {
  return createAuroraWebSearchTool(provider);
}
