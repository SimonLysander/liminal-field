import { Logger } from '@nestjs/common';
import { pipePiAgentToUi } from '../pi-ui-stream.adapter';

describe('pipePiAgentToUi', () => {
  it('把文本和工具生命周期转换成既有 UIMessage chunks', async () => {
    let listener: ((event: any) => void | Promise<void>) | undefined;
    const agent = {
      subscribe: jest.fn((value) => {
        listener = value;
        return jest.fn();
      }),
    } as never;
    const write = jest.fn();
    const writer = { write } as never;
    pipePiAgentToUi(agent, writer, new Logger('test'));

    await listener?.({ type: 'agent_start' });
    await listener?.({ type: 'turn_start' });
    await listener?.({
      type: 'message_update',
      message: {},
      assistantMessageEvent: {
        type: 'text_start',
        contentIndex: 0,
        partial: {},
      },
    });
    await listener?.({
      type: 'message_update',
      message: {},
      assistantMessageEvent: {
        type: 'text_delta',
        contentIndex: 0,
        delta: '正文',
        partial: {},
      },
    });
    await listener?.({
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'search',
      args: { query: 'x' },
    });
    await listener?.({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'search',
      result: {
        content: [{ type: 'text', text: 'fallback' }],
        details: { output: { summary: '完成' } },
      },
      isError: false,
    });

    expect(write).toHaveBeenCalledWith({ type: 'start' });
    expect(write).toHaveBeenCalledWith({ type: 'start-step' });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'text-delta', delta: '正文' }),
    );
    expect(write).toHaveBeenCalledWith({
      type: 'tool-input-available',
      toolCallId: 'call-1',
      toolName: 'search',
      input: { query: 'x' },
    });
    expect(write).toHaveBeenCalledWith({
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: { summary: '完成' },
    });
  });

  it('把没有 message_update 的模型终止错误写入 UI stream', async () => {
    let listener: ((event: any) => void | Promise<void>) | undefined;
    const agent = {
      subscribe: jest.fn((value) => {
        listener = value;
        return jest.fn();
      }),
    } as never;
    const write = jest.fn();

    pipePiAgentToUi(
      agent,
      { write } as never,
      {
        error: jest.fn(),
      } as never,
    );

    await listener?.({ type: 'turn_start' });
    await listener?.({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'No tool output found',
      },
    });

    expect(write).toHaveBeenCalledWith({
      type: 'error',
      errorText: 'No tool output found',
    });
  });
});
