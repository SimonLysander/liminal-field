import { sanitizeAbortedToolCalls } from './sanitize-aborted-tool-calls';

const ABORT_ERROR = '工具调用被用户中止（暂停按钮按下），未执行也无返回结果。';

/**
 * 覆盖三个关键场景：
 * 1. 半截 tool 部件（input-streaming / input-available）→ 改成 output-error 占位
 * 2. 已完结的 tool 部件（output-available / output-error）→ 原样保留
 * 3. 非 tool 部件 / 非 assistant 消息 → 原样保留
 *
 * 这三场景对应 AI_MissingToolResultsError 的发生路径：
 * 1 是病因（要修），2 是正常已配对 tool_call/tool_result（不能误改），3 是无关消息（不能误伤）。
 */
describe('sanitizeAbortedToolCalls', () => {
  it('input-streaming → output-error，附 errorText', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-write_memory',
            state: 'input-streaming',
            toolCallId: 'call_xxx',
            input: { foo: 'bar' },
          },
        ],
      },
    ];
    const out = sanitizeAbortedToolCalls(messages);
    expect(out[0].parts[0]).toMatchObject({
      type: 'tool-write_memory',
      state: 'output-error',
      toolCallId: 'call_xxx',
      input: { foo: 'bar' },
      errorText: ABORT_ERROR,
    });
  });

  it('input-available → output-error（用户按停止最常停在这一态）', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-write_memory',
            state: 'input-available',
            toolCallId: 'call_01_XzkoIijozHZ6ugN4PW5w3989',
            input: { content: '独处与写作' },
          },
        ],
      },
    ];
    const out = sanitizeAbortedToolCalls(messages);
    expect(out[0].parts[0]).toMatchObject({
      state: 'output-error',
      errorText: ABORT_ERROR,
    });
  });

  it('dynamic-tool 部件也走同一逻辑（动态注册工具兼容）', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'dynamic-tool',
            state: 'input-available',
            toolCallId: 'call_dyn',
            toolName: 'custom',
            input: {},
          },
        ],
      },
    ];
    const out = sanitizeAbortedToolCalls(messages);
    expect((out[0].parts as Array<Record<string, unknown>>)[0].state).toBe(
      'output-error',
    );
  });

  it('output-available / output-error 已完结部件不动（不能把正常历史也改坏）', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-read_content',
            state: 'output-available',
            toolCallId: 'a',
            input: {},
            output: 'ok',
          },
          {
            type: 'tool-search',
            state: 'output-error',
            toolCallId: 'b',
            input: {},
            errorText: '原始错误',
          },
        ],
      },
    ];
    const out = sanitizeAbortedToolCalls(messages);
    expect(out[0].parts).toEqual(messages[0].parts);
  });

  it('user / system 消息原样不动（半截只可能在 assistant）', () => {
    const messages = [
      { role: 'user', parts: [{ type: 'text', text: '你好' }] },
      { role: 'system', parts: [{ type: 'text', text: 'system prompt' }] },
    ];
    const out = sanitizeAbortedToolCalls(messages);
    expect(out).toEqual(messages);
  });

  it('混合：同一 assistant 消息既有半截 tool 又有正常 text，只改 tool 部分', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          { type: 'text', text: '让我查一下：' },
          {
            type: 'tool-search',
            state: 'input-available',
            toolCallId: 'c',
            input: { q: '独处' },
          },
        ],
      },
    ];
    const out = sanitizeAbortedToolCalls(messages);
    const parts = out[0].parts as Array<Record<string, unknown>>;
    expect(parts[0]).toEqual({ type: 'text', text: '让我查一下：' });
    expect(parts[1].state).toBe('output-error');
  });

  it('空数组 / 没有 parts 的消息 → 返回原样', () => {
    expect(sanitizeAbortedToolCalls([])).toEqual([]);
    const messages = [{ role: 'assistant' }];
    expect(sanitizeAbortedToolCalls(messages)).toEqual(messages);
  });

  it('不修改入参（返回新数组 / 新部件，老引用不动）', () => {
    const part = {
      type: 'tool-write_memory',
      state: 'input-available',
      toolCallId: 'x',
      input: {},
    };
    const messages = [{ role: 'assistant', parts: [part] }];
    const out = sanitizeAbortedToolCalls(messages);
    expect(part.state).toBe('input-available');
    expect(out[0].parts[0]).not.toBe(part);
  });
});
