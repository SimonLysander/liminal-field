/**
 * sanitizeAbortedToolCalls — 给「用户中止留下的半截工具调用」补上 output-error 占位结果。
 *
 * 背景（踩过的坑）：
 * AI SDK 在 useChat 流式接收时，UIMessage.parts 上的 tool 部件按 state 演进：
 *   input-streaming → input-available → output-available（或 output-error）。
 * 用户按「停止」时 AbortSignal 把流截掉，已经下发的 tool_call 通常停在
 * input-available（input 已全、tool 还没执行），偶尔停在 input-streaming（input 都没完）。
 *
 * 这种「半截 tool 调用」会被前端 saveSession 落进 DB。再开一轮时，
 * convertToLanguageModelPrompt 把它转成 OpenAI 协议的 assistant.tool_calls，
 * 但找不到配对的 tool message → 抛 AI_MissingToolResultsError，整轮死锁。
 * 用户看到「出错了：Tool result is missing for tool call call_xxx」，会话无法继续。
 *
 * 修复策略（不删原文 + 给模型留上下文）：
 * 把半截部件的 state 改成 output-error 并补一段 errorText，告诉模型「上次这个工具被中止了」。
 * 这样：
 *   1. 协议合法 —— tool_call 配对了 tool_result（errorText 作为 result.output）
 *   2. 模型有上下文 —— 看到「中止了」会自然 acknowledge 而不是再傻乎乎重发
 *   3. 不丢部件 —— toolCallId / input 都保留，便于排查
 *
 * 应用位置：streamText 调用前给 convertToModelMessages 的输入消毒（agent.service.ts）。
 *
 * 为什么不用 AI SDK 内建的 { ignoreIncompleteToolCalls: true }：
 * 那个选项是把半截部件「整个过滤掉」，会让原本只有 tool_call 的 assistant 消息变成空内容，
 * 某些 provider（OpenAI 协议变体）对空 assistant.content 不友好；而且模型完全失去了
 * 「我刚才试过这个工具」的上下文，下一轮可能重蹈覆辙。补 output-error 更稳。
 */

/** 半截状态：input 阶段中断（无 output / errorText），convertToModelMessages 会只生成 tool_call。 */
const INCOMPLETE_TOOL_STATES = new Set(['input-streaming', 'input-available']);

/** 给模型看的 errorText —— 中文，简短，明确归因（用户主动中止 vs 系统报错）。 */
const ABORT_ERROR_TEXT =
  '工具调用被用户中止（暂停按钮按下），未执行也无返回结果。';

/**
 * 扫描所有 assistant 消息，把 state 为 input-streaming / input-available 的 tool 部件
 * 改成 output-error，附 errorText。其它部件原样保留，返回新数组（不修改入参）。
 *
 * @param messages UIMessage[]（透过来的 dto.messages，结构上是 Record<string, unknown>[]）
 */
export function sanitizeAbortedToolCalls<T extends Record<string, unknown>>(
  messages: T[],
): T[] {
  return messages.map((msg) => {
    if ((msg.role as string) !== 'assistant') return msg;

    const parts = msg.parts as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(parts) || parts.length === 0) return msg;

    let mutated = false;
    const newParts = parts.map((part) => {
      const type = part.type as string | undefined;
      // tool 部件类型形如 "tool-write_memory"，动态工具是 "dynamic-tool"，两者都覆盖
      const isToolPart =
        typeof type === 'string' &&
        (type.startsWith('tool-') || type === 'dynamic-tool');
      if (!isToolPart) return part;

      const state = part.state as string | undefined;
      if (!state || !INCOMPLETE_TOOL_STATES.has(state)) return part;

      mutated = true;
      // output-error 形状要求 errorText 必填、output 不存在；input 保留以让模型回顾它当时给了什么
      return {
        ...part,
        state: 'output-error',
        errorText: ABORT_ERROR_TEXT,
      };
    });

    if (!mutated) return msg;
    return { ...msg, parts: newParts };
  });
}
