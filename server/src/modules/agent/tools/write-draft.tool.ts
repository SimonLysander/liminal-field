/**
 * write_draft — 学习场景 AI 初稿写入工具（learning-writer agent 专用）。
 *
 * 设计要点：
 * 1. 目标节点从上下文绑定（noteContentItemId 工厂入参），不由模型传 ——
 *    防止 learning-writer 越权往任意节点写（模型只能写它自己正在操作的那一篇）。
 * 2. 只写 aidraft:{noteId}，绝不碰 draft:（用户草稿）、绝不建节点。
 *    aidraft 对用户只读，永不参与 commit/publish 流水线。
 * 3. title 从 markdown 第一个 # 标题提取；summary 取首个非标题段截断。
 *
 * 入参 schema：
 *   markdown — 完整 AI 初稿正文（含标题和所有章节）
 */
import { tool, jsonSchema } from 'ai';
import type { EditorDraftRepository } from '../../workspace/editor-draft.repository';
import { toolResult } from './tool-result';

/** 从 markdown 提取标题：优先取第一个 # 标题，退而取首行（去除空白），截断至 80 字。 */
export function extractTitle(markdown: string): string {
  const headingMatch = markdown.match(/^#{1,6}\s+(.+)/m);
  if (headingMatch) return headingMatch[1].trim().slice(0, 80);
  return markdown.split('\n')[0]?.trim().slice(0, 80) ?? '（无标题）';
}

/** 从 markdown 提取摘要：跳过标题行，取第一个非空非标题段，截断至 150 字。 */
export function extractSummary(markdown: string): string {
  for (const line of markdown.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) return trimmed.slice(0, 150);
  }
  return '';
}

/**
 * 一条外部来源（出处）。轻档：只取简报 Finding 里最关键的 title + url，
 * 不搬 sourceName/snippet/reason 那套重字段——学习侧没有固定源池，够用即可。
 */
export interface DraftSource {
  title: string;
  url: string;
}

export interface CitationAuditItem {
  claim: string;
  sourceIndexes: number[];
}

export interface CitationAudit {
  conceptsAndDefinitions?: CitationAuditItem[];
  attributionAndEvolution?: CitationAuditItem[];
  dataAndState?: CitationAuditItem[];
  rulesAndEvidence?: CitationAuditItem[];
}

/**
 * 正文里的引用标记，与简报模块同一套约定，一个产品一套引用语法：
 *   [@#CIT 1]        引第 1 条
 *   [@#CIT 1,3]      引第 1、3 条
 *   [@#CIT 1-3]      引第 1~3 条（范围）
 *   [@#CIT 1,3-5,7]  逗号分隔的单条与范围混排
 * 捕获组取整个 ref 串（如 "1,3-5,7"），交给 parseCitationNumbers 展开；
 * 容忍模型偶尔漏掉 @# 写成 [CIT …]。
 */
const CITATION_MARKER = /\[(?:@#)?CIT\s+([\d,\s-]+)\]/g;

/**
 * 把一个引用 ref 串展开成它引到的 source 序号列表（1-based）。
 * "1,3-5,7" → [1,3,4,5,7]。范围写反（5-3）也不丢，退化成取两端。
 */
function parseCitationNumbers(refBody: string): number[] {
  const nums: number[] = [];
  for (const tokenRaw of refBody.split(',')) {
    const token = tokenRaw.trim();
    if (!token) continue;
    const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = parseInt(range[1], 10);
      const b = parseInt(range[2], 10);
      if (a <= b) for (let n = a; n <= b; n++) nums.push(n);
      else nums.push(a, b);
    } else {
      const n = parseInt(token, 10);
      if (!Number.isNaN(n)) nums.push(n);
    }
  }
  return nums;
}

/**
 * 引用一致性校验（门禁 validate 与工具 execute 共用）。只拦两类硬错：
 *   1. 悬空引用——正文标了 [^N] 但 sources 不足 N 条（照搬就指向不存在的源）
 *   2. 来源残缺——某条 source 缺 title 或 url（无法溯源）
 * 不强制「每条 source 都被正文引用」（可能整体性引用），也不强制必须有 source
 * （纯思辨、无可证伪事实的篇允许零出处）。返回 null 表示通过。
 */
export function validateCitations(
  markdown: string,
  sources: DraftSource[] | undefined,
): string | null {
  const srcs = sources ?? [];
  const cited: number[] = [];
  for (const m of markdown.matchAll(CITATION_MARKER)) {
    cited.push(...parseCitationNumbers(m[1]));
  }
  const maxMarker = cited.length ? Math.max(...cited) : 0;
  if (maxMarker > srcs.length) {
    return `正文出现 [@#CIT ${maxMarker}]，但 sources 只有 ${srcs.length} 条:每个 [@#CIT N] 都要在 sources 第 N 条有对应来源。补齐 sources 或修正编号后重新调用。`;
  }
  for (let i = 0; i < srcs.length; i++) {
    const s = srcs[i];
    if (!s || !s.title?.trim() || !s.url?.trim()) {
      return `sources 第 ${i + 1} 条缺 title 或 url:每条来源都要有真实标题与可访问 URL。修正后重新调用。`;
    }
  }
  return null;
}

const CITATION_AUDIT_KEYS: Array<keyof CitationAudit> = [
  'conceptsAndDefinitions',
  'attributionAndEvolution',
  'dataAndState',
  'rulesAndEvidence',
];

/**
 * citationAudit 是模型写入前的结构化自查:它不能证明没有漏引,但能强迫模型把
 * 主线依赖的概念定义、归属演进、数据状态、规则证据逐类过一遍,避免只给零星 sources 点缀。
 */
export function validateCitationAudit(
  audit: CitationAudit | undefined,
  sources: DraftSource[] | undefined,
): string | null {
  const srcs = sources ?? [];
  if (srcs.length === 0) return null;
  if (!audit || typeof audit !== 'object') {
    return '缺少 citationAudit:本篇给了 sources,必须逐类列出已查证且支撑主线的概念定义、归属演进、数据状态、规则证据。没有某类内容可留空数组。';
  }

  let itemCount = 0;
  for (const key of CITATION_AUDIT_KEYS) {
    const items = audit[key] ?? [];
    if (!Array.isArray(items)) {
      return `citationAudit.${key} 必须是数组。`;
    }
    for (let i = 0; i < items.length; i++) {
      itemCount += 1;
      const item = items[i];
      const claim = typeof item?.claim === 'string' ? item.claim.trim() : '';
      if (!claim) {
        return `citationAudit.${key}[${i}].claim 不能为空:用一句话概括被查证的断言。`;
      }
      if (
        !Array.isArray(item.sourceIndexes) ||
        item.sourceIndexes.length === 0
      ) {
        return `citationAudit.${key}[${i}].sourceIndexes 不能为空:至少指向一条 sources 序号。`;
      }
      for (const sourceIndex of item.sourceIndexes) {
        if (
          !Number.isInteger(sourceIndex) ||
          sourceIndex < 1 ||
          sourceIndex > srcs.length
        ) {
          return `citationAudit.${key}[${i}].sourceIndexes 包含无效序号 ${sourceIndex}:sources 只有 ${srcs.length} 条。`;
        }
      }
    }
  }

  return itemCount > 0
    ? null
    : 'citationAudit 为空:本篇给了 sources,至少列出一个已查证断言;若没有任何需查证内容,不要传 sources。';
}

/**
 * 把模型产出的「正文 + sources」合成最终落库的 bodyMarkdown：
 *   1. 正文里的 [@#CIT N] → 可点链接 [N](url)，直达第 N 条来源
 *   2. 篇末据 sources 自动拼「来源」小节（正文不自己罗列链接，由系统统一生成保证格式一致）
 * 无来源时原样返回，不加任何节——纯思辨篇保持干净。
 * 设计：合成逻辑只此一处，门禁直写路径与 HITL 提交路径共用，杜绝两条路径行为分叉。
 */
export function composeAiDraftBody(
  markdown: string,
  sources: DraftSource[] | undefined,
): string {
  const srcs = sources ?? [];
  if (srcs.length === 0) return markdown;
  // [@#CIT 1,3-5] → 展开成各自可点的 [1](u1#cit-1 "title")。#cit-N 只供前端稳定命中 citation 样式。
  const linked = markdown.replace(CITATION_MARKER, (whole, refBody: string) => {
    const parts = parseCitationNumbers(refBody).map((n) => {
      const s = srcs[n - 1];
      if (!s) return String(n);
      const safeTitle = s.title.replace(/[\\"]/g, '');
      return `[${n}](${s.url}#cit-${n} "${safeTitle}")`;
    });
    return parts.length ? parts.join(',') : whole;
  });
  const list = srcs
    .map((s, i) => `${i + 1}. [${s.title}](${s.url})`)
    .join('\n');
  return `${linked}\n\n## 来源\n\n${list}`;
}

/**
 * @param editorDraftRepo  草稿仓库（aidraft 写入口）
 * @param noteContentItemId  当前学习节点的 contentItemId（上下文绑定，模型不传）
 */
export function createWriteDraftTool(
  editorDraftRepo: EditorDraftRepository,
  noteContentItemId: string,
) {
  return tool({
    // description 单一真源在 prompts/tool-descriptions.ts，组装层(tool.assembler)统一套用。
    // 此处留指针占位即可——assemble() 收尾会用文件内容覆盖它。
    description: '描述见 prompts/tool-descriptions.ts',
    inputSchema: jsonSchema<{
      markdown: string;
      changeSummary: string;
      sources?: DraftSource[];
      citationAudit?: CitationAudit;
    }>({
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description:
            '完整 markdown 正文（# 标题开头，包含所有章节内容，不要截断）。可证伪的事实句末就近标 [@#CIT N]。',
        },
        changeSummary: {
          type: 'string',
          description:
            '一句话说明这次写入做了什么、相比现有初稿改了什么（供用户审批时一眼看懂意图）。直接陈述，不加「本次/说明」之类前缀。',
        },
        sources: {
          type: 'array',
          description:
            '本篇引用的外部来源，按正文里 [@#CIT 1][@#CIT 2]… 的出现顺序排列；每条须是真经 web_search/web_fetch 取到过的内容。无可证伪事实可不给。',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '来源标题' },
              url: { type: 'string', description: '来源 URL（真实可访问）' },
            },
            required: ['title', 'url'],
          },
        },
        citationAudit: {
          type: 'object',
          description:
            '引用覆盖自查。有 sources 时必须提交。按四类列出正文中已经查证并标 CIT、且支撑主线的断言；没有某类内容传空数组。',
          properties: {
            conceptsAndDefinitions: {
              type: 'array',
              description:
                '概念与定义：本篇主线依赖的术语、理论、方法、模型、标准定义和边界。',
              items: {
                type: 'object',
                properties: {
                  claim: { type: 'string', description: '已查证断言摘要' },
                  sourceIndexes: {
                    type: 'array',
                    items: { type: 'number' },
                    description: '对应 sources 序号，1-based',
                  },
                },
                required: ['claim', 'sourceIndexes'],
              },
            },
            attributionAndEvolution: {
              type: 'array',
              description:
                '归属与演进：提出者、发布者、维护者、年份、版本、阶段顺序。',
              items: {
                type: 'object',
                properties: {
                  claim: { type: 'string', description: '已查证断言摘要' },
                  sourceIndexes: {
                    type: 'array',
                    items: { type: 'number' },
                    description: '对应 sources 序号，1-based',
                  },
                },
                required: ['claim', 'sourceIndexes'],
              },
            },
            dataAndState: {
              type: 'array',
              description:
                '数据与状态：数量、比例、参数、性能、价格、排名、当前状态。',
              items: {
                type: 'object',
                properties: {
                  claim: { type: 'string', description: '已查证断言摘要' },
                  sourceIndexes: {
                    type: 'array',
                    items: { type: 'number' },
                    description: '对应 sources 序号，1-based',
                  },
                },
                required: ['claim', 'sourceIndexes'],
              },
            },
            rulesAndEvidence: {
              type: 'array',
              description:
                '规则与证据：法规、政策、规范、官方文档要求、论文报告结论。',
              items: {
                type: 'object',
                properties: {
                  claim: { type: 'string', description: '已查证断言摘要' },
                  sourceIndexes: {
                    type: 'array',
                    items: { type: 'number' },
                    description: '对应 sources 序号，1-based',
                  },
                },
                required: ['claim', 'sourceIndexes'],
              },
            },
          },
        },
      },
      required: ['markdown', 'changeSummary'],
    }),
    // changeSummary 是审批用元信息,不参与落库(gate 暂存进 preview);execute 用 markdown + sources。
    execute: async ({
      markdown,
      sources,
      citationAudit,
    }: {
      markdown: string;
      changeSummary?: string;
      sources?: DraftSource[];
      citationAudit?: CitationAudit;
    }) => {
      try {
        // 直写路径也校验引用一致性,与门禁 validate 同一把关,行为不分叉。
        const citationErr = validateCitations(markdown, sources);
        if (citationErr) {
          return toolResult(`write_draft 校验未过：${citationErr}`, undefined, {
            status: 'error',
          });
        }
        const auditErr = validateCitationAudit(citationAudit, sources);
        if (auditErr) {
          return toolResult(`write_draft 校验未过：${auditErr}`, undefined, {
            status: 'error',
          });
        }
        const title = extractTitle(markdown);
        const summary = extractSummary(markdown);
        const bodyMarkdown = composeAiDraftBody(markdown, sources);

        // aidraft 前缀保证 commit/publish 路径天然看不见此草稿；对用户只读。
        await editorDraftRepo.saveAiDraft({
          contentItemId: noteContentItemId,
          bodyMarkdown,
          title,
          summary,
          changeNote: 'learn-draft',
          savedAt: new Date(),
        });

        return toolResult(
          `AI 初稿已写入（${bodyMarkdown.length} 字，${(sources ?? []).length} 源）`,
          undefined,
          { status: 'ok', charCount: bodyMarkdown.length },
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return toolResult(`write_draft 写入失败：${msg}`, undefined, {
          status: 'error',
        });
      }
    },
  });
}
