/**
 * agent.utils.ts — Agent 模块内共用的工具函数。
 */
export function readToolResultRecord(
  output: unknown,
  depth = 0,
): Record<string, unknown> | undefined {
  if (depth > 2) return undefined;
  try {
    const parsed: unknown =
      typeof output === 'string' ? JSON.parse(output) : output;
    if (parsed == null || typeof parsed !== 'object') return undefined;
    const wrapped = parsed as Record<string, unknown>;
    if (wrapped['type'] === 'text' || wrapped['type'] === 'json') {
      return readToolResultRecord(wrapped['value'], depth + 1);
    }
    return wrapped;
  } catch {
    return undefined;
  }
}

export function readToolResultStatus(output: unknown): string | undefined {
  const result = readToolResultRecord(output);
  const meta = result?.['meta'];
  if (meta == null || typeof meta !== 'object') return undefined;
  const status = (meta as Record<string, unknown>)['status'];
  return typeof status === 'string' ? status : undefined;
}

/** Pi 运行时版本的同工具连续无效判断；每个 Set 表示一轮中的无效工具名。 */
export function hasRepeatedInvalidToolNames(
  turns: ReadonlyArray<ReadonlySet<string>>,
  limit: number,
): boolean {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('limit 必须是正整数');
  }
  if (turns.length < limit) return false;
  let repeated = new Set(turns[turns.length - 1]);
  for (const names of turns.slice(-limit, -1)) {
    repeated = new Set([...repeated].filter((name) => names.has(name)));
    if (repeated.size === 0) return false;
  }
  return repeated.size > 0;
}

/**
 * 整体重试一次:fn 抛错且未被中止时,先 onRetry(重置累积状态)再重跑一次。
 * 兜底 provider 请求级故障（如响应体无法解析）；工具参数错误由 ReAct 循环自行处理。
 */
export async function retryOnce<T>(
  fn: () => Promise<T>,
  opts: { onRetry: () => void; aborted: () => boolean },
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (opts.aborted()) throw err;
    opts.onRetry();
    return await fn();
  }
}

/**
 * 从 LLM 文本响应中提取 JSON。纯函数,便于单测——提取失败会让调用链崩。
 * 兼容:纯 JSON、```json 代码块、花括号截取。
 *
 * 部分 Responses provider 不支持 structured outputs(json_schema)，因此让模型输出
 * JSON 文本后在应用层解析。memory-agent / digest-compose 共用此函数。
 */
export function extractJSON<T>(text: string): T {
  // 尝试直接解析
  try {
    return JSON.parse(text) as T;
  } catch {
    // 不是纯 JSON
  }
  // 尝试从 ```json ... ``` 代码块中提取
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    return JSON.parse(codeBlockMatch[1]) as T;
  }
  // 尝试找到第一个 { 和最后一个 } 之间的内容
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as T;
  }
  throw new Error('LLM 响应中未找到有效 JSON');
}
