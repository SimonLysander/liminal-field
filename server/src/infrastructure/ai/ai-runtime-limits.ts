/**
 * AI 运行时的统一保护边界。
 *
 * 这些值只用于防止上游永久挂起或模型陷入无限工具循环，不应成为正常任务的
 * 产品级配额。部署环境可按供应商能力覆盖，默认值刻意留出足够余量。
 */
function positiveIntegerFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const AI_RUNTIME_LIMITS = {
  /** 单次 Responses 请求最长 15 分钟。 */
  providerRequestTimeoutMs: positiveIntegerFromEnv(
    'AI_REQUEST_TIMEOUT_MS',
    15 * 60_000,
  ),
  /** 只重试 408/409/429/5xx 和网络错误，不整轮重跑已经执行过的工具。 */
  providerMaxRetries: positiveIntegerFromEnv('AI_MAX_RETRIES', 4),
  /** 接受供应商最长 5 分钟的 Retry-After，避免短限流被立即转成失败。 */
  providerMaxRetryDelayMs: positiveIntegerFromEnv(
    'AI_MAX_RETRY_DELAY_MS',
    5 * 60_000,
  ),
  /** 模型目录缺少输出上限时采用的宽松上界，仍会受上下文窗口约束。 */
  maxOutputTokens: positiveIntegerFromEnv('AI_MAX_OUTPUT_TOKENS', 128 * 1024),
  /** 主 Agent 的故障保护上限；正常任务应在此之前自然结束。 */
  mainAgentMaxTurns: positiveIntegerFromEnv('AGENT_MAX_TURNS', 50),
  /** 子 Agent 默认研究深度以及允许模型请求的最大深度。 */
  subAgentDefaultSteps: positiveIntegerFromEnv('SUB_AGENT_DEFAULT_STEPS', 30),
  subAgentMaxSteps: positiveIntegerFromEnv('SUB_AGENT_MAX_STEPS', 60),
  /** 子 Agent 整体最长运行 20 分钟，父运行取消仍会立即向下传播。 */
  subAgentTimeoutMs: positiveIntegerFromEnv(
    'SUB_AGENT_TIMEOUT_MS',
    20 * 60_000,
  ),
  /** 行内编辑允许较慢推理模型完成，不再固定 60 秒截断。 */
  inlineAssistTimeoutMs: positiveIntegerFromEnv(
    'INLINE_ASSIST_TIMEOUT_MS',
    5 * 60_000,
  ),
} as const;

export function resolveModelMaxTokens(contextWindow: number): number {
  return Math.max(
    16,
    Math.min(AI_RUNTIME_LIMITS.maxOutputTokens, contextWindow),
  );
}

export function resolveSubAgentSteps(requested?: number): number {
  const value =
    requested === undefined
      ? AI_RUNTIME_LIMITS.subAgentDefaultSteps
      : Math.floor(requested);
  return Math.max(1, Math.min(AI_RUNTIME_LIMITS.subAgentMaxSteps, value));
}
