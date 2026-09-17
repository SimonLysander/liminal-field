import { readUserText, uiMessagesToPi } from '../pi-message.adapter';

const model = {
  id: 'gpt-test',
  name: 'gpt-test',
  api: 'openai-responses' as const,
  provider: 'test',
  baseUrl: 'https://example.test/v1',
  reasoning: false,
  input: ['text' as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 32000,
  maxTokens: 4096,
};

describe('pi-message.adapter', () => {
  it('按顺序拼接用户消息的多个文本 part', () => {
    expect(
      readUserText({
        role: 'user',
        parts: [
          { type: 'text', text: '第一段' },
          { type: 'file', url: 'ignored' },
          { type: 'text', text: '第二段' },
        ],
      }),
    ).toBe('第一段\n第二段');
  });

  it('把 assistant 工具调用和结果还原成相邻的 Pi 消息', () => {
    const converted = uiMessagesToPi(
      [
        { role: 'user', parts: [{ type: 'text', text: '查一下' }] },
        {
          role: 'assistant',
          parts: [
            { type: 'text', text: '正在查询。' },
            {
              type: 'tool-web_search',
              toolCallId: 'call-1',
              state: 'output-available',
              input: { query: 'Pi' },
              output: '{"summary":"1 条"}',
            },
          ],
        },
      ],
      model,
    );

    expect(converted.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
    ]);
    expect(converted[1]).toMatchObject({
      role: 'assistant',
      content: expect.arrayContaining([
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'web_search',
          arguments: { query: 'Pi' },
        },
      ]),
    });
    expect(converted[2]).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call-1',
      isError: false,
    });
  });

  it('把工具后的尾部文本前移，避免 Responses 将调用与输出拆开', () => {
    const converted = uiMessagesToPi(
      [
        {
          role: 'assistant',
          parts: [
            { type: 'text', text: '先检查。' },
            {
              type: 'tool-write_draft',
              toolCallId: 'call-1',
              state: 'output-available',
              input: { markdown: '# 标题' },
              output: { status: 'pending_approval' },
            },
            { type: 'text', text: '等待审批。' },
          ],
        },
      ],
      model,
    );

    expect(converted).toHaveLength(2);
    expect(converted[0]).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: '先检查。' },
        { type: 'text', text: '等待审批。' },
        {
          type: 'toolCall',
          id: 'call-1',
          name: 'write_draft',
        },
      ],
    });
    expect(converted[1]).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call-1',
    });
  });
});
