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
 * - propose_document_rewrite：提议改稿（2026-06-04 用户要求整体停用，已注释不装配）
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
import { Injectable, Logger } from '@nestjs/common';
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
// 2026-05-30 event log:remember 重做成"主 agent 批量觉察",forget 文件保留备查
import { createRememberTool } from '../tools/remember.tool';
import { createRecallMemoryTool } from '../tools/recall-memory.tool';
import { createSearchMemoriesTool } from '../tools/search-memories.tool';
import { createSubAgentTool } from '../tools/sub-agent.tool';
import { createWriteTasksTool } from '../tools/write-tasks.tool';
import { createReadConversationHistoryTool } from '../tools/read-conversation-history.tool';
// 2026-06-04 改稿能力停用:工厂不再使用,导入一并注释(恢复时取消注释)
// import { createProposeDocumentRewriteTool } from '../tools/propose-document-rewrite.tool';
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
// Skill 工具:agent.enabledSkillIds 非空时自动挂载,通过 SkillService 按 name 调起。
import { SkillService } from '../../skill/skill.service';
import { TOOL_DESCRIPTIONS } from '../../../prompts/tool-descriptions';
import { createSkillTool } from '../tools/skill.tool';
import type { DocumentContext } from '../tools/get-current-document.tool';
// P3 重构后 browse/pick 也归 agent/tools/(全项目共有工具池),
// 跨场景:digest workflow 跑 react-agent 时用 / report-analyst sub-agent 读者追问也能用
import { createBrowseTool } from '../tools/browse.tool';
import { createPickTool } from '../tools/pick.tool';
import type { DigestTaskContext } from '../tools/digest-task-context';
import { InfoSourceRepository } from '../../digest/info-source.repository';
import { SmartTopicConfigRepository } from '../../digest/smart-topic-config.repository';
import { FetcherRegistry } from '../../digest/fetchers/fetcher-registry.service';
import { ProcessedFeedItemRepository } from '../../digest/processed-feed-item.repository';
import { DigestTaskRepository } from '../../digest/digest-task.repository';
// 学习产品：write_learn_plan / write_draft / read_content 工具
import { createWriteLearnPlanTool } from '../tools/write-learn-plan.tool';
import {
  createWriteDraftTool,
  validateCitations,
  type DraftSource,
} from '../tools/write-draft.tool';
import { extractSections } from '../tools/markdown.utils';
import { createReadContentTool } from '../tools/read-node-content.tool';
import { EditorDraftRepository } from '../../workspace/editor-draft.repository';
// HITL 门禁：写工具 execute 暂存 pending_writes，带外审批后 commit 落库
import { gateWrite, type GateWriteOptions } from '../approval/gate-write';
import { PendingWriteRepository } from '../approval/pending-write.repository';
import { validateObservations } from '../tools/remember.tool';
import type { ObservationTopic } from '../memory/agent-memory-observation.entity';

/**
 * 门禁写工具的 changeSummary 写前校验:DeepSeek 等 provider 不遵守 schema 的 required,
 * 会直接略过可选/必填字段。这里硬校验——缺了就 invalid 让模型带着它重调,不依赖 prompt。
 */
function requireChangeSummary(args: Record<string, unknown>): string | null {
  const cs =
    typeof args['changeSummary'] === 'string'
      ? args['changeSummary'].trim()
      : '';
  return cs
    ? null
    : '缺少 changeSummary:必须用一句话说明这次写入做了什么 / 相比现有改了什么(直接陈述,不要「本次/说明」之类前缀)。请带上 changeSummary 重新调用本工具。';
}

/**
 * write_draft 门禁前置校验:先卡 changeSummary,再卡引用一致性(悬空 [@#CIT N]/来源缺 url)。
 * 任一不过就 invalid,让模型带着具体错因重调——出处不靠 prompt 自觉,靠门禁兜底。
 */
function validateDraftWrite(args: Record<string, unknown>): string | null {
  const csErr = requireChangeSummary(args);
  if (csErr) return csErr;
  const md = typeof args['markdown'] === 'string' ? args['markdown'] : '';
  const sources = Array.isArray(args['sources'])
    ? (args['sources'] as DraftSource[])
    : [];
  return validateCitations(md, sources);
}

export interface EntryContext {
  document?: DocumentContext;
  /** 画廊场景:照片清单+随笔。存在即走图说写手链路(get_current_draft 换画廊版 + view_photos/propose_caption)。 */
  gallery?: GalleryContext;
  selectedText?: string;
  sessionKey?: string;
  agentInstanceKey?: string;
  /**
   * digest 场景上下文(workflow 跑 react-agent / report-analyst sub-agent 都用)。
   * - workflow: taskId/topicId/refCounter/fetchedItemsMap 都有 → browse + pick 都挂
   * - reader:   只有 topicId(+ refCounter/fetchedItemsMap),taskId 空 → 只挂 browse(只浏览不收藏)
   */
  digestTaskContext?: DigestTaskContext;
  /**
   * 学习产品场景：主题 contentItemId。
   * 存在时挂 write_learn_plan 工具（learning-planner agent 规划落 aidraft:{topicId}）。
   * 绝不替用户建节点——规划是 AI 提案，建篇由用户手动操作。
   */
  learningTopicId?: string;
  /**
   * 学习产品场景：当前在学的那一篇笔记节点 contentItemId。
   * 存在时挂 write_draft（只写此节点 aidraft，防越权）和 read_content（三层读取）。
   * learningTopicId || learningNoteId 任一存在都会挂 read_content（planner/writer 均可读）。
   */
  learningNoteId?: string;
}

@Injectable()
export class ToolAssembler {
  // 关键链路打点(CLAUDE.md「日志准则」):入参摘要 + 关键分支 + 结果摘要
  // LOG_LEVEL 控制开关,生产默认收(NestJS 默认 log/error/warn 开,debug 关)。
  private readonly logger = new Logger(ToolAssembler.name);

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
    // Skill 池(agent skills):agent 启用 skill 时按 name 调起、注入 body 作 tool_result
    private readonly skillService: SkillService,
    // browse/pick 用的 digest repos —— 通过 DigestSharedModule 注入,无循环依赖
    // browse v5 还需 smartTopicConfigRepo(默认 sourceIds 时反查当前事项订阅源列表)
    private readonly infoSourceRepo: InfoSourceRepository,
    private readonly smartTopicConfigRepo: SmartTopicConfigRepository,
    private readonly fetcherRegistry: FetcherRegistry,
    private readonly pfiRepo: ProcessedFeedItemRepository,
    private readonly digestTaskRepo: DigestTaskRepository,
    // 学习产品：write_learn_plan 把规划落 aidraft:{topicId}，通过 WorkspaceModule 注入
    private readonly editorDraftRepo: EditorDraftRepository,
    // HITL 门禁：4 个写工具的 execute 改为暂存 pending_writes，带外审批后 commit 落库
    private readonly pendingWriteRepo: PendingWriteRepository,
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
    // Agent 启用的 Skill _id 列表(AgentEntryConfig.enabledSkillIds);非空时挂 Skill 工具。
    // 跟 web_search lifecycle 同款:配置驱动,无配置无工具,模型看不到自然不会调。
    enabledSkillIds?: string[],
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

    // HITL 门禁：有 sessionKey 才把写工具包成门禁层（暂存 pending_writes → 用户确认 → commit）；
    // 无 sessionKey 时退回直接用真 tool，避免「无法审批却又不写」的死局。
    // realTool 一律先构造一次两分支共用，sessionKey / pendingWriteRepo 在此统一注入。
    const gateIfSession = (
      realTool: unknown,
      opts: Omit<GateWriteOptions, 'sessionKey' | 'pendingWriteRepo'>,
    ) =>
      entryContext.sessionKey
        ? gateWrite(realTool, {
            ...opts,
            sessionKey: entryContext.sessionKey,
            pendingWriteRepo: this.pendingWriteRepo,
          })
        : realTool;

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
      // 2026-05-30 event log:主 agent 主动 remember 批量觉察(替代旧 upsert 版),
      // recall_memory / search_memories 仍是只读;forget 不存在(岁月史书)。
      remember: gateIfSession(
        createRememberTool(this.observationRepo, entryContext.sessionKey),
        {
          toolName: 'remember',
          // remember 有严格写前校验（字数/topic），门禁层同步校验，不合格不暂存
          validate: (args) => {
            const observations =
              (
                args as {
                  observations?: Array<{
                    topic: ObservationTopic;
                    observation: string;
                    context?: string;
                  }>;
                }
              ).observations ?? [];
            return validateObservations(observations);
          },
          buildPreview: (args) => {
            const obs =
              (args['observations'] as Array<{
                observation?: string;
                topic?: string;
              }>) ?? [];
            return {
              items: obs.slice(0, 10).map((o) => ({
                label: o?.observation ?? '',
                snippet: o?.topic || undefined,
              })),
              stats: `记忆 · ${obs.length} 条 · 新增`,
            };
          },
        },
      ),
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
      // HITL 门禁：有 sessionKey 时包门禁层；memoryKey 必须存在 write_tasks 才挂。
      ...(memoryKey
        ? {
            write_tasks: gateIfSession(
              createWriteTasksTool(this.memoryRepo, memoryKey),
              {
                toolName: 'write_tasks',
                agentKey: memoryKey,
                buildPreview: (args) => {
                  const tasks =
                    (args['tasks'] as Array<{
                      title?: string;
                      status?: string;
                    }>) ?? [];
                  return {
                    items: tasks.slice(0, 15).map((t) => ({
                      label: t?.title ?? '',
                      snippet: t?.status || undefined,
                    })),
                    stats: `任务 · ${tasks.length} 项`,
                  };
                },
              },
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
      // 2026-06-04 改稿(propose-edit)能力整体停用(用户要求):工具不再装配,
      // 模型拿不到 propose_document_rewrite,自然不会发起改稿。前端改稿 UI 同步失活
      // (use-advisor-chat PROPOSE_EDIT_ENABLED=false)。要恢复:取消下面注释 +
      // system-config WRITING_ADVISOR_TOOLS 加回 + prompt.handler 改稿指引加回 + 前端开关置 true。
      // ...(entryContext.document
      //   ? {
      //       propose_document_rewrite:
      //         createProposeDocumentRewriteTool(getDocument),
      //     }
      //   : {}),
      // 文集子节点场景(contentItemId 形如 `${anthologyId}:${nodeId}`)才挂:读同集其它子节点
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
      // ── digest 场景 browse/pick: 跨场景共享(workflow + report-analyst sub-agent) ──
      // browse 在 workflow 和 reader 场景都挂(workflow 写 fetchedItemsMap 给 pick 用,
      // reader 不挂 pick 所以 fetchedItemsMap 写了也没人读 — 无副作用)。
      // pick 仅 workflow 场景挂(taskId 非空表示有归属 task,findings 才有去处)。
      ...(entryContext.digestTaskContext
        ? {
            browse: createBrowseTool({
              infoSourceRepo: this.infoSourceRepo,
              smartTopicConfigRepo: this.smartTopicConfigRepo,
              fetcherRegistry: this.fetcherRegistry,
              pfiRepo: this.pfiRepo,
              ctx: entryContext.digestTaskContext,
            }),
            ...(entryContext.digestTaskContext.taskId
              ? {
                  pick: createPickTool({
                    taskRepo: this.digestTaskRepo,
                    ctx: entryContext.digestTaskContext,
                  }),
                }
              : {}),
          }
        : {}),
      // 学习规划工具：learningTopicId 存在时挂（learning-planner agent 用）
      // 规划落 aidraft:{topicId}，前端通过 EditorDraftRepository.buildAiDraftId 读回；
      // 绝不建节点——只产提案，建篇由用户操作。
      // HITL 门禁：有 sessionKey 时包门禁层。
      ...(entryContext.learningTopicId
        ? {
            write_learn_plan: gateIfSession(
              createWriteLearnPlanTool(
                this.editorDraftRepo,
                entryContext.learningTopicId,
              ),
              {
                toolName: 'write_learn_plan',
                targetContentItemId: entryContext.learningTopicId,
                validate: requireChangeSummary, // 没传改动摘要就退回让模型补
                buildPreview: (args) => {
                  const items =
                    (args['items'] as Array<{
                      title?: string;
                      why?: string;
                    }>) ?? [];
                  return {
                    summary: (args['changeSummary'] as string) || undefined,
                    items: items.slice(0, 20).map((it) => ({
                      label: it?.title ?? '',
                      snippet: it?.why || undefined, // 篇名 + 该篇的「为何写」
                    })),
                    ordered: true, // 篇目有序,显序号
                    stats: `规划 · ${items.length} 篇 · 覆盖现有`,
                  };
                },
              },
            ),
          }
        : {}),
      // 学习写作工具：learningNoteId 存在时挂 write_draft（learning-writer agent 专用）。
      // 目标节点在工厂内绑定，模型无法指定其它节点——防止跨节点越权写入。
      // HITL 门禁：有 sessionKey 时包门禁层。
      ...(entryContext.learningNoteId
        ? {
            write_draft: gateIfSession(
              createWriteDraftTool(
                this.editorDraftRepo,
                entryContext.learningNoteId,
              ),
              {
                toolName: 'write_draft',
                targetContentItemId: entryContext.learningNoteId,
                validate: validateDraftWrite, // 缺改动摘要 / 引用悬空都退回让模型补
                buildPreview: (args) => {
                  const md = (args['markdown'] as string) ?? '';
                  const srcCount = Array.isArray(args['sources'])
                    ? args['sources'].length
                    : 0;
                  return {
                    summary: (args['changeSummary'] as string) || undefined,
                    items: extractSections(md, 40), // 小标题 + 各节开头约 40 字
                    stats: `初稿 · ${md.length} 字 · ${srcCount} 源 · 覆盖现有`,
                  };
                },
              },
            ),
          }
        : {}),
      // read_content：learningTopicId 或 learningNoteId 任一存在就挂（planner/writer 都能读）。
      // 只读三层（已提交正文 + 用户草稿 + AI 初稿），不写不改任何内容。
      ...(entryContext.learningTopicId || entryContext.learningNoteId
        ? {
            read_content: createReadContentTool(
              this.noteViewService,
              this.editorDraftRepo,
            ),
          }
        : {}),
    };

    // 按白名单过滤工具:语义区分三种情况——
    //   allowedTools = undefined → 未配置,挂全部工具(默认行为)
    //   allowedTools = []        → 显式空白名单,不挂任何工具(用于"纯对话"sub-agent)
    //   allowedTools = ['a','b'] → 只挂白名单内
    //
    // 之前的逻辑(`length > 0`)把 [] 也当成"未配置",导致 report-analyst 这种
    // 注明"纯对话无工具"的 sub-agent 实际拿到全部工具,会去调 get_current_draft
    // 等编辑器场景才有的工具,体验上很怪(实测 chrome-devtools 在简报阅读页
    // 划词追问时 Aurora 答"先读一下当前草稿..."然后调 get_current_draft)。
    const filteredTools =
      allowedTools != null
        ? Object.fromEntries(
            Object.entries(rawTools).filter(([name]) =>
              allowedTools.includes(name),
            ),
          )
        : rawTools;

    // Skill 工具叠加(不受 allowedTools 白名单影响):
    //   agent 启用 skill 是单独维度的授权(enabledSkillIds 非空 → 必须能调起 Skill),
    //   跟 tools 白名单(用户手动勾选哪些底层工具)互不交叉。
    // 闭包传 enabledSkillIds + agentTools(=allowedTools 或全工具集 keys),
    // tool 内部按这两个做防御性 sanity 校验。
    if (enabledSkillIds && enabledSkillIds.length > 0) {
      const agentTools =
        allowedTools && allowedTools.length > 0
          ? allowedTools
          : Object.keys(rawTools);
      filteredTools['load_skill'] = createSkillTool({
        skillService: this.skillService,
        enabledSkillIds,
        agentTools,
      });
      this.logger.debug(
        `assemble: 挂 Skill 工具(enabledSkillIds=${enabledSkillIds.length} 个,agentTools=${agentTools.length} 个)`,
      );
    } else {
      this.logger.debug(
        'assemble: 无 enabledSkillIds,Skill 工具不挂(模型看不到自然不调)',
      );
    }

    // 提示词集中管理：工具 description 的唯一真源是 tools/tool-descriptions.ts（一张表）。
    // 组装收尾时按工具名统一套用——命中即覆盖工厂占位描述，未命中保留工厂内联（上下文相关工具如
    // get_current_draft 两套描述不入表）。这样 description 改动只动一个文件、走 git，不散在 20+ 工具里。
    for (const [name, t] of Object.entries(filteredTools)) {
      const desc = TOOL_DESCRIPTIONS[name];
      if (desc) (t as { description?: string }).description = desc;
    }

    return filteredTools;
  }
}
