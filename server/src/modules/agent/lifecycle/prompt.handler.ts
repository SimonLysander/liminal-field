/**
 * PromptHandler — 组装 AI 写作顾问的系统提示词。
 *
 * 职责：
 * 根据当前会话上下文（记忆、文档、摘要等）组装完整的 system prompt。
 * 采用 XML 分节格式，各节相互独立，按需注入。
 *
 * 分节结构：
 * 1. <role>              — 角色定义（固定内容）
 * 2. <memory_protocol>   — 记忆使用指引（简化版）
 * 3. <core_memories>     — type=user 的记忆全文（有才注入）
 * 4. <memory_index>      — type=project 的标题索引（有才注入）
 * 5. <related_memories>  — 自动召回的相关 project 记忆全文（有才注入）
 * 6. <instructions>      — 行为约束
 * 7. <conversation_summary> — compaction 产生的摘要（有才注入）
 * 8. <current_document>  — 当前文档画像（有才注入）
 * 9. 入口级 system prompt（AgentEntryConfig 配置的，有才注入）
 * 10. 用户全局自定义 system prompt（Settings 配置的，有才注入）
 *
 * 从 prompt-builder.service.ts 迁移过来，接口参数按新架构调整（增加 relatedMemories）。
 */
import { Injectable } from '@nestjs/common';
import type { AgentMemory } from '../memory/agent-memory.entity';

export interface BuildSystemPromptParams {
  /** 所有者身份信息（从 SystemConfig.ownerProfile 读取） */
  ownerProfile?: {
    name: string;
    birthday: string;
    bio: string;
    interests: string;
  };
  /** type=user 的记忆（始终全文注入） */
  coreMemories: AgentMemory[];
  /** type=project 的记忆（只注入 key: title 索引） */
  indexMemories: AgentMemory[];
  /** SessionLoad 阶段自动召回的相关 project 记忆（全文注入） */
  relatedMemories?: Array<{ title: string; content: string }>;
  /** compaction 产生的旧消息摘要（可选） */
  sessionSummary?: string;
  /** 用户当前正在编辑的文档（可选） */
  document?: {
    contentItemId: string;
    title: string;
    bodyMarkdown: string;
  };
  /** 用户在设置中配置的全局自定义系统提示词（可选） */
  customSystemPrompt?: string;
  /** AgentEntryConfig 里为该 agent 入口配置的系统提示词（可选），优先级高于全局配置 */
  entrySystemPrompt?: string;
}

@Injectable()
export class PromptHandler {
  buildSystemPrompt(params: BuildSystemPromptParams): string {
    const sections: string[] = [];

    // ——— 所有者身份（有配置时注入，让 agent 知道在跟谁对话） ———
    const owner = params.ownerProfile;
    if (owner?.name) {
      const lines = [`你正在与 ${owner.name} 对话。${owner.name} 是 Liminal Field 的所有者。`];
      if (owner.birthday) lines.push(`生日：${owner.birthday}`);
      if (owner.bio) lines.push(`简介：${owner.bio}`);
      if (owner.interests) lines.push(`关注领域：${owner.interests}`);
      sections.push(`<owner>\n${lines.join('\n')}\n</owner>`);
    }

    // ——— 角色定义 ———
    sections.push(`<role>
你是 Liminal Field 的写作顾问 AI。
Liminal Field 是一个个人知识库与写作空间，所有者在此记录笔记、整理相册、撰写文集。

你的职责：
- 帮助所有者改善文章结构、逻辑脉络和表达方式
- 当问题涉及所有者知识库中的已有内容时，主动搜索并引用
- 不替所有者写内容——给方向、给建议、给问题，让所有者自己动笔
- 回答简洁直接，不废话，不过度解释
</role>`);

    // ——— 记忆协议（简化版：只告诉 agent 随时用 remember 工具记住信息） ———
    sections.push(`<memory_protocol>
工作过程中，发现值得记住的信息随时调用 remember 工具。
你只需要说"记住什么"，记忆系统会自动处理分类、去重和合并。
假设 context 随时可能被重置——没写进记忆的东西会丢失。
</memory_protocol>`);

    // ——— Core Memories：type=user，始终全文注入 ———
    if (params.coreMemories.length > 0) {
      const lines = params.coreMemories
        .map((m) => `[${m.title}]\n${m.content}`)
        .join('\n\n');
      sections.push(`<core_memories>
${lines}
</core_memories>`);
    }

    // ——— Memory Index：type=project，只注入标题，按需读取 ———
    if (params.indexMemories.length > 0) {
      const lines = params.indexMemories.map((m) => `- ${m.title}`).join('\n');
      sections.push(`<memory_index>
可用记忆（需要时调用工具获取详情）：
${lines}
</memory_index>`);
    }

    // ——— Related Memories：自动召回的相关 project 记忆全文 ———
    if (params.relatedMemories && params.relatedMemories.length > 0) {
      const lines = params.relatedMemories
        .map((m) => `[${m.title}]\n${m.content}`)
        .join('\n\n');
      sections.push(`<related_memories>
与当前文档相关的记忆（已自动召回）：
${lines}
</related_memories>`);
    }

    // ——— 行为约束 ———
    sections.push(`<instructions>
- 优先使用工具获取信息，不要凭空猜测文档内容
- 回答使用中文，除非所有者明确要求其他语言
- 不要在回答中重复所有者已说过的内容
- 不要生成完整的文章草稿，聚焦在建议和改进方向上
</instructions>`);

    // ——— 对话历史摘要（compaction 产生的，有才注入） ———
    if (params.sessionSummary) {
      sections.push(`<conversation_summary>
以下是之前对话的摘要（更早的消息已被压缩）：
${params.sessionSummary}
</conversation_summary>`);
    }

    // ——— 当前文档（有才注入）：标题 + 字数 + 正文预览（500 字） ———
    if (params.document) {
      const { title, bodyMarkdown } = params.document;
      const wordCount = bodyMarkdown.length;
      const preview =
        bodyMarkdown.length > 500
          ? bodyMarkdown.slice(0, 500) +
            '\n\n[... 使用 get_current_draft 工具获取完整内容]'
          : bodyMarkdown;
      sections.push(`<current_document>
所有者当前正在编辑的文档：
标题：${title}
字数（字符数）：${wordCount}
正文预览：
${preview}
</current_document>`);
    }

    // ——— 入口级自定义 system prompt（AgentEntryConfig 配置的，优先注入） ———
    if (params.entrySystemPrompt?.trim()) {
      sections.push(params.entrySystemPrompt.trim());
    }

    // ——— 用户全局自定义 system prompt（Settings 里配置的） ———
    if (params.customSystemPrompt?.trim()) {
      sections.push(params.customSystemPrompt.trim());
    }

    return sections.join('\n\n');
  }
}
