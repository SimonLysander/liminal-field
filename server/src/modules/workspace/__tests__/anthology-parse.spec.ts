/**
 * anthology-parse.spec.ts — AnthologyViewService 纯函数的单元测试。
 *
 * 测试对象：从 anthology-view.service.ts 导出的 4 个纯函数：
 * - parseAnthologyIndex / serializeAnthologyIndex
 * - parseEntryContent / serializeEntryContent
 *
 * 策略：不依赖 NestJS 上下文（无 inject），直接 import 函数，快速运行。
 */
import {
  parseAnthologyIndex,
  serializeAnthologyIndex,
  parseEntryContent,
  serializeEntryContent,
} from '../anthology-view.service';

// ─── parseAnthologyIndex ────────────────────────────────────────────────────

describe('parseAnthologyIndex', () => {
  it('完整 frontmatter → 解析出 title/description/entries(只 key/title/date)', () => {
    const raw = [
      '---',
      'title: 旅行文集',
      'description: 记录各地见闻',
      'entries:',
      '  - key: e001',
      '    title: 北京初见',
      '    date: "2026-03-01"',
      '  - key: e002',
      '    title: 上海漫步',
      '---',
    ].join('\n');

    const result = parseAnthologyIndex(raw);

    expect(result.title).toBe('旅行文集');
    expect(result.description).toBe('记录各地见闻');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({ key: 'e001', title: '北京初见', date: '2026-03-01' });
    // 无 date 字段 → null
    expect(result.entries[1]).toEqual({ key: 'e002', title: '上海漫步', date: null });
  });

  it('旧索引里残留的 publishedVersionId 被忽略(发布状态已迁出 Git,只存 Mongo)', () => {
    const raw = [
      '---',
      'title: 旧格式文集',
      'entries:',
      '  - key: e001',
      '    title: 老条目',
      '    date: "2025-01-01"',
      '    publishedVersionId: snapshot-abc',
      '---',
    ].join('\n');

    const result = parseAnthologyIndex(raw);
    expect(result.entries[0]).toEqual({ key: 'e001', title: '老条目', date: '2025-01-01' });
    expect(result.entries[0]).not.toHaveProperty('publishedVersionId');
  });

  it('无 frontmatter（纯文本）→ 返回空默认值（含空 entries 数组）', () => {
    const raw = '没有 frontmatter 的内容';
    const result = parseAnthologyIndex(raw);

    expect(result.title).toBe('');
    expect(result.description).toBe('');
    expect(result.entries).toEqual([]);
  });

  it('frontmatter 中 entries 缺失 → entries 默认 []', () => {
    const raw = ['---', 'title: 文集标题', '---'].join('\n');
    const result = parseAnthologyIndex(raw);

    expect(result.title).toBe('文集标题');
    expect(result.entries).toEqual([]);
  });

  it('只有开头 --- 没有关闭标记 → 返回默认值', () => {
    const raw = '---\ntitle: 未关闭\n没有关闭标记';
    const result = parseAnthologyIndex(raw);

    expect(result.title).toBe('');
    expect(result.entries).toEqual([]);
  });

  it('entries 中 key 为空的条目被过滤掉', () => {
    const raw = [
      '---',
      'title: 过滤测试',
      'entries:',
      '  - key: e001',
      '    title: 有效条目',
      '    publishedVersionId: null',
      '  - key: ""',
      '    title: 无效条目（key 为空字符串）',
      '    publishedVersionId: null',
      '---',
    ].join('\n');

    const result = parseAnthologyIndex(raw);
    // key 为空字符串的条目被 .filter(e => e.key !== '') 过滤
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].key).toBe('e001');
  });

  it('YAML 裸日期自动转 Date 对象 → 规范化为 YYYY-MM-DD 字符串', () => {
    // 无引号的 2026-05-01 在 js-yaml 中会被解析为 Date 对象
    const raw = [
      '---',
      'title: 日期测试',
      'entries:',
      '  - key: e001',
      '    title: 测试条目',
      '    date: 2026-05-01',
      '---',
    ].join('\n');

    const result = parseAnthologyIndex(raw);
    // normalizeDate 将 Date 对象转为 ISO 日期字符串
    expect(result.entries[0].date).toBe('2026-05-01');
  });
});

// ─── serializeAnthologyIndex ─────────────────────────────────────────────────

describe('serializeAnthologyIndex', () => {
  it('生成合法 YAML frontmatter,只含内容+结构(不写 publishedVersionId 进 Git)', () => {
    const result = serializeAnthologyIndex({
      title: '旅行文集',
      description: '记录各地见闻',
      entries: [
        { key: 'e001', title: '北京初见', date: '2026-03-01' },
        { key: 'e002', title: '上海漫步', date: null },
      ],
    });

    expect(result).toMatch(/^---\n/);
    expect(result).toMatch(/---\n$/);
    expect(result).toContain('"旅行文集"');
    expect(result).toContain('"记录各地见闻"');
    expect(result).toContain('e001');
    expect(result).toContain('北京初见');
    expect(result).toContain('e002');
    // 发布状态不进 Git
    expect(result).not.toContain('publishedVersionId');
  });

  it('空 entries 列表 → 生成合法 frontmatter（entries: []）', () => {
    const result = serializeAnthologyIndex({
      title: '空文集',
      description: '',
      entries: [],
    });

    expect(result).toMatch(/^---\n/);
    expect(result).toContain('entries: []');
  });

  it('date: null 的条目 → 不含 date 字段,也不含 publishedVersionId', () => {
    const result = serializeAnthologyIndex({
      title: '测试',
      description: '',
      entries: [{ key: 'e001', title: '无日期条目', date: null }],
    });

    expect(result).toContain('e001');
    expect(result).not.toContain('date:');
    expect(result).not.toContain('publishedVersionId');
  });
});

// ─── index round-trip ────────────────────────────────────────────────────────

describe('serializeAnthologyIndex → parseAnthologyIndex round-trip', () => {
  it('序列化后再解析，内容+结构一致(发布状态不参与序列化)', () => {
    const original = {
      title: '旅行文集',
      description: '跨越山与海的记录',
      entries: [
        { key: 'e001', title: '北京初见', date: '2026-03-01' },
        { key: 'e002', title: '上海漫步', date: null },
        { key: 'e003', title: '成都慢生活', date: '2026-04-15' },
      ],
    };

    const serialized = serializeAnthologyIndex(original);
    const parsed = parseAnthologyIndex(serialized);

    expect(parsed.title).toBe(original.title);
    expect(parsed.description).toBe(original.description);
    expect(parsed.entries).toEqual(original.entries);
  });
});

// ─── parseEntryContent ────────────────────────────────────────────────────────

describe('parseEntryContent', () => {
  it('frontmatter 含 title/date + 正文 → 解析出 title/date/bodyMarkdown', () => {
    const raw = [
      '---',
      'title: 北京初见',
      'date: "2026-03-01"',
      '---',
      '',
      '# 北京初见',
      '',
      '到达北京的第一天，阳光明媚。',
    ].join('\n');

    const result = parseEntryContent(raw);

    expect(result.title).toBe('北京初见');
    expect(result.date).toBe('2026-03-01');
    expect(result.bodyMarkdown).toContain('# 北京初见');
    expect(result.bodyMarkdown).toContain('到达北京的第一天');
  });

  it('frontmatter 无 date → date: null', () => {
    const raw = [
      '---',
      'title: 无日期条目',
      '---',
      '',
      '正文内容。',
    ].join('\n');

    const result = parseEntryContent(raw);

    expect(result.title).toBe('无日期条目');
    expect(result.date).toBeNull();
    expect(result.bodyMarkdown).toBe('正文内容。');
  });

  it('无 frontmatter → 整个内容作为 bodyMarkdown，title/date 为空', () => {
    const raw = '这是没有 frontmatter 的纯文本正文。';
    const result = parseEntryContent(raw);

    expect(result.title).toBe('');
    expect(result.date).toBeNull();
    expect(result.bodyMarkdown).toBe(raw);
  });

  it('只有开头 --- 没有关闭标记 → 整个内容作为 bodyMarkdown', () => {
    const raw = '---\ntitle: 未关闭\n没有关闭的 frontmatter';
    const result = parseEntryContent(raw);

    expect(result.title).toBe('');
    expect(result.bodyMarkdown).toBe(raw);
  });
});

// ─── serializeEntryContent ───────────────────────────────────────────────────

describe('serializeEntryContent', () => {
  it('有 title/date/bodyMarkdown → 生成带 frontmatter 的完整文件内容', () => {
    const result = serializeEntryContent({
      title: '北京初见',
      date: '2026-03-01',
      bodyMarkdown: '# 北京初见\n\n到达北京的第一天。',
    });

    expect(result).toMatch(/^---\n/);
    expect(result).toContain('"北京初见"');
    // forceQuotes: true 后所有字符串值都有双引号
    expect(result).toContain('2026-03-01');
    expect(result).toContain('# 北京初见');
    expect(result).toContain('到达北京的第一天。');
  });

  it('date 为 null → frontmatter 中不包含 date 字段', () => {
    const result = serializeEntryContent({
      title: '无日期条目',
      date: null,
      bodyMarkdown: '正文。',
    });

    expect(result).toContain('"无日期条目"');
    expect(result).not.toContain('date:');
  });
});

// ─── entry round-trip ────────────────────────────────────────────────────────

describe('serializeEntryContent → parseEntryContent round-trip', () => {
  it('有 date：序列化后再解析，结果与原始数据一致', () => {
    const original = {
      title: '成都慢生活',
      date: '2026-04-15',
      bodyMarkdown: '# 成都\n\n喝茶，打麻将，逛宽窄巷子。',
    };

    const serialized = serializeEntryContent(original);
    const parsed = parseEntryContent(serialized);

    expect(parsed.title).toBe(original.title);
    expect(parsed.date).toBe(original.date);
    expect(parsed.bodyMarkdown).toBe(original.bodyMarkdown);
  });

  it('无 date：序列化后再解析，date 仍为 null', () => {
    const original = {
      title: '无日期旅记',
      date: null,
      bodyMarkdown: '这是一段旅行记录，没有记录具体日期。',
    };

    const serialized = serializeEntryContent(original);
    const parsed = parseEntryContent(serialized);

    expect(parsed.title).toBe(original.title);
    expect(parsed.date).toBeNull();
    expect(parsed.bodyMarkdown).toBe(original.bodyMarkdown);
  });
});
