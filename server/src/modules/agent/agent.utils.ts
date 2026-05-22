/**
 * agent.utils.ts — Agent 模块内共用的工具函数。
 */

/**
 * AI SDK v6 兼容桥接：tool() 返回的对象使用 `parameters` 字段，
 * 但 streamText / generateText 内部读取 `inputSchema`，
 * 需手动保证两个字段都存在。
 */
export function bridgeToolSchemas(
  rawTools: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(rawTools).map(([name, t]) => [
      name,

      {
        ...(t as object),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        inputSchema: (t as any).parameters ?? (t as any).inputSchema,
      },
    ]),
  );
}
