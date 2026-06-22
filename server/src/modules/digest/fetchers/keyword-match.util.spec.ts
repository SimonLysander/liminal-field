/**
 * keyword-match.util 单测 —— 正则版 keyword 匹配。
 * 重点覆盖:词边界防误中、中文交替、OR、大小写、非法正则降级。
 */
import { matchesAnyKeyword } from './keyword-match.util';
import type { FetchedItem } from './fetcher.interface';

const item = (title: string, snippet = ''): FetchedItem => ({
  itemGuid: 'g',
  title,
  url: 'u',
  snippet,
});

describe('matchesAnyKeyword (正则版)', () => {
  it('普通子串(无词边界)命中', () => {
    expect(matchesAnyKeyword(item('Agentic frameworks'), ['agent'])).toBe(true);
  });

  it('词边界 \\bagent\\b 治子串误中:不中 agentic,中独立 agent', () => {
    expect(matchesAnyKeyword(item('Agentic frameworks'), ['\\bagent\\b'])).toBe(
      false,
    );
    expect(matchesAnyKeyword(item('an agent here'), ['\\bagent\\b'])).toBe(
      true,
    );
  });

  it('不区分大小写', () => {
    expect(matchesAnyKeyword(item('AGENT systems'), ['agent'])).toBe(true);
  });

  it('匹配 snippet 而不只是 title', () => {
    expect(
      matchesAnyKeyword(item('标题', 'about transformers'), ['transformer']),
    ).toBe(true);
  });

  it('OR 语义:多 pattern 命中任一即真', () => {
    expect(matchesAnyKeyword(item('about RAG'), ['\\bagent\\b', 'RAG'])).toBe(
      true,
    );
  });

  it('中文用交替正则', () => {
    expect(matchesAnyKeyword(item('国产大模型发布'), ['大模型|智能体'])).toBe(
      true,
    );
    expect(matchesAnyKeyword(item('今日天气预报'), ['大模型|智能体'])).toBe(
      false,
    );
  });

  it('非法正则降级为字面匹配、不抛错', () => {
    // '[' 是非法正则 → 降级按字面 '[' 匹配
    expect(() => matchesAnyKeyword(item('a [ bracket'), ['['])).not.toThrow();
    expect(matchesAnyKeyword(item('a [ bracket'), ['['])).toBe(true);
    expect(matchesAnyKeyword(item('no bracket'), ['['])).toBe(false);
  });

  it('空 keywords / 空串不误判', () => {
    expect(matchesAnyKeyword(item('anything'), [])).toBe(false);
    expect(matchesAnyKeyword(item('anything'), [''])).toBe(false);
  });
});
