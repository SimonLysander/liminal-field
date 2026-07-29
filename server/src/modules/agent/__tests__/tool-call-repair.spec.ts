import { repairMalformedToolInput } from '../tool-call-repair';

describe('repairMalformedToolInput', () => {
  it('修复长文本值中的未转义双引号并保持原意', () => {
    const malformed =
      '{"goal":"g","why":"从"看着夏普大于1就满意"到"量化判断是否显著"。"}';

    const repaired = repairMalformedToolInput(malformed);

    expect(repaired).toBeDefined();
    expect(JSON.parse(repaired!)).toEqual({
      goal: 'g',
      why: '从"看着夏普大于1就满意"到"量化判断是否显著"。',
    });
  });

  it('补齐被截断但内容完整的 JSON 结束符', () => {
    const repaired = repairMalformedToolInput(
      '{"goal":"g","items":[{"title":"t"}]',
    );

    expect(JSON.parse(repaired!)).toEqual({
      goal: 'g',
      items: [{ title: 't' }],
    });
  });

  it('合法 JSON 不进入修复，缺字段仍交给原工具 Schema 处理', () => {
    expect(repairMalformedToolInput('{"goal":"g"}')).toBeUndefined();
  });

  it('无法修复和超长输入保持失败', () => {
    expect(repairMalformedToolInput('}{')).toBeUndefined();
    expect(
      repairMalformedToolInput(`{"value":"${'x'.repeat(250_001)}`),
    ).toBeUndefined();
  });
});
