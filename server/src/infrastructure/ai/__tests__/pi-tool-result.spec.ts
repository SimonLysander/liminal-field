import { isPiToolResultInvalid, readPiToolOutput } from '../pi-tool-result';

describe('pi-tool-result', () => {
  it('优先读取适配器 details 中保留的原始输出', () => {
    expect(
      readPiToolOutput({
        details: { output: { summary: '完成' } },
        content: [{ type: 'text', text: 'fallback' }],
      }),
    ).toEqual({ summary: '完成' });
  });

  it('识别业务参数无效和 Pi Schema 校验失败', () => {
    expect(
      isPiToolResultInvalid({
        details: { output: { meta: { status: 'invalid' } } },
      }),
    ).toBe(true);
    expect(
      isPiToolResultInvalid({
        isError: true,
        content: [
          { type: 'text', text: 'Validation failed for tool "write_draft":' },
        ],
      }),
    ).toBe(true);
  });

  it('普通工具执行错误不计入参数纠错上限', () => {
    expect(
      isPiToolResultInvalid({
        isError: true,
        content: [{ type: 'text', text: 'upstream timeout' }],
      }),
    ).toBe(false);
  });

  it('纯图片结果保留可诊断的占位信息', () => {
    expect(
      readPiToolOutput({
        content: [{ type: 'image', mimeType: 'image/png' }],
      }),
    ).toBe('[image:image/png]');
  });
});
