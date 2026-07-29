import { jsonrepair } from 'jsonrepair';

const MAX_REPAIRABLE_INPUT_LENGTH = 250_000;

/**
 * 仅修复模型工具参数的 JSON 语法，不推断字段、不改变工具 Schema。
 *
 * 工具参数中偶尔会出现未转义引号等机械错误。让主模型重新生成整份长文既昂贵，
 * 也容易退化为空参数；这里在 AI SDK 的 repairToolCall 钩子中本地修复，随后仍由
 * SDK 使用原工具 Schema 重新校验。合法 JSON、过长输入和无法确定修复的输入均跳过。
 */
export function repairMalformedToolInput(input: string): string | undefined {
  if (!input || input.length > MAX_REPAIRABLE_INPUT_LENGTH) return undefined;

  try {
    JSON.parse(input);
    return undefined;
  } catch {
    // 只有语法无效的 JSON 才进入修复，避免触碰合法但字段不完整的工具调用。
  }

  try {
    const repaired = jsonrepair(input);
    if (repaired === input) return undefined;
    JSON.parse(repaired);
    return repaired;
  } catch {
    return undefined;
  }
}
