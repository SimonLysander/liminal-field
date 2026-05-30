/**
 * ToolAssembler — 组装当前对话可用的工具集。
 *
 * 职责：
 * 根据当前入口上下文（有无文档、有无选区）组装工具集，
 * 并处理 AI SDK v6 的 parameters/inputSchema 桥接问题。
 *
 * 工具清单：
 * - search_knowledge_base：全文搜索知识库（grep：按内容找）
 * - list_knowledge_base：列出知识库内容目录（ls/tree：看有哪些）
 * - read_document_content：读取单篇文档完整正文
 * - get_current_draft：获取当前编辑文档
 * - propose_document_rewrite：提议改稿（有 document 时挂）
 * - web_search：联网搜索（配了 TAVILY_API_KEY 等才挂；未配优雅降级）
 * - web_fetch：读 URL 全文（Jina Reader，免 key 总挂）
 * 2026-05-30 起 remember / forget 已从主 agent 工具集移除(event log 架构):
 * 记忆塑形改由 MemoryObserverService 在 onAfterChat 钩子后台自动跑,
 * 主 agent 完全不感知;只保留读类 recall_memory / search_memories 让模型在
 * 当前画像看不到细节时按需查岁月史书全量 observations。
 *
 * 注意：AI SDK v6 的 tool() 返回对象带 `parameters` 字段，
 * 但 streamText 内部读的是 `inputSchema`，需手动桥接。
 */
import { Injectable } from '@nestjs/common';
import { ContentService } from '../../content/content.service';
import { NoteViewService } from '../../workspace/note-view.service';
import { AnthologyViewService } from '../../workspace/anthology-view.service';
import { MemoryAgentService } from '../memory/memory-agent.service';
import { AgentMemoryObservationRepository } from '../memory/agent-memory-observation.repository';
import { SubAgentService } from '../sub-agent/sub-agent.service';
import { createSearchKnowledgeBaseTool } from '../tools/search-content.tool';
import { createListKnowledgeBaseTool } from '../tools/list-content.tool';
import { createReadDocumentContentTool } from '../tools/read-content.tool';
import { createGetCurrentDraftTool } from '../tools/get-current-document.tool';
import { createReadCollectionEntryTool } from '../tools/read-collection-entry.tool';
// remember / forget 工具文件保留备查(2026-05-30 event log 架构后从主 agent 拔出)
import { createRecallMemoryTool } from '../tools/recall-memory.tool';
import { createSearchMemoriesTool } from '../tools/search-memories.tool';
import { createSubAgentTool } from '../tools/sub-agent.tool';
import { createWriteTasksTool } from '../tools/write-tasks.tool';
import { createReadConversationHistoryTool } from '../tools/read-conversation-history.tool';
import { createProposeDocumentRewriteTool } from '../tools/propose-document-rewrite.tool';
import { createGetGalleryDraftTool } from '../tools/get-gallery-draft.tool';
import { createViewPhotosTool } from '../tools/view-photos.tool';
import { createProposeCaptionTool } from '../tools/propose-caption.tool';
import type { GalleryContext } from '../tools/gallery-context';
import { createWebSearchTool } from '../tools/web-search.tool';
import { createWebSearchProviderFromEnv } from '../tools/web-search-provider';
import { createWebFetchTool } from '../tools/web-fetch.tool';
import { createWebFetchProviderFromEnv } from '../tools/web-fetch-provider';
import { AgentSessionRepository } from '../session/agent-session.repository';
import { AgentMemoryRepository } from '../memory/agent-memory.repository';
import type { DocumentContext } from '../tools/get-current-document.tool';

export interface EntryContext {
  document?: DocumentContext;
  /** 画廊场景:照片清单+随笔。存在即走图说写手链路(get_current_draft 换画廊版 + view_photos/propose_caption)。 */
  gallery?: GalleryContext;
  selectedText?: string;
  sessionKey?: string;
  agentInstanceKey?: string;
}

@Injectable()
export class ToolAssembler {
  constructor(
    private readonly contentService: ContentService,
    private readonly noteViewService: NoteViewService,
    private readonly anthologyViewService: AnthologyViewService,
    // memoryAgent 仍由 compaction 服务用(compact 走它),工具集已不依赖
    private readonly memoryAgent: MemoryAgentService,
    private readonly subAgentService: SubAgentService,
    private readonly sessionRepo: AgentSessionRepository,
    // tasks 落在 session 记忆(by agentKey),write_tasks 工具写这里,与 onBeforeChat 读回同源
    private readonly memoryRepo: AgentMemoryRepository,
    // 2026-05-30 event log:recall/search 工具改读 observations
    private readonly observationRepo: AgentMemoryObservationRepository,
  ) {}

  /**
   * 根据入口上下文组装工具集。
   * 返回的 Map 可直接传给 streamText({ tools })。
   *
   * @param entryContext  入口上下文（文档 / 选区）
   * @param allowedTools  工具白名单（来自 AgentEntryConfig.tools）；
   *                      为空或 undefined 时表示不限制，使用全部工具
   */
  assemble(
    entryContext: EntryContext,
    allowedTools?: string[],
    tier?: string,
  ): Record<string, any> {
    const memoryKey = entryContext.agentInstanceKey ?? entryContext.sessionKey;
    // 工具接 getter(与 createGetCurrentDraftTool/createProposeDocumentRewriteTool 签名对齐)。
    // 当前 entryContext 在单次 chat 请求内 immutable,所以 getter 跟传 snapshot 等价;
    // 保留 lazy 形态为未来"chat 期间文档热更替"留接口——届时只需让 entryContext.document
    // 变成可变引用(或在 lifecycle 中主动 reassign),工具层无需变更。
    const getDocument = () => entryContext.document;
    const getGallery = () => entryContext.gallery;

    // 联网搜索:provider 从 .env 选(默认 Tavily),没配 API key 时 createWebSearchProviderFromEnv
    // 返 undefined,本次装配不挂 web_search 工具(模型看不到自然不会调,优雅降级)。
    // 这里每次 assemble 调一次 — provider 不持久 state,工厂便宜,不必缓存。
    const webSearchProvider = createWebSearchProviderFromEnv();
    // 联网读 URL:Jina Reader 免 key 起步,总会返 provider;装配层无脑挂工具。
    const webFetchProvider = createWebFetchProviderFromEnv();

    const rawTools = {
      // 知识库搜索（grep：按内容找）：全局可用
      search_knowledge_base: createSearchKnowledgeBaseTool(this.contentService),
      // 知识库目录（ls/tree：列出有哪些内容）：与 search 互补
      list_knowledge_base: createListKnowledgeBaseTool(this.contentService),
      // 读取文档正文：只读已发布内容，当前草稿用 get_current_draft
      read_document_content: createReadDocumentContentTool(
        this.noteViewService,
      ),
      // 当前草稿读取:画廊场景换画廊版(读清单+随笔)并附 view_photos/propose_caption;
      // 否则文稿版(标题+大纲+字数+段落+正文)。同名 get_current_draft 二选一,避免重复 key。
      ...(entryContext.gallery
        ? {
            get_current_draft: createGetGalleryDraftTool(getGallery),
            view_photos: createViewPhotosTool(getGallery),
            propose_caption: createProposeCaptionTool(getGallery),
          }
        : {
            get_current_draft: createGetCurrentDraftTool(getDocument),
          }),
      // 召回工具(#150 + 2026-05-30 event log):配合 prompt 顶部 <memories_index> 当前画像,
      // 想查岁月史书全量 observations 调这两条;
      // remember/forget 已拔除,塑形由 MemoryObserverService 后台跑(主 agent 无感)。
      recall_memory: createRecallMemoryTool(this.observationRepo),
      search_memories: createSearchMemoriesTool(this.observationRepo),
      // 子 agent：主 agent 委派明确任务，独立 context + 只读工具
      sub_agent: createSubAgentTool(
        this.subAgentService,
        entryContext.document,
        tier,
        entryContext.sessionKey,
      ),
      // 任务管理：write_tasks 整体改写写作计划(TodoWrite 式,模型有最大自由度)
      ...(memoryKey
        ? {
            write_tasks: createWriteTasksTool(
              this.memoryRepo,
              // tasks 落在草稿级 agent 实例上；业务会话切换不清空任务。
              memoryKey,
            ),
          }
        : {}),
      // 对话原文回溯：session 记忆有损精炼，精确查"用户原话"时用此工具
      ...(entryContext.sessionKey
        ? {
            read_conversation_history: createReadConversationHistoryTool(
              this.sessionRepo,
              entryContext.sessionKey,
            ),
          }
        : {}),
      // v3:单工具,模型自由编辑;前端做 diff 与 hunk 审批
      ...(entryContext.document
        ? {
            propose_document_rewrite:
              createProposeDocumentRewriteTool(getDocument),
          }
        : {}),
      // 文集条目场景(contentItemId 形如 `${anthologyId}:${entryKey}`)才挂:读同集其它条目
      ...(entryContext.document?.contentItemId.includes(':')
        ? {
            read_collection_entry: createReadCollectionEntryTool(
              getDocument,
              this.anthologyViewService,
            ),
          }
        : {}),
      // 联网搜索:有 provider 才挂(没配 key 时 webSearchProvider=undefined 优雅降级)
      ...(webSearchProvider
        ? { web_search: createWebSearchTool(webSearchProvider) }
        : {}),
      // 联网读 URL:Jina 免 key 总能用,直接挂
      web_fetch: createWebFetchTool(webFetchProvider),
    };

    // 按白名单过滤工具：allowedTools 不为空时只保留白名单内的工具
    const filteredTools =
      allowedTools && allowedTools.length > 0
        ? Object.fromEntries(
            Object.entries(rawTools).filter(([name]) =>
              allowedTools.includes(name),
            ),
          )
        : rawTools;

    return filteredTools;
  }
}
