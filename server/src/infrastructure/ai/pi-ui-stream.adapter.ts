import type { Logger } from '@nestjs/common';
import type { Agent, AgentEvent } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { UIMessage, UIMessageStreamWriter } from 'ai';
import { readPiToolOutput, readPiToolResultText } from './pi-tool-result';

/** 把 Pi 的生命周期事件转换成现有 useChat 能直接消费的 UIMessage stream。 */
export function pipePiAgentToUi(
  agent: Agent,
  writer: UIMessageStreamWriter<UIMessage>,
  logger: Logger,
): () => void {
  let turn = 0;
  const contentIds = new Map<string, string>();

  return agent.subscribe((event) => {
    switch (event.type) {
      case 'agent_start':
        writer.write({ type: 'start' });
        break;
      case 'turn_start':
        turn += 1;
        writer.write({ type: 'start-step' });
        break;
      case 'turn_end':
        writer.write({ type: 'finish-step' });
        break;
      case 'message_update':
        writeAssistantUpdate(event, writer, contentIds, turn, logger);
        break;
      case 'tool_execution_start':
        writer.write({
          type: 'tool-input-available',
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.args,
        });
        break;
      case 'tool_execution_update':
        writer.write({
          type: 'tool-output-available',
          toolCallId: event.toolCallId,
          output: readPiToolOutput(event.partialResult),
          preliminary: true,
        });
        break;
      case 'tool_execution_end':
        if (event.isError) {
          writer.write({
            type: 'tool-output-error',
            toolCallId: event.toolCallId,
            errorText: readPiToolResultText(event.result) || '工具执行失败',
          });
        } else {
          writer.write({
            type: 'tool-output-available',
            toolCallId: event.toolCallId,
            output: readPiToolOutput(event.result),
          });
        }
        break;
      case 'agent_end': {
        const lastAssistant = [...event.messages]
          .reverse()
          .find(
            (message): message is AssistantMessage =>
              message.role === 'assistant',
          );
        writer.write({
          type: 'finish',
          finishReason: mapFinishReason(lastAssistant?.stopReason),
        });
        break;
      }
      case 'message_start':
      case 'message_end':
        break;
    }
  });
}

function writeAssistantUpdate(
  event: Extract<AgentEvent, { type: 'message_update' }>,
  writer: UIMessageStreamWriter<UIMessage>,
  contentIds: Map<string, string>,
  turn: number,
  logger: Logger,
): void {
  const update = event.assistantMessageEvent;
  if (!('contentIndex' in update)) {
    if (update.type === 'error') {
      const message = update.error.errorMessage || '模型响应失败';
      logger.error(`Pi Responses 流错误: ${message}`);
      writer.write({ type: 'error', errorText: message });
    }
    return;
  }

  const key = `${turn}:${update.contentIndex}`;
  const id = contentIds.get(key) ?? `pi-${turn}-${update.contentIndex}`;
  contentIds.set(key, id);
  switch (update.type) {
    case 'text_start':
      writer.write({ type: 'text-start', id });
      break;
    case 'text_delta':
      writer.write({ type: 'text-delta', id, delta: update.delta });
      break;
    case 'text_end':
      writer.write({ type: 'text-end', id });
      break;
    case 'thinking_start':
      writer.write({ type: 'reasoning-start', id });
      break;
    case 'thinking_delta':
      writer.write({ type: 'reasoning-delta', id, delta: update.delta });
      break;
    case 'thinking_end':
      writer.write({ type: 'reasoning-end', id });
      break;
    case 'toolcall_start':
    case 'toolcall_delta':
    case 'toolcall_end':
      // 工具参数在 tool_execution_start 时一次性下发，避免把半截 JSON 暴露给 UI。
      break;
  }
}

function mapFinishReason(
  reason: AssistantMessage['stopReason'] | undefined,
): 'stop' | 'length' | 'error' | 'tool-calls' | 'other' {
  if (reason === 'length') return 'length';
  if (reason === 'error') return 'error';
  if (reason === 'toolUse') return 'tool-calls';
  if (reason === 'stop') return 'stop';
  return 'other';
}
