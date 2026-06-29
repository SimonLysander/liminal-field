/**
 * PromptHandler — 组装 Aurora 的系统提示词。
 *
 * 按 AURORA-CONTEXT-SPEC.md 的三层拼装(本规范是这个文件的契约):
 *
 * 一、Aurora 本体(谁,所有 agent 都有,不随场景变)
 *   <role>        —— Aurora 人设(另一个自我 / 理想中的我;放最前,先立"我是谁")
 *   <owner>       —— 陪谁(有才注入)
 *   <conventions> —— 仅通用约定(与工具/场景无关,目前就一条:用中文)
 *
 * 二、横切动态数据(有则附,与场景正交)
 *   <available_skills>      —— 启用的 skill 轻量元数据(body 永不在此)
 *   <memories_index>        —— 派生画像 + 最近观察
 *   <conversation_summary>  —— 本 session 对话脉络
 *
 * 三、工作上下文(此刻在干什么,per agent/场景,统一)
 *   <work_context> = agent 定义(entrySystemPrompt)+ 本场景实时数据
 *                    —— 吃掉了原来散落的 current_context / gallery / collection / digest_report
 *   <tasks>        —— 当前写作计划(有未完成才注入)
 *   末尾:用户全局自定义 system prompt
 *
 * 设计原则:
 * - 每个块只下发到适用的 agent;主写作 Aurora 的约束在 writing-advisor 的 work_context,不全局灌。
 * - 正文/大数据不默认进 prompt(走 get_current_draft 等工具按需读);work_context 只点名。
 * - 新增场景 = 多一个 work_context 实例,不往本体/横切加全局块。
 */
import { Injectable, Logger } from '@nestjs/common';
import type { AgentMemory } from '../memory/agent-memory.entity';
import type { AgentMemoryObservation } from '../memory/agent-memory-observation.entity';
import type { Skill } from '../../skill/skill.entity';
import { extractHeadings } from '../tools/markdown.utils';
// aurora/*.md 各 section 固定文本托管到 promptManager(原散落字符串 → 统一管理)
import { PromptManagerService } from '../../../infrastructure/prompt/prompt-manager.service';

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
  /**
   * 简报阅读页场景(可选):**全篇注入**——报告完整 markdown + findings 完整字段(含
   * reason 事实摘要 + snippet 原文片段),让 sub-agent 不需要任何工具调用就能基于
   * 完整内容回答用户追问。
   *
   * 设计哲学:简报本身是小数据集(~5k 中文字),没必要假装是大数据要按需取。
   * 现代 LLM context window 200k+,塞 10k 完全 OK,多轮对话靠 prompt caching 摊销。
   *
   * 与 document/gallery 互斥(读报和写作不是一个场景)。
   * 选区追问走 selectionAttachments(chip 机制),不走这里。
   */
  digestReport?: {
    reportId: string;
    topicId: string;
    topicName: string;
    topicPrompt: string;
    headline: string;
    publishedAt: string;
    /** 报告正文 markdown 完整全文(~4500 字)。全塞,不再走 get_section 工具 */
    markdown: string;
    sections: string[];
    findings: {
      citationId: number;
      title: string;
      sourceName: string;
      url: string;
      reason?: string;
      snippet?: string;
    }[];
    /** 本事项订阅的信息源(id + name);sub-agent 调 browse 工具时从这里选 sourceId */
    sources?: { id: string; name: string }[];
  };
  /** 用户在设置中配置的全局自定义系统提示词（可选） */
  customSystemPrompt?: string;
  /** AgentEntryConfig 里为该 agent 入口配置的系统提示词（可选），即该 agent 的 work_context 定义 */
  entrySystemPrompt?: string;
  /**
   * 学习场景的"当前业务场景"状态串(前端实时拼好,无正文):在学哪个领域/目标、当前第几篇、
   * 篇目结构 + 各篇状态。进 work_context 的实时数据段。
   */
  learningContext?: string;
  /** 当前会话的写作计划(注入让模型看得到自己的清单,可用 write_tasks 整体改写) */
  tasks?: Array<Record<string, unknown>>;
  /**
   * 本 agent 启用的 Skill 列表(已查出实体);注入 <available_skills> 块的轻量元数据
   * (name + description + when_to_use),body 永不进 system prompt(spec §5.1 红线)。
   */
  enabledSkills?: Skill[];
}

@Injectable()
export class PromptHandler {
  private readonly logger = new Logger(PromptHandler.name);

  constructor(
    // PromptManagerService 是 @Global() 注入,无需 module import
    private readonly promptManager: PromptManagerService,
  ) {}

  buildSystemPrompt(params: BuildSystemPromptParams): string {
    const sections: string[] = [];
    const owner = params.ownerProfile;
    const ownerName = owner?.name?.trim() || '所有者';

    // ═══ 一、Aurora 本体（谁,所有 agent 都有）═══
    // <role> 在最前:先立"我是谁";<owner> 紧随;<conventions> 仅通用约定。
    // 工具指引、写作专属约束不在本体——它们随 agent 进各自的 <work_context>。
    sections.push(
      this.promptManager.render('aurora/role.md', { owner_name: ownerName }),
    );

    if (owner?.name) {
      const lines = [`你在陪伴 ${owner.name}。`];
      if (owner.birthday) lines.push(`生日：${owner.birthday}`);
      if (owner.bio) lines.push(`简介：${owner.bio}`);
      sections.push(`<owner>\n${lines.join('\n')}\n</owner>`);
    }

    sections.push(
      this.promptManager.render('aurora/conventions.md', {
        owner_name: ownerName,
      }),
    );

    // ═══ 二、横切动态数据（有则附，与场景正交）═══

    // <available_skills>:轻量元数据(name/description/when_to_use)。
    // body 永不在此——只在 agent 调 load_skill 工具时作为 tool_result 注入(spec §5.1 红线)。
    if (params.enabledSkills && params.enabledSkills.length > 0) {
      const items = params.enabledSkills
        .map(
          (s) =>
            `- name: ${s.name}\n  description: ${s.description}\n  when_to_use: ${s.whenToUse}`,
        )
        .join('\n\n');
      const skillsPrelude = this.promptManager.render(
        'aurora/partials/skills-prelude.md',
      );
      sections.push(
        `<available_skills>\n${skillsPrelude.trim()}\n\n${items}\n</available_skills>`,
      );
      this.logger.debug(
        `buildSystemPrompt: 注入 <available_skills>(${params.enabledSkills.length} 个: ${params.enabledSkills.map((s) => s.name).join(', ')})`,
      );
    }

    // <memories_index>:派生画像(全量综合)+ 最近 N 条原始(史书格式);远古细节调读工具。
    const indexSegments: string[] = [];
    if (params.memoriesView && params.memoriesView.trim().length > 0) {
      indexSegments.push(
        `### 当前画像(后台从全量观察派生,按四类整理)\n\n${params.memoriesView.trim()}`,
      );
    } else if (params.coreMemories.length > 0) {
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
      const memoriesPrelude = this.promptManager.render(
        'aurora/partials/memories-prelude.md',
      );
      sections.push(
        `<memories_index>\n${memoriesPrelude.trim()}\n\n${indexSegments.join('\n\n---\n\n')}\n</memories_index>`,
      );
    }

    // <conversation_summary>:本 session 的对话脉络(compaction 提炼)。
    if (params.sessionMemory) {
      const summaryPrelude = this.promptManager.render(
        'aurora/partials/conversation-summary-prelude.md',
      );
      sections.push(
        `<conversation_summary>\n${summaryPrelude.trim()}\n${params.sessionMemory}\n</conversation_summary>`,
      );
    }

    // ═══ 三、工作上下文（此刻在干什么，per agent/场景，统一）═══
    // = agent 定义(entrySystemPrompt)+ 本场景实时数据。各场景互斥(学习/编辑/画廊/简报阅读)。
    // 数据按需点名,正文/大数据靠工具读(简报例外:小数据集全篇注入)。
    const work: string[] = [];

    if (params.entrySystemPrompt?.trim()) {
      work.push(params.entrySystemPrompt.trim());
    }

    if (params.learningContext?.trim()) {
      // 学习场景:篇目结构(前端拼好,无正文)
      work.push(params.learningContext.trim());
    } else if (params.document) {
      // 编辑文档场景:点名标题/字数(正文走 get_current_draft)+ 文集脉络 + 大纲
      const { title, bodyMarkdown } = params.document;
      work.push(
        `${ownerName} 当前正在编辑《${title || '未命名'}》(约 ${bodyMarkdown.length} 字)。正文不直接注入,需要看时调 get_current_draft。`,
      );
      const collectionContextRaw = params.document.collectionContext?.trim();
      if (collectionContextRaw) {
        const LIMIT = 1500;
        const collectionContext =
          collectionContextRaw.length > LIMIT
            ? collectionContextRaw.slice(0, LIMIT) +
              '\n…(完整子节点列表已截断,用 list_knowledge_base 看完整结构)'
            : collectionContextRaw;
        work.push(
          `<collection>\n${collectionContext}\n\n(需要看同集某个子节点的内容,用 read_collection_entry 传它的节点 id;当前这个用 get_current_draft)\n</collection>`,
        );
      }
      const outline = extractHeadings(bodyMarkdown);
      if (outline.length > 0) {
        work.push(
          `<outline>\n${outline.map((h) => `  ${h}`).join('\n')}\n</outline>`,
        );
      }
    } else if (params.gallery) {
      // 画廊场景:点名在整理哪个画廊/几张照片/有无随笔。照片靠 view_photos、清单/随笔靠 get_current_draft。
      const g = params.gallery;
      work.push(
        `${ownerName} 正在整理画廊《${g.title || '未命名'}》——${g.photos.length} 张照片${g.prose ? ',还配着一段随笔' : ''}。这些照片你看得见(想看哪张就看),清单、随笔、每张现有的图说也都能调出来读。`,
      );
    } else if (params.digestReport) {
      // 简报阅读场景:报告全文 + findings 全字段全篇注入(小数据集,一眼看完答得深、零工具往返)。
      const r = params.digestReport;
      const lines: string[] = [];
      lines.push(
        `${ownerName} 正在读「${r.topicName}」专栏 ${r.publishedAt} 这期:《${r.headline}》。`,
      );
      lines.push(`本期选题指引(${ownerName} 自己设的):「${r.topicPrompt}」`);
      if (r.sections.length > 0) {
        lines.push(``);
        lines.push(`章节:`);
        for (const s of r.sections) lines.push(`  · ${s}`);
      }
      if (r.markdown?.trim()) {
        lines.push(``);
        lines.push(`报告正文(markdown,正文里 [CIT N] 是 finding 编号):`);
        lines.push(`---`);
        lines.push(r.markdown.trim());
        lines.push(`---`);
      }
      if (r.findings.length > 0) {
        lines.push(``);
        lines.push(
          `本期收录的 ${r.findings.length} 条 findings(正文 [CIT N] 引用的就是这里):`,
        );
        for (const f of r.findings) {
          lines.push(``);
          lines.push(`[CIT ${f.citationId}] 《${f.title}》— ${f.sourceName}`);
          if (f.reason) lines.push(`  事实摘要:${f.reason}`);
          if (f.snippet) lines.push(`  原文片段:${f.snippet}`);
          lines.push(`  URL:${f.url}`);
        }
      }
      if (r.sources && r.sources.length > 0) {
        lines.push(``);
        lines.push(
          `${ownerName} 本事项订阅的信息源(用 browse 工具拉某个源过去 7 天):`,
        );
        for (const s of r.sources) {
          lines.push(`  - ${s.id} : ${s.name}`);
        }
      }
      work.push(lines.join('\n'));
    }

    if (work.length > 0) {
      sections.push(`<work_context>\n${work.join('\n\n')}\n</work_context>`);
    }

    // <tasks>:当前写作计划,仅有未完成任务才注入(避免每轮灌回"全 done"清单)。
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
        .map(
          (t) =>
            `- [${STATUS[taskStatus(t)] ?? taskStatus(t)}] ${taskTitle(t)}`,
        )
        .join('\n');
      sections.push(`<tasks>
当前写作计划(随时用 write_tasks 整体改写:增删、重排、标记进度;用列表顺序表达先后;全部完成后传空列表清空):
${lines}
</tasks>`);
    }

    // 用户全局自定义 system prompt(Settings 里配的,最后追加)
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
