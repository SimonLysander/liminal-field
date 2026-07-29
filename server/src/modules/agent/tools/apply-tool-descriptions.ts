import { TOOL_DESCRIPTIONS } from '../../../prompts/tool-descriptions';

/**
 * 工具描述以 prompts/tool-descriptions.ts 为唯一真源。
 * 主、子智能体都经这里覆盖工厂占位描述，避免不同装配入口产生能力认知偏差。
 */
export function applyToolDescriptions<T extends Record<string, unknown>>(
  tools: T,
): T {
  for (const [name, tool] of Object.entries(tools)) {
    const description = TOOL_DESCRIPTIONS[name];
    if (description && tool && typeof tool === 'object') {
      (tool as { description?: string }).description = description;
    }
  }
  return tools;
}
