import { describe, expect, it } from 'vitest';
import {
  findClosestCitationAnchor,
  normalizeAidraftCitationLinks,
} from './aidraft-citations';

describe('normalizeAidraftCitationLinks', () => {
  it('把旧式正文数字链接补成 citation 链接', () => {
    const md = [
      '# T',
      '',
      'React 16 于 2017 发布[1](https://r.dev/16)。',
      '',
      '## 来源',
      '',
      '1. [React 博客](https://r.dev/16)',
    ].join('\n');

    expect(normalizeAidraftCitationLinks(md)).toContain(
      '[1](https://r.dev/16#cit-1 "React 博客")',
    );
  });

  it('不改来源列表里的标题链接', () => {
    const md = [
      '正文[1](https://a.dev)。',
      '',
      '## 来源',
      '',
      '1. [A](https://a.dev)',
    ].join('\n');

    const got = normalizeAidraftCitationLinks(md);
    expect(got).toContain('正文[1](https://a.dev#cit-1 "A")。');
    expect(got).toContain('1. [A](https://a.dev)');
  });

  it('新式 citation 链接保持不变', () => {
    const md = [
      '正文[1](https://a.dev#cit-1 "A")。',
      '',
      '## 来源',
      '',
      '1. [A](https://a.dev)',
    ].join('\n');

    expect(normalizeAidraftCitationLinks(md)).toBe(md);
  });

  it('链接目标与来源不一致时不误改', () => {
    const md = [
      '普通编号[1](https://other.dev)。',
      '',
      '## 来源',
      '',
      '1. [A](https://a.dev)',
    ].join('\n');

    expect(normalizeAidraftCitationLinks(md)).toBe(md);
  });
});

describe('findClosestCitationAnchor', () => {
  it('点击文本节点时返回最近的 citation 链接', () => {
    const anchor = document.createElement('a');
    anchor.href = 'https://a.dev#cit-1';
    anchor.textContent = '1';
    document.body.appendChild(anchor);

    expect(findClosestCitationAnchor(anchor.firstChild)).toBe(anchor);

    anchor.remove();
  });

  it('非 Element / 非 citation 链接返回 null', () => {
    const text = document.createTextNode('plain');
    const anchor = document.createElement('a');
    anchor.href = 'https://a.dev';

    expect(findClosestCitationAnchor(text)).toBeNull();
    expect(findClosestCitationAnchor(anchor)).toBeNull();
  });
});
