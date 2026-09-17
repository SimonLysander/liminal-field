import { jsonSchema, tool } from 'ai';
import { adaptToolsForPi } from '../pi-tool.adapter';

describe('adaptToolsForPi', () => {
  it('复用 AI SDK Schema，并把 toolCallId 与 AbortSignal 传给原工具', async () => {
    const execute = jest.fn().mockResolvedValue({ ok: true });
    const source = tool({
      description: '测试工具',
      inputSchema: jsonSchema<{ query: string }>({
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      }),
      execute,
    });
    const [adapted] = adaptToolsForPi({ search: source });
    const controller = new AbortController();

    const result = await adapted.execute(
      'call-1',
      { query: 'test' },
      controller.signal,
    );

    expect(adapted.name).toBe('search');
    expect(adapted.parameters).toEqual({
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    });
    expect(execute).toHaveBeenCalledWith(
      { query: 'test' },
      expect.objectContaining({
        toolCallId: 'call-1',
        abortSignal: controller.signal,
      }),
    );
    expect(result.details).toEqual({ output: { ok: true } });
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ ok: true }) },
    ]);
  });

  it('拒绝没有 execute 的模型工具，避免运行期静默无结果', () => {
    expect(() =>
      adaptToolsForPi({
        broken: {
          description: 'broken',
          inputSchema: { jsonSchema: { type: 'object' } },
        },
      }),
    ).toThrow('缺少 execute');
  });
});
