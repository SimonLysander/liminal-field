import { dropContentlessMessages } from '../drop-contentless-messages';
import { pruneFailedToolTurns } from '../prune-failed-tool-turns';
import { sanitizeAbortedToolCalls } from '../sanitize-aborted-tool-calls';

const invalidOutput = JSON.stringify({
  summary: 'goal 不能为空',
  meta: { status: 'invalid' },
});

describe('pruneFailedToolTurns', () => {
  it.each([
    {
      label: 'SDK 参数错误',
      part: {
        type: 'tool-write_learn_plan',
        state: 'output-error',
        errorText: 'Invalid input for tool write_learn_plan',
      },
    },
    {
      label: '业务参数校验失败',
      part: {
        type: 'tool-write_learn_plan',
        state: 'output-available',
        output: invalidOutput,
      },
    },
  ])('$label 的纯失败 assistant 轮次不再进入模型上下文', ({ part }) => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: '我再试一次。' },
          { ...part, toolCallId: 'call-1', input: {} },
        ],
      },
    ];

    expect(dropContentlessMessages(pruneFailedToolTurns(messages))).toEqual([]);
  });

  it('用户中止形成的半截调用经协议补全后也不会污染下一轮', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-write_learn_plan',
            state: 'input-available',
            toolCallId: 'call-1',
            input: {},
          },
        ],
      },
    ];

    const sanitized = sanitizeAbortedToolCalls(messages);
    expect(dropContentlessMessages(pruneFailedToolTurns(sanitized))).toEqual(
      [],
    );
  });

  it.each(['ok', 'pending_approval'])(
    'status=%s 的成功工具轮次保持原样',
    (status) => {
      const messages = [
        {
          role: 'assistant',
          parts: [
            {
              type: 'tool-write_learn_plan',
              state: 'output-available',
              toolCallId: 'call-1',
              input: { goal: '目标' },
              output: JSON.stringify({ meta: { status } }),
            },
          ],
        },
      ];

      expect(pruneFailedToolTurns(messages)).toEqual(messages);
    },
  );

  it('执行期网络错误作为有效上下文保留', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-web_fetch',
            state: 'output-error',
            toolCallId: 'call-1',
            input: { url: 'https://example.com' },
            errorText: 'fetch failed: network timeout',
          },
        ],
      },
    ];

    expect(pruneFailedToolTurns(messages)).toEqual(messages);
  });

  it('混合轮次只删除失败工具部件', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: '已完成检索，写入参数需要重做。' },
          {
            type: 'tool-web_search',
            state: 'output-available',
            output: JSON.stringify({ meta: { status: 'ok' } }),
          },
          {
            type: 'tool-write_learn_plan',
            state: 'output-available',
            output: invalidOutput,
          },
        ],
      },
    ];

    expect(pruneFailedToolTurns(messages)[0]?.parts).toEqual([
      { type: 'text', text: '已完成检索，写入参数需要重做。' },
      {
        type: 'tool-web_search',
        state: 'output-available',
        output: JSON.stringify({ meta: { status: 'ok' } }),
      },
    ]);
  });

  it('普通文本消息和用户消息不受影响', () => {
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: '继续' }] },
      { role: 'assistant', parts: [{ type: 'text', text: '好的。' }] },
    ];

    expect(pruneFailedToolTurns(messages)).toEqual(messages);
  });
});
