/**
 * agent.utils.ts — Agent 模块内共用的工具函数。
 */
import {
  generateText,
  NoSuchToolError,
  type LanguageModel,
  type ToolCallRepairFunction,
  type ToolSet,
} from 'ai';

/**
 * 工具调用修复(re-ask 策略,见 docs/AI SDK experimental_repairToolCall)。
 *
 * 现象:deepseek/通义偶尔吐出烂 JSON / 不合 schema 的工具调用,导致整轮 generateText/
 * streamText 崩(测试中见过 sub_agent「委派失败:Invalid JSON response」)。
 *
 * 修法:把"失败的工具调用 + 错误信息"回灌给同一个模型,让它重出一次正确的调用 ——
 * provider 无关(就是再走一遍普通 function calling),不依赖结构化输出特性
 * (deepseek json_schema 不稳、通义 thinking 模式不支持,都被我们排除了)。
 *
 * 工具名都错(NoSuchToolError)就不修,返回 null 让其走正常错误流程。
 */
export function makeRepairToolCall(
  model: LanguageModel,
): ToolCallRepairFunction<ToolSet> {
  return async ({ toolCall, tools, error, messages, system }) => {
    if (NoSuchToolError.isInstance(error)) return null;
    try {
      const { toolCalls } = await generateText({
        model,
        system,
        tools,
        maxRetries: 1,
        messages: [
          ...messages,
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                input: toolCall.input,
              },
            ],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId: toolCall.toolCallId,
                toolName: toolCall.toolName,
                output: {
                  type: 'error-text',
                  value: String(error?.message ?? error),
                },
              },
            ],
          },
        ],
      });
      // generateText 返回高层 ToolCall，repair 协议要底层 LanguageModelV3ToolCall 形状，
      // 运行期字段一致(toolCallId/toolName/input)，做一次受控断言。
      return (toolCalls.find((tc) => tc.toolName === toolCall.toolName) ??
        null) as Awaited<ReturnType<ToolCallRepairFunction<ToolSet>>>;
    } catch {
      return null;
    }
  };
}

/**
 * 整体重试一次:fn 抛错且未被中止时,先 onRetry(重置累积状态)再重跑一次。
 * 兜底 repairToolCall 修不到的 provider 级抽风(如响应体「Invalid JSON response」)。
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
