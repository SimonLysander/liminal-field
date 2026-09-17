import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type {
  AssistantMessage,
  Model,
  ToolResultMessage,
} from '@earendil-works/pi-ai';

const EMPTY_USAGE: AssistantMessage['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** 将后端持久化的 AI SDK UIMessage 历史转换为 Pi transcript。 */
export function uiMessagesToPi(
  messages: Record<string, unknown>[],
  model: Model<'openai-responses'>,
): AgentMessage[] {
  return messages.flatMap((message) => convertMessage(message, model));
}

/** 从 useChat 本轮 UIMessage 提取用户可见文本。 */
export function readUserText(message: Record<string, unknown>): string {
  const parts = Array.isArray(message.parts)
    ? (message.parts as Array<Record<string, unknown>>)
    : [];
  return parts
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n');
}

function convertMessage(
  message: Record<string, unknown>,
  model: Model<'openai-responses'>,
): AgentMessage[] {
  const role = message.role;
  const timestamp = readTimestamp(message);
  if (role === 'user') {
    const text = readUserText(message);
    return text ? [{ role: 'user', content: text, timestamp }] : [];
  }
  if (role !== 'assistant') return [];

  const parts = Array.isArray(message.parts)
    ? (message.parts as Array<Record<string, unknown>>)
    : [];
  const content: AssistantMessage['content'] = [];
  const results: ToolResultMessage[] = [];

  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string' && part.text) {
      content.push({ type: 'text', text: part.text });
      continue;
    }
    const tool = readToolPart(part);
    if (!tool) continue;
    content.push({
      type: 'toolCall',
      id: tool.toolCallId,
      name: tool.toolName,
      arguments: tool.input,
    });
    if (tool.state === 'output-available') {
      results.push({
        role: 'toolResult',
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        content: [{ type: 'text', text: serialize(tool.output) }],
        details: { output: tool.output },
        isError: false,
        timestamp,
      });
    } else if (tool.state === 'output-error') {
      results.push({
        role: 'toolResult',
        toolCallId: tool.toolCallId,
        toolName: tool.toolName,
        content: [
          {
            type: 'text',
            text:
              typeof tool.errorText === 'string'
                ? tool.errorText
                : '工具执行失败',
          },
        ],
        details: {},
        isError: true,
        timestamp,
      });
    }
  }

  if (content.length === 0) return [];
  const assistant: AssistantMessage = {
    role: 'assistant',
    content,
    api: 'openai-responses',
    provider: model.provider,
    model: model.id,
    usage: EMPTY_USAGE,
    stopReason: results.length > 0 ? 'toolUse' : 'stop',
    timestamp,
  };
  return [assistant, ...results];
}

function readToolPart(part: Record<string, unknown>): null | {
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
  state: unknown;
  output: unknown;
  errorText: unknown;
} {
  const type = typeof part.type === 'string' ? part.type : '';
  if (!type.startsWith('tool-') && type !== 'dynamic-tool') return null;
  const toolName =
    type === 'dynamic-tool' && typeof part.toolName === 'string'
      ? part.toolName
      : type.slice('tool-'.length);
  if (!toolName || typeof part.toolCallId !== 'string') return null;
  const input =
    part.input && typeof part.input === 'object' && !Array.isArray(part.input)
      ? (part.input as Record<string, unknown>)
      : {};
  return {
    toolName,
    toolCallId: part.toolCallId,
    input,
    state: part.state,
    output: part.output,
    errorText: part.errorText,
  };
}

function readTimestamp(message: Record<string, unknown>): number {
  const createdAt = message.createdAt;
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === 'string' || typeof createdAt === 'number') {
    const parsed = new Date(createdAt).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function serialize(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  if (value === null) return 'null';
  try {
    return JSON.stringify(value) ?? '[unserializable tool output]';
  } catch {
    return '[unserializable tool output]';
  }
}
