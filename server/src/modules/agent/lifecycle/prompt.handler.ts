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
 * 4. <memories_index>  — type=user 记忆标题索引（有才注入；全文按需走 recall_memory）
 * 5. <conversation_summary> — 本 session 的对话脉络（有才注入）
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
import type { AgentMemoryObservation } from '../memory/agent-memory-observation.entity';
import type { Skill } from '../../skill/skill.entity';
import { extractHeadings } from '../tools/markdown.utils';

/**
 * <memories_index> 注入的"最近 N 条原始 observations" 默认条数(2026-05-30 event log)。
 * 常量起步,等真要调再考虑放 SystemConfig。
 */
export const RECENT_OBSERVATIONS_LIMIT = 7;

export interface BuildSystemPromptParams {
  /** 所有者身份信息（从 SystemConfig.ownerProfile 读取） */
  ownerProfile?: {
    name: string;
    birthday: string;
    bio: string;
  };
  /**
   * 旧版 user 记忆(2026-05-30 起仅作降级路径,新架构走 memoriesView)。
   * 迁移后此字段一般传空数组。
   */
  coreMemories: AgentMemory[];
  /**
   * 2026-05-30(#150 event log 架构):MemoryViewService 派生的当前画像 markdown。
   * 有值优先注入 <memories_index>;无值时降级用 coreMemories 标题索引。
   */
  memoriesView?: string;
  /**
   * 2026-05-30 event log:最近 N 条原始 observations(by observedAt 倒序)。
   * 主 agent 看画像 + 看最近原始,知道"长期是这样 + 近期发生了啥"。远古细节调读工具。
   */
  recentObservations?: AgentMemoryObservation[];
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
     * 文集场景的集合脉络(可选):前端拼好的一段文字,描述本节点所属文集的标题/描述 +
     * 同集子节点列表 + 当前位置。笔记场景无此字段。让 Aurora 编辑单节点时有"整集意识"。
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
  /**
   * 本 agent 启用的 Skill 列表(已查出实体);lifecycle 在 onBeforeChat 并行加载时
   * 把 enabledSkillIds 解析成 Skill[] 传进来。注入 <available_skills> 块的轻量元数据
   * (name + description + when_to_use),body 永不进 system prompt(spec §5.1 红线)。
   */
  enabledSkills?: Skill[];
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

    // ——— 可用 Skills(技能/方法论池) ———
    // 轻量元数据(name + description + when_to_use)。body 永不出现在这里——spec §5.1 红线,单测保护。
    // body 只在 agent 调 Skill 工具时作为 tool_result 注入对话,按需载入。
    if (params.enabledSkills && params.enabledSkills.length > 0) {
      const items = params.enabledSkills
        .map(
          (s) =>
            `- name: ${s.name}\n  description: ${s.description}\n  when_to_use: ${s.whenToUse}`,
        )
        .join('\n\n');
      sections.push(
        `<available_skills>\n你有以下技能(方法论)可调用。识别到对应场景时,调 Skill 工具传 name 获取完整方法论指引。\n\n${items}\n</available_skills>`,
      );
    }

    // 4. ——— 记忆索引(2026-05-30 event log 架构,#150 续)———
    // 双层:① 派生画像(综合全量 observations,LLM 写)+ ② 最近 N 条原始(史书格式)
    // 远古细节调 recall_memory / search_memories
    const indexSegments: string[] = [];

    if (params.memoriesView && params.memoriesView.trim().length > 0) {
      indexSegments.push(
        `### 当前画像(后台从全量观察派生,按四类整理)\n\n${params.memoriesView.trim()}`,
      );
    } else if (params.coreMemories.length > 0) {
      // 降级路径:view 还没派生(迁移期 / 冷启动)→ 用旧 user 记忆标题
      const titles = params.coreMemories.map((m) => `- ${m.title}`).join('\n');
      indexSegments.push(
        `### 当前画像(降级:旧 user 记忆标题索引,view 派生后会替换)\n\n${titles}`,
      );
    }

    if (params.recentObservations && params.recentObservations.length > 0) {
      const formatted = params.recentObservations
        .map((o) => formatObservationAsHistory(o))
        .join('\n\n');
      indexSegments.push(
        `### 最近 ${params.recentObservations.length} 条观察(史书原文,新→旧)\n\n${formatted}`,
      );
    }

    if (indexSegments.length > 0) {
      sections.push(
        `<memories_index>\n你对所有者的认知:画像是长期综合,最近观察是近期细节。远古具体细节调 recall_memory(topic) 或 search_memories(query)。\n\n${indexSegments.join('\n\n---\n\n')}\n</memories_index>`,
      );
    }

    // 5. ——— 本 session 的对话脉络（compaction 提炼）———
    // 注:relatedMemories 自动召回已废,#150 改为模型主动调 recall_memory/search_memories 按需读
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

      // <collection>:文集场景才有——本节点所属整集的脉络(集合标题/描述 + 同集子节点列表 +
      // 当前位置),让 Aurora 编辑单节点时知道它在整集里的位置与邻节点,改稿能顾及整体连贯。
      // 笔记场景无 collectionContext,不注入。
      // 按需加载守卫(#143):脉络字符串 > 1500 字符时截断,详情让模型调 list_knowledge_base /
      // read_collection_entry 按需取——避免长集合膨胀 prompt。
      const collectionContextRaw = params.document.collectionContext?.trim();
      if (collectionContextRaw) {
        const LIMIT = 1500;
        const collectionContext =
          collectionContextRaw.length > LIMIT
            ? collectionContextRaw.slice(0, LIMIT) +
              '\n…(完整子节点列表已截断,用 list_knowledge_base 看完整结构)'
            : collectionContextRaw;
        sections.push(
          `<collection>\n${collectionContext}\n\n(需要看同集某个子节点的内容,用 read_collection_entry 传它的节点 id;当前这个用 get_current_draft)\n</collection>`,
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

/**
 * 把一条 observation 渲染成"史书一条"格式(2026-05-30 event log):
 *
 *   [2026-05-30 · aesthetic]
 *   ⟨context 背景史: ...⟩
 *   ——observation 判断: ...
 *
 * 长 context + 短 observation,读起来像太史公笔法(背景详写 + 一句点评)。
 * 没 context 就略 ⟨⟩ 行,直接写判断。
 */
function formatObservationAsHistory(o: AgentMemoryObservation): string {
  const date = new Date(o.observedAt).toISOString().slice(0, 10);
  const ctx = o.context?.trim();
  const obs = o.observation.trim();
  if (ctx) {
    return `[${date} · ${o.topic}]\n⟨${ctx}⟩\n——${obs}`;
  }
  return `[${date} · ${o.topic}]\n——${obs}`;
}
