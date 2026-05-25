/**
 * matchScore / extractJSON 纯函数契约测试。
 *
 * matchScore 错会误删记忆；extractJSON 错会让记忆写入整链崩。
 * 两者零依赖纯函数，直接断言。
 */
import { matchScore, extractJSON } from './memory-agent.service';

describe('matchScore', () => {
  it('description 所有词都命中 target → 1', () => {
    expect(
      matchScore('quantum computing', 'intro to quantum computing basics'),
    ).toBe(1);
  });

  it('部分词命中 → 命中比例', () => {
    expect(matchScore('quantum physics', 'quantum mechanics')).toBe(0.5);
  });

  it('无词命中 → 0', () => {
    expect(matchScore('biology', 'quantum computing')).toBe(0);
  });

  it('description 全是 <2 字符的词（无有效词）→ 0', () => {
    expect(matchScore('a b c', 'a b c')).toBe(0);
  });
});

describe('extractJSON', () => {
  it('纯 JSON 直接解析', () => {
    expect(extractJSON('{"a":1}')).toEqual({ a: 1 });
  });

  it('```json 代码块', () => {
    expect(extractJSON('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('``` 无语言标记的代码块', () => {
    expect(extractJSON('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('文字包裹时按首尾花括号截取', () => {
    expect(extractJSON('结果如下：{"a":1} 完毕')).toEqual({ a: 1 });
  });

  it('找不到有效 JSON → 抛错', () => {
    expect(() => extractJSON('no json here')).toThrow('未找到有效 JSON');
  });
});
