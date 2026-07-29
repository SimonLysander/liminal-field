/**
 * agent.utils.ts — Agent 模块内共用的工具函数。
 */
import { InvalidToolInputError, type StopCondition, type ToolSet } from 'ai';

function readToolResultStatus(output: unknown): string | undefined {
  try {
    const parsed: unknown =
      typeof output === 'string' ? JSON.parse(output) : output;
    if (parsed == null || typeof parsed !== 'object') return undefined;
    const wrapped = parsed as Record<string, unknown>;
    if (wrapped['type'] === 'text' || wrapped['type'] === 'json') {
      return readToolResultStatus(wrapped['value']);
    }
    const meta = wrapped['meta'];
    if (meta == null || typeof meta !== 'object') return undefined;
    const status = (meta as Record<string, unknown>)['status'];
    return typeof status === 'string' ? status : undefined;
  } catch {
    return undefined;
  }
}

function invalidToolNames(
  content: ReadonlyArray<unknown>,
): ReadonlySet<string> {
  const names = new Set<string>();
  for (const value of content) {
    if (value == null || typeof value !== 'object') continue;
    const part = value as Record<string, unknown>;
    const toolName =
      typeof part['toolName'] === 'string' ? part['toolName'] : undefined;
    if (!toolName) continue;
    if (
      (part['type'] === 'tool-error' &&
        InvalidToolInputError.isInstance(part['error'])) ||
      (part['type'] === 'tool-result' &&
        readToolResultStatus(part['output']) === 'invalid')
    ) {
      names.add(toolName);
    }
  }
  return names;
}

/**
 * 同一工具连续返回无效输入时停止 ReAct 循环。
 *
 * AI SDK 已把坏 JSON 作为 tool-error 回灌给当前主模型；业务校验失败则返回
 * ToolResult(status=invalid)。允许模型在下一步自行纠正，但不启动隐藏模型调用，
 * 也不允许同一错误跑满整个 step budget。
 */
export function consecutiveInvalidToolCallsIs<TOOLS extends ToolSet = ToolSet>(
  limit: number,
): StopCondition<TOOLS> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('limit 必须是正整数');
  }

  return ({ steps }) => {
    if (steps.length < limit) return false;
    let repeatedNames: ReadonlySet<string> | undefined;
    for (const step of steps.slice(-limit).reverse()) {
      const currentNames = invalidToolNames(step.content);
      if (currentNames.size === 0) return false;
      repeatedNames =
        repeatedNames == null
          ? currentNames
          : new Set(
              [...repeatedNames].filter((name) => currentNames.has(name)),
            );
      if (repeatedNames.size === 0) return false;
    }
    return true;
  };
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
 * 为什么要它:DeepSeek 等 OpenAI-compatible provider 不支持 structured outputs
 * (json_schema),只能用 generateText 让模型吐 JSON 文本再手动解析。generateObject
 * 走 json_schema 路径,撞上这类 provider 会直接崩(No object generated)。
 * memory-agent / digest-compose 都靠这个函数兜住模型输出。
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
