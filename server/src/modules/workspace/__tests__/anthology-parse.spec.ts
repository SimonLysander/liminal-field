/**
 * anthology-parse.spec.ts — AnthologyViewService 纯函数的单元测试。
 *
 * Phase 1 重构(2026-05-31)后纯函数收窄为:
 * - parseAnthologyIndex / serializeAnthologyIndex:处理容器 main.md 的 title/description
 *   + 可选卷首语 body(条目列表已移出索引——子节点才是权威来源)。
 * - parseEntryContent:解析子 ContentItem 的 bodyMarkdown,仅用于兼容旧数据
 *   (旧 saveEntry 时代头部含 date frontmatter,Phase 1 后新数据不再包装,直接整体作为 body)。
 *
 * 策略:不依赖 NestJS 上下文(无 inject),直接 import 函数,快速运行。
 */
import {
  parseAnthologyIndex,
  serializeAnthologyIndex,
  parseEntryContent,
} from '../anthology-view.service';

// ─── parseAnthologyIndex ────────────────────────────────────────────────────

describe('parseAnthologyIndex', () => {
  it('完整 frontmatter → 解析出 title/description(不再含 entries),body 为空', () => {
    const raw = [
      '---',
      'title: 旅行文集',
      'description: 记录各地见闻',
      '---',
    ].join('\n');

    const result = parseAnthologyIndex(raw);

    expect(result.title).toBe('旅行文集');
    expect(result.description).toBe('记录各地见闻');
    // 条目列表已移出索引,解析结果不含 entries 字段
    expect(result).not.toHaveProperty('entries');
    expect(result.body).toBe('');
  });

  it('frontmatter + 卷首语 body → 解析出 title/description/body', () => {
    const raw = [
      '---',
      'title: 行走南京',
      'description: 一年的记录',
      '---',
      '',
      '# 缘起',
      '',
      '那年春天我去了南京。',
    ].join('\n');

    const result = parseAnthologyIndex(raw);
    expect(result.title).toBe('行走南京');
    expect(result.description).toBe('一年的记录');
    expect(result.body).toContain('# 缘起');
    expect(result.body).toContain('那年春天我去了南京。');
  });

  it('索引里残留的 entries 列表被忽略(子节点才是权威来源)', () => {
    const raw = [
      '---',
      'title: 旧格式文集',
      'entries:',
      '  - key: e001',
      '    title: 老条目',
      '---',
    ].join('\n');

    const result = parseAnthologyIndex(raw);
    expect(result.title).toBe('旧格式文集');
    expect(result).not.toHaveProperty('entries');
  });

  it('无 frontmatter(纯文本)→ 整段当作 body,title/description 为空', () => {
    const result = parseAnthologyIndex('没有 frontmatter 的内容');
    expect(result.title).toBe('');
    expect(result.description).toBe('');
    expect(result.body).toBe('没有 frontmatter 的内容');
  });

  it('只有开头 --- 没有关闭标记 → 整段当作 body', () => {
    const result = parseAnthologyIndex('---\ntitle: 未关闭\n没有关闭标记');
    expect(result.title).toBe('');
    expect(result.description).toBe('');
    expect(result.body).toBe('---\ntitle: 未关闭\n没有关闭标记');
  });
});

// ─── serializeAnthologyIndex ─────────────────────────────────────────────────

describe('serializeAnthologyIndex', () => {
  it('仅 title/description → 生成纯 frontmatter,无 body 段', () => {
    const result = serializeAnthologyIndex({
      title: '旅行文集',
      description: '记录各地见闻',
    });

    expect(result).toMatch(/^---\n/);
    expect(result).toMatch(/---\n$/);
    expect(result).toContain('"旅行文集"');
    expect(result).toContain('"记录各地见闻"');
    // 不再序列化条目列表
    expect(result).not.toContain('entries');
  });

  it('带 body(卷首语)→ frontmatter 后追加 body', () => {
    const result = serializeAnthologyIndex({
      title: '行走南京',
      description: '',
      body: '# 缘起\n\n那年春天。',
    });
    expect(result).toContain('"行走南京"');
    expect(result).toContain('# 缘起');
    expect(result).toContain('那年春天。');
  });
});

// ─── index round-trip ────────────────────────────────────────────────────────

describe('serializeAnthologyIndex → parseAnthologyIndex round-trip', () => {
  it('无 body:序列化后再解析,title/description 一致', () => {
    const original = { title: '旅行文集', description: '跨越山与海的记录' };

    const parsed = parseAnthologyIndex(serializeAnthologyIndex(original));

    expect(parsed.title).toBe(original.title);
    expect(parsed.description).toBe(original.description);
    expect(parsed.body).toBe('');
  });

  it('有 body:序列化后再解析,title/description/body 一致', () => {
    const original = {
      title: '行走南京',
      description: '一年的记录',
      body: '# 缘起\n\n那年春天我去了南京。',
    };

    const parsed = parseAnthologyIndex(serializeAnthologyIndex(original));

    expect(parsed.title).toBe(original.title);
    expect(parsed.description).toBe(original.description);
    expect(parsed.body).toBe(original.body);
  });
});

// ─── parseEntryContent(旧数据兼容)───────────────────────────────────────

describe('parseEntryContent (旧数据兼容)', () => {
  it('旧数据头部有 date frontmatter + 正文 → 解析出 date/bodyMarkdown', () => {
    const raw = [
      '---',
      'date: "2026-03-01"',
      '---',
      '',
      '# 北京初见',
      '',
      '到达北京的第一天,阳光明媚。',
    ].join('\n');

    const result = parseEntryContent(raw);

    expect(result.date).toBe('2026-03-01');
    expect(result.bodyMarkdown).toContain('# 北京初见');
    expect(result.bodyMarkdown).toContain('到达北京的第一天');
  });

  it('Phase 1 新写入数据无 frontmatter → 整段作为 bodyMarkdown,date 为 null', () => {
    const raw = '这是没有 frontmatter 的纯文本正文。';
    const result = parseEntryContent(raw);

    expect(result.date).toBeNull();
    expect(result.bodyMarkdown).toBe(raw);
  });

  it('只有开头 --- 没有关闭标记 → 整个内容作为 bodyMarkdown', () => {
    const raw = '---\ndate: 未关闭\n没有关闭的 frontmatter';
    const result = parseEntryContent(raw);

    expect(result.date).toBeNull();
    expect(result.bodyMarkdown).toBe(raw);
  });

  it('YAML 裸日期自动转 Date 对象 → 规范化为 YYYY-MM-DD 字符串', () => {
    const raw = ['---', 'date: 2026-05-01', '---', '', '正文。'].join('\n');
    const result = parseEntryContent(raw);
    expect(result.date).toBe('2026-05-01');
  });
});
