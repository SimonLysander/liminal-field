/**
 * ToolAssembler — 组装当前对话可用的工具集。
 *
 * 职责：
 * 根据当前入口上下文（有无文档、有无选区）组装工具集，
 * 并处理 AI SDK v6 的 parameters/inputSchema 桥接问题。
 *
 * 工具清单：
 * - search_knowledge_base：全文搜索知识库
 * - read_document_content：读取单篇文档完整正文
 * - get_current_draft：获取当前编辑文档
 * - remember：记住信息，走 MemoryAgentService 处理分类/去重/合并
 * - forget：忘记信息，走 MemoryAgentService 匹配删除
 *
 * 注意：AI SDK v6 的 tool() 返回对象带 `parameters` 字段，
 * 但 streamText 内部读的是 `inputSchema`，需手动桥接。
 */
import { Injectable } from '@nestjs/common';
import { ContentService } from '../../content/content.service';
import { NoteViewService } from '../../workspace/note-view.service';
import { MemoryAgentService } from '../memory/memory-agent.service';
import { SubAgentService } from '../sub-agent/sub-agent.service';
import { createSearchKnowledgeBaseTool } from '../tools/search-content.tool';
import { createReadDocumentContentTool } from '../tools/read-content.tool';
import { createGetCurrentDraftTool } from '../tools/get-current-document.tool';
import { createRememberTool } from '../tools/remember.tool';
import { createForgetTool } from '../tools/forget.tool';
import { createSubAgentTool } from '../tools/sub-agent.tool';
import { createCreateTaskTool } from '../tools/create-task.tool';
import { createUpdateTaskTool } from '../tools/update-task.tool';
import { AgentSessionRepository } from '../session/agent-session.repository';
import { bridgeToolSchemas } from '../agent.utils';
import type { DocumentContext } from '../tools/get-current-document.tool';

export interface EntryContext {
  document?: DocumentContext;
  selectedText?: string;
  sessionKey?: string;
}

@Injectable()
export class ToolAssembler {
  constructor(
    private readonly contentService: ContentService,
    private readonly noteViewService: NoteViewService,
    private readonly memoryAgent: MemoryAgentService,
    private readonly subAgentService: SubAgentService,
    private readonly sessionRepo: AgentSessionRepository,
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
    const rawTools = {
      // 知识库搜索：全局可用
      search_knowledge_base: createSearchKnowledgeBaseTool(this.contentService),
      // 读取文档正文：只读已发布内容，当前草稿用 get_current_draft
      read_document_content: createReadDocumentContentTool(
        this.noteViewService,
      ),
      // 获取当前草稿画像：标题 + 大纲 + 字数 + 段落数 + 正文
      get_current_draft: createGetCurrentDraftTool(entryContext.document),
      // 记忆工具：走 Memory Agent 统一处理分类、去重、合并
      remember: createRememberTool(this.memoryAgent),
      forget: createForgetTool(this.memoryAgent),
      // 子 agent：主 agent 委派明确任务，独立 context + 只读工具
      sub_agent: createSubAgentTool(
        this.subAgentService,
        entryContext.document,
        tier,
        entryContext.sessionKey,
      ),
      // 任务管理：创建和更新写作任务
      ...(entryContext.sessionKey
        ? {
            create_task: createCreateTaskTool(
              this.sessionRepo,
              entryContext.sessionKey,
            ),
            update_task: createUpdateTaskTool(
              this.sessionRepo,
              entryContext.sessionKey,
            ),
          }
        : {}),
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

    // AI SDK v6 workaround：bridgeToolSchemas 保证 parameters / inputSchema 两个字段都存在
    return bridgeToolSchemas(filteredTools);
  }
}
