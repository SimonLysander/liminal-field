/**
 * ToolResult — 所有 agent 工具的统一返回契约(见 docs/agent-tools-redesign.md)。
 *
 * 工具 execute 一律 `return toolResult(summary, detail?, meta?)`(JSON 字符串):
 * - summary:一行人类可读 —— 前端直接显示;也给模型一个 TL;DR。
 * - detail :给模型的主体内容(正文 / 命中列表 / 结论…),纯文本;前端不渲染。
 * - meta   :结构化信号(status / total / hasMore / nextOffset / 工具特定字段)。
 *
 * 边角铁律:不静默丢(hasMore+nextOffset)、不静默失败(status:not_found)、
 * 歧义不瞎猜(status:ambiguous)、不完整要标记(status:partial)、不泄漏内部 ID(放 meta)。
 */
export type ToolStatus =
  | 'ok'
  | 'partial'
  | 'not_found'
  | 'ambiguous'
  | 'error'
  | 'timeout'
  | 'invalid'; // 输入结构校验失败(如空 edits)

export interface ToolResultMeta {
  status?: ToolStatus;
  /** 命中 / 条目总数 */
  total?: number;
  /** 本次返回多少(条 / 字符) */
  shown?: number;
  /** 是否还有更多 */
  hasMore?: boolean;
  /** 续取偏移 */
  nextOffset?: number;
  /** 结果反馈:行内 summary 之外、值得让用户看到的那点结果(search 命中篇目 / list 类型构成);
   *  前端 NestedList 渲染(⎿ 缩进、截 5 + "还有 N 个")。碰单个东西的工具(read 等)不用。 */
  list?: string[];
  /** 工具特定字段(taskId、byScope、stepsUsed…) */
  [k: string]: unknown;
}

export interface ToolResult {
  summary: string;
  detail?: string;
  meta?: ToolResultMeta;
}

/** 构造统一返回(JSON 字符串)。 */
export function toolResult(
  summary: string,
  detail?: string,
  meta?: ToolResultMeta,
): string {
  const r: ToolResult = { summary };
  if (detail != null && detail !== '') r.detail = detail;
  if (meta != null) r.meta = meta;
  return JSON.stringify(r);
}
