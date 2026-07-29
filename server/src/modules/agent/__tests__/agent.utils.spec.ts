import { InvalidToolInputError } from 'ai';
import { consecutiveInvalidToolCallsIs } from '../agent.utils';

type TestPart = {
  type: 'tool-error' | 'tool-result';
  toolName: string;
  output?: unknown;
  error?: unknown;
};

const step = (...content: TestPart[]) => ({ content });
const invalidInput = (toolName: string) =>
  new InvalidToolInputError({
    toolName,
    toolInput: '{',
    cause: new SyntaxError('Unexpected end of JSON input'),
  });

describe('consecutiveInvalidToolCallsIs', () => {
  it('同一工具连续两步无效时停止，第一步仍允许模型纠正', async () => {
    const stop = consecutiveInvalidToolCallsIs(2);

    await expect(
      Promise.resolve(
        stop({
          steps: [
            step({
              type: 'tool-error',
              toolName: 'write_learn_plan',
              error: invalidInput('write_learn_plan'),
            }),
          ],
        } as never),
      ),
    ).resolves.toBe(false);
    await expect(
      Promise.resolve(
        stop({
          steps: [
            step({
              type: 'tool-error',
              toolName: 'write_learn_plan',
              error: invalidInput('write_learn_plan'),
            }),
            step({
              type: 'tool-error',
              toolName: 'write_learn_plan',
              error: invalidInput('write_learn_plan'),
            }),
          ],
        } as never),
      ),
    ).resolves.toBe(true);
  });

  it('不同工具分别失败时不视为同一错误反复调用', async () => {
    const stop = consecutiveInvalidToolCallsIs(2);

    await expect(
      Promise.resolve(
        stop({
          steps: [
            step({
              type: 'tool-error',
              toolName: 'web_fetch',
              error: invalidInput('web_fetch'),
            }),
            step({
              type: 'tool-error',
              toolName: 'write_learn_plan',
              error: invalidInput('write_learn_plan'),
            }),
          ],
        } as never),
      ),
    ).resolves.toBe(false);
  });

  it('工具执行期异常不计入参数无效调用', async () => {
    const stop = consecutiveInvalidToolCallsIs(2);

    await expect(
      Promise.resolve(
        stop({
          steps: [
            step({
              type: 'tool-error',
              toolName: 'web_fetch',
              error: new Error('network timeout'),
            }),
            step({
              type: 'tool-error',
              toolName: 'web_fetch',
              error: new Error('network timeout'),
            }),
          ],
        } as never),
      ),
    ).resolves.toBe(false);
  });

  it('识别业务工具返回的 status=invalid', async () => {
    const stop = consecutiveInvalidToolCallsIs(2);
    const invalidResult = JSON.stringify({ meta: { status: 'invalid' } });

    await expect(
      Promise.resolve(
        stop({
          steps: [
            step({
              type: 'tool-result',
              toolName: 'write_learn_plan',
              output: invalidResult,
            }),
            step({
              type: 'tool-result',
              toolName: 'write_learn_plan',
              output: invalidResult,
            }),
          ],
        } as never),
      ),
    ).resolves.toBe(true);
  });

  it('兼容 SDK 的 text 输出包装', async () => {
    const stop = consecutiveInvalidToolCallsIs(2);
    const output = {
      type: 'text',
      value: JSON.stringify({ meta: { status: 'invalid' } }),
    };

    await expect(
      Promise.resolve(
        stop({
          steps: [
            step({
              type: 'tool-result',
              toolName: 'write_learn_plan',
              output,
            }),
            step({
              type: 'tool-result',
              toolName: 'write_learn_plan',
              output,
            }),
          ],
        } as never),
      ),
    ).resolves.toBe(true);
  });

  it.each(['ok', 'pending_approval'])(
    'status=%s 不计入无效调用',
    async (status) => {
      const stop = consecutiveInvalidToolCallsIs(2);
      const output = JSON.stringify({ meta: { status } });

      await expect(
        Promise.resolve(
          stop({
            steps: [
              step({
                type: 'tool-result',
                toolName: 'write_learn_plan',
                output,
              }),
              step({
                type: 'tool-result',
                toolName: 'write_learn_plan',
                output,
              }),
            ],
          } as never),
        ),
      ).resolves.toBe(false);
    },
  );

  it('拒绝无效的连续次数配置', () => {
    expect(() => consecutiveInvalidToolCallsIs(0)).toThrow(RangeError);
  });
});
