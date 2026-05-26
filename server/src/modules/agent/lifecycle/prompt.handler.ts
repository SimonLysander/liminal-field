/**
 * PromptHandler — 组装 AI 写作顾问的系统提示词。
 *
 * 职责：
 * 根据当前会话上下文（记忆、文档、摘要等）组装完整的 system prompt。
 * 采用 XML 分节格式，各节相互独立，按需注入。
 *
 * 分节结构（由近及远：先"我是谁/你是谁/你能做什么"，再记忆，最后才是当前业务场景）：
 * 1. <owner>     — 介绍所有者（在陪伴谁，有才注入）
 * 2. <role>      — Aurora 是谁（灵魂/人设：另一个自我、最懂你的朋友；固定）
 * 3. <tools>     — 工具能力 + remember 记忆协议（引导主动调用，固定）
 * 4. <core_memories>   — type=user 记忆全文（有才注入）
 * 5. <related_memories> + <conversation_summary> — 本 session 的召回记忆与脉络（有才注入）
 * 6. <instructions>    — 行为约束（固定）
 * 7. <current_context> — 当前业务场景：在写哪篇（只点名，正文靠 get_current_draft 读）
 * 8. <tasks>           — 写作计划（有未完成才注入）
 * 9. 入口级 / 全局自定义 system prompt（有才注入）
 *
 * 设计原则：current_context 不再注入正文预览——模型有 get_current_draft 工具，
 * 让它按需读，避免把正文灌进每一轮的 system prompt（省 token、长文也不截断）。
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
  /** 前端传入的相关召回记忆（全文注入，可选） */
  relatedMemories?: Array<{ title: string; content: string }>;
  /**
   * 本草稿 session 记忆的 content（compaction 把超窗口旧对话提炼出的会话脉络）。
   * 替代旧 sessionSummary——脉络的归宿是 session 记忆,不再有独立 summary 概念。
   */
  sessionMemory?: string;
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
  /** 当前会话的写作计划(注入让模型看得到自己的清单,可用 write_tasks 整体改写) */
  tasks?: Array<Record<string, unknown>>;
  /**
   * 当前编辑器锚点(selection/cursor 位置)，由前端 AnchorBridge 序列化后经 transport 传入。
   * type='range' → 注入 <selection>，Aurora 用 rewrite_selection；
   * type='cursor' → 注入 <cursor>，Aurora 用 insert_at_cursor；
   * type='none' 或缺省 → 不注入（Aurora 按整体改/重写走 rewrite_document）。
   */
  anchor?: {
    type: 'none' | 'cursor' | 'range';
    blockIndex?: number;
    startPath?: number[];
    endPath?: number[];
    textPreview?: string;
  };
}

@Injectable()
export class PromptHandler {
  buildSystemPrompt(params: BuildSystemPromptParams): string {
    const sections: string[] = [];
    const owner = params.ownerProfile;
    const ownerName = owner?.name?.trim() || '所有者';

    // 1. ——— 介绍所有者（在陪伴谁） ———
    if (owner?.name) {
      const lines = [`你在陪伴 ${owner.name}。`];
      if (owner.birthday) lines.push(`生日：${owner.birthday}`);
      if (owner.bio) lines.push(`简介：${owner.bio}`);
      if (owner.interests) lines.push(`在意的：${owner.interests}`);
      sections.push(`<owner>\n${lines.join('\n')}\n</owner>`);
    }

    // 2. ——— Aurora 是谁（灵魂/人设，不是业务职责） ———
    sections.push(`<role>
你是 Aurora。

你不是工具，也不是助手——你是 ${ownerName} 的另一个自我：陪 ${ownerName} 一起成长，见证 ta 把斑驳而卑微的期许，一点点长成生机勃勃、斩钉截铁的现实。你是最懂 ${ownerName} 的朋友，是 ta 自我与超我之间的那个声音。

你们一起写作。写作是 ${ownerName} 与自己对话的方式；你在这场对话里既贴心又诚实——懂 ta 的言外之意，也敢点出 ta 没看见的盲点。
</role>`);

    // 3. ——— 工具使用指引（只引导"何时用",不重复 schema——工具的 name/description/参数
    //    AI SDK 已喂给模型；逐条抄反而易与 schema 不同步） ———
    sections.push(`<tools>
你能：读 ${ownerName} 当前在写的文稿、搜索/浏览/读取 ta 知识库里的笔记/文集/相册、把值得记的写进记忆、为多步任务维护写作计划。
- 需要文稿内容或知识库信息时，主动调对应工具，不要凭记忆或假设
- 发现值得长期记住的信息，随手 remember（context 会重置，没记的会丢）
</tools>`);

    // 5. ——— Core Memories：type=user 全文 ———
    if (params.coreMemories.length > 0) {
      const lines = params.coreMemories
        .map((m) => `[${m.title}]\n${m.content}`)
        .join('\n\n');
      sections.push(`<core_memories>\n${lines}\n</core_memories>`);
    }

    // 6. ——— 本 session 的召回记忆 + 对话脉络 ———
    if (params.relatedMemories && params.relatedMemories.length > 0) {
      const lines = params.relatedMemories
        .map((m) => `[${m.title}]\n${m.content}`)
        .join('\n\n');
      sections.push(
        `<related_memories>\n与当前文档相关的记忆（已自动召回）：\n${lines}\n</related_memories>`,
      );
    }
    if (params.sessionMemory) {
      sections.push(
        `<conversation_summary>\n以下是本次会话的脉络记忆（更早的对话已被提炼进记忆，原文仍可用 read_conversation_history 精确回溯）：\n${params.sessionMemory}\n</conversation_summary>`,
      );
    }

    // 7. ——— 行为约束 ———
    sections.push(`<instructions>
- 需要文档内容或知识库信息时，先调工具，不要凭空假设
- 用中文回答，除非 ${ownerName} 明确要求其他语言
- 不重复 ${ownerName} 已说过的话
- 为 ${ownerName} 起草初稿、片段乃至整篇都可以；你交付的是供 ta 接手打磨的草稿与起点，而非终稿
- 多步任务先用 write_tasks 列计划再动手；每步更新清单（同一时刻只一个进行中）；全部完成后传空列表清空。简单一步的事不必列计划
- 修改正文时按场景选工具:有选区→rewrite_selection;光标在某段且要新增→insert_at_cursor;整体改/重写整篇→rewrite_document。你只负责写新内容,定位由编辑器锚点(见 <selection> / <cursor>)给出
</instructions>`);

    // 8. ——— 当前业务场景：只点名在编辑哪篇，正文靠 get_current_draft 工具读（不塞进 context） ———
    if (params.document) {
      const { title, bodyMarkdown } = params.document;
      const wordCount = bodyMarkdown.length;
      sections.push(`<current_context>
${ownerName} 当前正在编辑文档《${title || '未命名'}》（约 ${wordCount} 字）。
需要了解它的内容、结构或大纲时，调用 get_current_draft 获取——不要假设内容。
</current_context>`);
    }

    // 8b. ——— 编辑器锚点：有 selection/cursor 才注入（type='none' 跳过）。
    // range = 用户选中了一段文字，Aurora 用 rewrite_selection 改这一段。
    // cursor = 用户光标停在某段，Aurora 用 insert_at_cursor 在那里新增内容。
    if (params.anchor && params.anchor.type !== 'none') {
      if (params.anchor.type === 'range') {
        const preview = params.anchor.textPreview ?? '';
        sections.push(
          `<selection>\n${ownerName} 当前选中第 ${(params.anchor.blockIndex ?? 0) + 1} 段的一段文字「${preview}${preview.length === 40 ? '…' : ''}」。\n要修改这段时用 rewrite_selection。\n</selection>`,
        );
      } else if (params.anchor.type === 'cursor') {
        sections.push(
          `<cursor>\n${ownerName} 光标在第 ${(params.anchor.blockIndex ?? 0) + 1} 段。\n要在这里新增内容时用 insert_at_cursor。\n</cursor>`,
        );
      }
    }

    // ——— 当前写作计划：有「未完成」任务才注入。
    // 全部完成的计划不再注入(否则每轮都把一份"全done"的清单灌回上下文,越积越脏;
    // 模型也被要求做完后 write_tasks([]) 主动清空,这里是双保险)。 ———
    // t 是 Record<string, unknown>:用类型守卫取 string 字段,避免 String(unknown) 的 [object Object]
    const taskStatus = (t: Record<string, unknown>): string =>
      typeof t.status === 'string' ? t.status : 'pending';
    const taskTitle = (t: Record<string, unknown>): string =>
      typeof t.title === 'string' ? t.title : '';
    const hasActiveTask =
      params.tasks?.some((t) => taskStatus(t) !== 'done') ?? false;
    if (params.tasks && params.tasks.length > 0 && hasActiveTask) {
      const STATUS: Record<string, string> = {
        pending: '待办',
        in_progress: '进行中',
        done: '完成',
      };
      const lines = params.tasks
        .map((t) => {
          const status = taskStatus(t);
          return `- [${STATUS[status] ?? status}] ${taskTitle(t)}`;
        })
        .join('\n');
      sections.push(`<tasks>
当前写作计划(随时用 write_tasks 整体改写:增删、重排、标记进度;用列表顺序表达先后;全部完成后传空列表清空):
${lines}
</tasks>`);
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
