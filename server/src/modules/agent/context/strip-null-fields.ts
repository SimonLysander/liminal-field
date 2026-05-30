/**
 * stripNullFields — 深度剔除对象里值为 null 的键(递归数组/对象)。
 *
 * 背景(踩坑):AI SDK `toUIMessageStreamResponse` 的 onFinish 给出的 UIMessage 带大量
 * 显式 null 字段(metadata/providerMetadata/errorText/title/rawInput/providerExecuted…)。
 * 这些消息持久化进 MongoDB 后 null 被原样保留;下一轮读历史喂 convertToModelMessages 时,
 * AI SDK 的 UIMessage zod schema 用 `.optional()`(只接受 undefined,**拒绝 null**),
 * 于是抛 "messages do not match the ModelMessage[] schema",**每个多轮会话 turn 2 必崩**。
 *
 * 旧架构没踩到:旧路径消息走 HTTP JSON(undefined 字段被 JSON.stringify 省略),
 * 等价于无该字段。本工具把 null 键剔除,效果对齐"字段不存在",让 schema 校验通过。
 *
 * 读侧(喂模型前)修复存量脏数据 + incoming;写侧(持久化前)保持新数据干净。
 * 只剔除 null;保留 ''/0/false 等有意义的假值。
 */
export function stripNullFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return (value as unknown[]).map((item) =>
      stripNullFields(item),
    ) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (val === null) continue;
      out[key] = stripNullFields(val);
    }
    return out as T;
  }
  return value;
}
