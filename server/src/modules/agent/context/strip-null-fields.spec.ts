import { stripNullFields } from './strip-null-fields';

describe('stripNullFields', () => {
  it('剔除顶层 null 键', () => {
    expect(stripNullFields({ a: 1, b: null })).toEqual({ a: 1 });
  });

  it('递归剔除嵌套对象的 null 键', () => {
    const input = {
      role: 'assistant',
      metadata: null,
      parts: [
        { type: 'text', text: '好的', providerMetadata: null, state: 'done' },
        {
          type: 'tool-remember',
          state: 'output-available',
          title: null,
          rawInput: null,
          output: '{"ok":true}',
        },
      ],
    };
    expect(stripNullFields(input)).toEqual({
      role: 'assistant',
      parts: [
        { type: 'text', text: '好的', state: 'done' },
        {
          type: 'tool-remember',
          state: 'output-available',
          output: '{"ok":true}',
        },
      ],
    });
  });

  it('保留 ""/0/false 等有意义假值', () => {
    expect(stripNullFields({ a: '', b: 0, c: false, d: null })).toEqual({
      a: '',
      b: 0,
      c: false,
    });
  });

  it('数组逐项清理', () => {
    expect(stripNullFields([{ x: null, y: 1 }, { z: 2 }])).toEqual([
      { y: 1 },
      { z: 2 },
    ]);
  });

  it('字符串/数字等原样返回', () => {
    expect(stripNullFields('hi')).toBe('hi');
    expect(stripNullFields(42)).toBe(42);
  });
});
