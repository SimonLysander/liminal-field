import { describe, expect, it } from 'vitest';
import {
  cloneWithoutCitationAnchors,
  findClosestCitationAnchor,
  normalizeAidraftCitationLinks,
  removeAidraftCitationMarkers,
} from '../aidraft-citations';

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

describe('removeAidraftCitationMarkers', () => {
  it('删除正文 citation 角标并保留来源清单', () => {
    const md = [
      'React 16 于 2017 发布[1](https://r.dev/16#cit-1 "React 博客")。',
      '这个版本带来了新的渲染能力[@#CIT 2]。',
      '',
      '## 来源',
      '',
      '1. [React 博客](https://r.dev/16)',
    ].join('\n');

    const copied = removeAidraftCitationMarkers(md);

    expect(copied).toContain('React 16 于 2017 发布。');
    expect(copied).toContain('这个版本带来了新的渲染能力。');
    expect(copied).toContain('1. [React 博客](https://r.dev/16)');
    expect(copied).not.toContain('#cit-1');
    expect(copied).not.toContain('@#CIT 2');
  });
});

describe('cloneWithoutCitationAnchors', () => {
  it('复制局部富文本时移除 citation 链接而保留其他节点', () => {
    const source = document.createDocumentFragment();
    const paragraph = document.createElement('p');
    paragraph.append('一个结论');
    const citation = document.createElement('a');
    citation.href = 'https://a.dev#cit-1';
    citation.textContent = '1';
    paragraph.append(citation, '，以及一个 ');
    const link = document.createElement('a');
    link.href = 'https://b.dev';
    link.textContent = '普通链接';
    paragraph.append(link, '。');
    source.append(paragraph);

    const copy = document.createElement('div');
    copy.append(cloneWithoutCitationAnchors(source));

    expect(copy.textContent).toBe('一个结论，以及一个 普通链接。');
    expect(copy.querySelector('a[href*="#cit-"]')).toBeNull();
    expect(copy.querySelector('a:not([href*="#cit-"])')?.textContent).toBe('普通链接');
  });
});
