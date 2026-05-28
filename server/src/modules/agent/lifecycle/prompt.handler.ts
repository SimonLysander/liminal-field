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
 * 3. <tools>     — 工具能力 + Read-before-Edit 协议 + remember 记忆协议（固定）
 * 4. <core_memories>   — type=user 记忆全文（有才注入）
 * 5. <related_memories> + <conversation_summary> — 本 session 的召回记忆与脉络（有才注入）
 * 6. <instructions>    — 行为约束（含 bodyHash 改稿纪律，固定）
 * 7. <current_context> — 当前业务场景：在写哪篇（只点名，正文不直接注入）
 * 8. <outline>         — 文档大纲（h1-h3 标题列表，有标题才注入）
 * 9. <tasks>           — 写作计划（有未完成才注入）
 * 10. 入口级 / 全局自定义 system prompt（有才注入）
 *
 * 设计原则（v3.1，Read-before-Edit 硬化）：
 * - 正文不默认注入 prompt（避免长文吃满上下文 + 老版本陈旧）
 * - 模型要看正文 → 调 get_current_draft 拿 bodyHash + 当前快照
 * - 改稿 → propose_document_rewrite 必带 bodyHash 校验"基于最新版改"
 * - 服务器返 stale → 模型基于返回的 currentMarkdown 重生成 newMarkdown + 最新 bodyHash 重试
 * - <outline> 给模型轻量结构感（定位用户口中"哪一段"），但不替代正文读取
 */
import { Injectable } from '@nestjs/common';
import type { AgentMemory } from '../memory/agent-memory.entity';
import { extractHeadings } from '../tools/markdown.utils';

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
    /**
     * 文集场景的集合脉络(可选):前端拼好的一段文字,描述本条目所属文集的标题/描述 +
     * 同集条目列表 + 当前位置。笔记场景无此字段。让 Aurora 编辑单条时有"整集意识"。
     */
    collectionContext?: string;
  };
  /**
   * 画廊场景(可选):只点场景——画廊标题/张数/有无随笔。
   * 照片清单、随笔、图说等"内容"不在这里,模型靠 get_current_draft read、view_photos 看图。
   * 与 document 互斥(画廊不是文稿)。
   */
  gallery?: {
    contentItemId: string;
    title: string;
    prose: string;
    photos: {
      index: number;
      fileName: string;
      caption: string;
      tags: Record<string, string>;
    }[];
  };
  /** 用户在设置中配置的全局自定义系统提示词（可选） */
  customSystemPrompt?: string;
  /** AgentEntryConfig 里为该 agent 入口配置的系统提示词（可选），优先级高于全局配置 */
  entrySystemPrompt?: string;
  /** 当前会话的写作计划(注入让模型看得到自己的清单,可用 write_tasks 整体改写) */
  tasks?: Array<Record<string, unknown>>;
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
你能:读 ${ownerName} 当前在写的文稿、搜索/浏览/读取 ta 知识库里的笔记/文集/相册、联网查外部信息、把值得记的写进记忆、为多步任务维护写作计划。
- 需要文稿正文时,主动调 get_current_draft,会拿到当前 bodyHash
- 调 propose_document_rewrite 改稿前**必须**先 get_current_draft;bodyHash 必填,值取自 get_current_draft 返回的 bodyHash
- 需要外部事实/引用/资料时调 web_search(若可用);用户贴 URL 让你读、或 web_search 后想读全文,调 web_fetch。只在写作或回答真需要外部依据时用,**不要为闲聊瞎调**,凭训练数据能答就直接答
- 发现值得长期记住的信息,随手 remember(context 会重置,没记的会丢)
</tools>`);

    // 4. ——— Core Memories：type=user 全文 ———
    if (params.coreMemories.length > 0) {
      const lines = params.coreMemories
        .map((m) => `[${m.title}]\n${m.content}`)
        .join('\n\n');
      sections.push(`<core_memories>\n${lines}\n</core_memories>`);
    }

    // 5. ——— 本 session 的召回记忆 + 对话脉络 ———
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

    // 6. ——— 行为约束 ———
    sections.push(`<instructions>
- 需要文档内容或知识库信息时,先调工具,不要凭空假设
- 用中文回答,除非 ${ownerName} 明确要求其他语言
- 不重复 ${ownerName} 已说过的话
- 为 ${ownerName} 起草初稿、片段乃至整篇都可以;你交付的是供 ta 接手打磨的草稿与起点,而非终稿
- 多步任务先用 write_tasks 列计划再动手;每步更新清单(同一时刻只一个进行中);全部完成后传空列表清空。简单一步的事不必列计划
- 改稿前**必先** get_current_draft 拿 bodyHash → propose_document_rewrite 必带 bodyHash(取自上次 get_current_draft 返回的 meta.bodyHash);若服务器返 stale,基于返回的 currentMarkdown 重新生成新版 newMarkdown 并附最新 bodyHash
- 用户明确要求修改正文时(改紧凑/重写/调整结构等)调用 propose_document_rewrite,给完整新版正文(不要片段);引用块(\`> 第 N 段:「…」\`)是用户特别想让你看的几段,不是必须改的范围——你自由决定改哪;纯讨论/解释/给建议时不调工具,正常聊天即可
</instructions>`);

    // 7. ——— 当前业务场景：点名在编辑哪篇 + 大纲（v3.1 起正文不再注入）———
    if (params.document) {
      const { title, bodyMarkdown } = params.document;
      const wordCount = bodyMarkdown.length;
      sections.push(`<current_context>
${ownerName} 当前正在编辑文档《${title || '未命名'}》(约 ${wordCount} 字)。
正文不直接注入,需要看时调 get_current_draft;若有标题,大纲见随后一节。
</current_context>`);

      // <collection>:文集场景才有——本条目所属整集的脉络(集合标题/描述 + 同集条目列表 +
      // 当前位置),让 Aurora 编辑单条时知道它在整集里的位置与邻篇,改稿能顾及整体连贯。
      // 笔记场景无 collectionContext,不注入。
      const collectionContext = params.document.collectionContext?.trim();
      if (collectionContext) {
        sections.push(
          `<collection>\n${collectionContext}\n\n(需要看同集某篇的内容,用 read_collection_entry 传它的 entryKey;当前这篇用 get_current_draft)\n</collection>`,
        );
      }

      // <outline>:轻量大纲让模型看到文档结构,定位"用户说改哪段"更快;
      // 但正文要看仍需调 get_current_draft 拿完整 bodyHash 走 Read-before-Edit。
      const outline = extractHeadings(bodyMarkdown);
      if (outline.length > 0) {
        sections.push(
          `<outline>\n${outline.map((h) => `  ${h}`).join('\n')}\n</outline>`,
        );
      }
    }

    // ——— 画廊场景：只点场景（在写哪个画廊/几张照片/有无随笔）；
    // 照片清单/图说/随笔等内容不在这里，模型靠 get_current_draft read、view_photos 看图。
    // 与 document 互斥（画廊不是文稿）。———
    if (params.gallery) {
      const g = params.gallery;
      sections.push(`<gallery>
${ownerName} 正在整理画廊《${g.title || '未命名'}》——${g.photos.length} 张照片${g.prose ? ',还配着一段随笔' : ''}。
这些照片你看得见(想看哪张就看),清单、随笔、每张现有的图说也都能调出来读。${ownerName} 想聊照片、想要图说,顺着 ta 的话自然来就好。
</gallery>`);
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
