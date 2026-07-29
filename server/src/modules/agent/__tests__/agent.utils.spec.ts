import { generateText } from 'ai';
import { makeRepairToolCall } from '../agent.utils';

jest.mock('ai', () => {
  const actual = jest.requireActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateText: jest.fn(),
  };
});

const mockGenerateText = generateText as jest.MockedFunction<
  typeof generateText
>;

describe('makeRepairToolCall', () => {
  beforeEach(() => {
    mockGenerateText.mockReset();
  });

  it('把高层对象参数序列化为底层协议要求的 JSON 字符串', async () => {
    mockGenerateText.mockResolvedValue({
      toolCalls: [
        {
          type: 'tool-call',
          toolCallId: 'repair-call',
          toolName: 'write_learn_plan',
          input: { goal: '理解波动率', changeSummary: '按因果关系组织篇目' },
        },
      ],
    } as never);

    const repair = makeRepairToolCall({} as never);
    const result = await repair({
      toolCall: {
        type: 'tool-call',
        toolCallId: 'original-call',
        toolName: 'write_learn_plan',
        input: '{}',
      },
      tools: {
        write_learn_plan: {
          description: '学习规划',
          inputSchema: { type: 'object' },
          execute: jest.fn(),
        },
      } as never,
      error: new Error('changeSummary 不能为空') as never,
      messages: [],
      system: 'system',
      inputSchema: jest.fn(),
    });

    expect(result).toEqual({
      type: 'tool-call',
      toolCallId: 'original-call',
      toolName: 'write_learn_plan',
      input: JSON.stringify({
        goal: '理解波动率',
        changeSummary: '按因果关系组织篇目',
      }),
    });

    const repairRequest = mockGenerateText.mock.calls[0]?.[0];
    // 通义等 thinking model 不支持强制 tool_choice；只暴露目标工具即可。
    expect(repairRequest?.toolChoice).toBeUndefined();
    expect(
      (
        repairRequest?.tools?.write_learn_plan as {
          execute?: unknown;
        }
      ).execute,
    ).toBeUndefined();
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it('回灌时把合法 JSON 原参数还原成对象', async () => {
    mockGenerateText.mockResolvedValue({ toolCalls: [] } as never);

    const repair = makeRepairToolCall({} as never);
    await repair({
      toolCall: {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'write_learn_plan',
        input: '{"goal":"理解波动率"}',
      },
      tools: {
        write_learn_plan: {
          description: '学习规划',
          inputSchema: { type: 'object' },
        },
      } as never,
      error: new Error('参数不完整') as never,
      messages: [],
      system: 'system',
      inputSchema: jest.fn(),
    });

    const repairRequest = mockGenerateText.mock.calls[0]?.[0];
    const appendedAssistant = repairRequest?.messages?.at(-2) as {
      content: Array<{ input: unknown }>;
    };
    expect(appendedAssistant.content[0]?.input).toEqual({
      goal: '理解波动率',
    });
  });

  it('thinking provider 已返回 JSON 字符串时不重复序列化', async () => {
    const repairedInput = JSON.stringify({
      goal: '理解波动率',
      changeSummary: '按因果关系组织篇目',
    });
    mockGenerateText.mockResolvedValue({
      toolCalls: [
        {
          type: 'tool-call',
          toolCallId: 'repair-call',
          toolName: 'write_learn_plan',
          input: repairedInput,
        },
      ],
    } as never);

    const repair = makeRepairToolCall({} as never);
    const result = await repair({
      toolCall: {
        type: 'tool-call',
        toolCallId: 'original-call',
        toolName: 'write_learn_plan',
        input: '{}',
      },
      tools: {
        write_learn_plan: {
          description: '学习规划',
          inputSchema: { type: 'object' },
        },
      } as never,
      error: new Error('参数不完整') as never,
      messages: [],
      system: 'system',
      inputSchema: jest.fn(),
    });

    expect(result?.input).toBe(repairedInput);
  });
});
