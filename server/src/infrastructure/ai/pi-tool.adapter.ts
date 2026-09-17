import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { TSchema } from 'typebox';

interface AiSdkSchema {
  jsonSchema?: Record<string, unknown>;
}

interface AiSdkTool {
  description?: string;
  inputSchema?: AiSdkSchema | Record<string, unknown>;
  parameters?: AiSdkSchema | Record<string, unknown>;
  execute?: (
    input: unknown,
    options: {
      toolCallId: string;
      messages: unknown[];
      abortSignal?: AbortSignal;
    },
  ) => unknown;
}

export interface PiToolDetails {
  output: unknown;
}

/**
 * 复用现有 AI SDK 工具定义，只在 agent runtime 边界转换为 Pi AgentTool。
 * 业务工具、审批门禁和参数 Schema 保持单一真源。
 */
export function adaptToolsForPi(
  tools: Record<string, unknown>,
): AgentTool<TSchema, PiToolDetails>[] {
  return Object.entries(tools).map(([name, value]) => {
    const source = value as AiSdkTool;
    const parameters = readJsonSchema(source, name);
    if (!source.execute) {
      throw new Error(`工具 ${name} 缺少 execute，不能交给 Pi 执行`);
    }

    return {
      name,
      label: name,
      description: source.description ?? '',
      parameters,
      async execute(toolCallId, params, signal) {
        if (signal?.aborted) throw new Error('Operation aborted');
        const output = await source.execute!(params, {
          toolCallId,
          messages: [],
          abortSignal: signal,
        });
        return {
          content: [{ type: 'text', text: serializeToolOutput(output) }],
          details: { output },
        };
      },
    };
  });
}

function readJsonSchema(tool: AiSdkTool, name: string): TSchema {
  const candidate = tool.inputSchema ?? tool.parameters;
  if (!candidate || typeof candidate !== 'object') {
    throw new Error(`工具 ${name} 缺少 inputSchema`);
  }
  if ('jsonSchema' in candidate && candidate.jsonSchema) {
    return candidate.jsonSchema;
  }
  return candidate;
}

function serializeToolOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined) return '';
  if (output === null) return 'null';
  if (
    typeof output === 'number' ||
    typeof output === 'boolean' ||
    typeof output === 'bigint'
  ) {
    return String(output);
  }
  if (typeof output === 'symbol') return output.description ?? 'symbol';
  try {
    return JSON.stringify(output) ?? '[unserializable tool output]';
  } catch {
    return '[unserializable tool output]';
  }
}
