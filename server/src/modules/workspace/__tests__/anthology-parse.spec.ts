/**
 * anthology-parse.spec.ts — AnthologyViewService 纯函数的单元测试。
 *
 * 统一页面树 Phase 2（2026-05-29）后纯函数收窄为：
 * - parseAnthologyIndex / serializeAnthologyIndex：只处理 main.md 的 title/description
 *   （条目列表不再进索引——子节点才是权威来源）。
 * - parseEntryContent / serializeEntryContent：在子 ContentItem 的 bodyMarkdown 头部
 *   round-trip 可选的 date frontmatter；无 date 时正文即纯文本（与笔记一致）。
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
  it('完整 frontmatter → 解析出 title/description（不再含 entries）', () => {
    const raw = [
      '---',
      'title: 旅行文集',
      'description: 记录各地见闻',
      '---',
    ].join('\n');

    const result = parseAnthologyIndex(raw);

    expect(result.title).toBe('旅行文集');
    expect(result.description).toBe('记录各地见闻');
    // 条目列表已移出索引，解析结果不含 entries 字段
    expect(result).not.toHaveProperty('entries');
  });

  it('索引里残留的 entries 列表被忽略（子节点才是权威来源）', () => {
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

  it('无 frontmatter（纯文本）→ 返回空默认值', () => {
    const result = parseAnthologyIndex('没有 frontmatter 的内容');
    expect(result.title).toBe('');
    expect(result.description).toBe('');
  });

  it('只有开头 --- 没有关闭标记 → 返回默认值', () => {
    const result = parseAnthologyIndex('---\ntitle: 未关闭\n没有关闭标记');
    expect(result.title).toBe('');
    expect(result.description).toBe('');
  });
});

// ─── serializeAnthologyIndex ─────────────────────────────────────────────────

describe('serializeAnthologyIndex', () => {
  it('生成合法 YAML frontmatter，只含 title/description', () => {
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
});

// ─── index round-trip ────────────────────────────────────────────────────────

describe('serializeAnthologyIndex → parseAnthologyIndex round-trip', () => {
  it('序列化后再解析，title/description 一致', () => {
    const original = { title: '旅行文集', description: '跨越山与海的记录' };

    const parsed = parseAnthologyIndex(serializeAnthologyIndex(original));

    expect(parsed.title).toBe(original.title);
    expect(parsed.description).toBe(original.description);
  });
});

// ─── parseEntryContent ────────────────────────────────────────────────────────

describe('parseEntryContent', () => {
  it('有 date frontmatter + 正文 → 解析出 date/bodyMarkdown', () => {
    const raw = [
      '---',
      'date: "2026-03-01"',
      '---',
      '',
      '# 北京初见',
      '',
      '到达北京的第一天，阳光明媚。',
    ].join('\n');

    const result = parseEntryContent(raw);

    expect(result.date).toBe('2026-03-01');
    expect(result.bodyMarkdown).toContain('# 北京初见');
    expect(result.bodyMarkdown).toContain('到达北京的第一天');
  });

  it('无 frontmatter → 整个内容作为 bodyMarkdown，date 为 null', () => {
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

// ─── serializeEntryContent ───────────────────────────────────────────────────

describe('serializeEntryContent', () => {
  it('有 date → 生成带 frontmatter 的完整内容', () => {
    const result = serializeEntryContent({
      date: '2026-03-01',
      bodyMarkdown: '# 北京初见\n\n到达北京的第一天。',
    });

    expect(result).toMatch(/^---\n/);
    expect(result).toContain('2026-03-01');
    expect(result).toContain('# 北京初见');
    expect(result).toContain('到达北京的第一天。');
  });

  it('date 为 null → 直接存纯正文，不含 frontmatter', () => {
    const result = serializeEntryContent({
      date: null,
      bodyMarkdown: '正文。',
    });

    expect(result).toBe('正文。');
    expect(result).not.toContain('---');
  });
});

// ─── entry round-trip ────────────────────────────────────────────────────────

describe('serializeEntryContent → parseEntryContent round-trip', () => {
  it('有 date：序列化后再解析，date 和正文一致', () => {
    const original = {
      date: '2026-04-15',
      bodyMarkdown: '# 成都\n\n喝茶，打麻将，逛宽窄巷子。',
    };

    const parsed = parseEntryContent(serializeEntryContent(original));

    expect(parsed.date).toBe(original.date);
    expect(parsed.bodyMarkdown).toBe(original.bodyMarkdown);
  });

  it('无 date：序列化后再解析，date 仍为 null、正文不变', () => {
    const original = {
      date: null,
      bodyMarkdown: '这是一段旅行记录，没有记录具体日期。',
    };

    const parsed = parseEntryContent(serializeEntryContent(original));

    expect(parsed.date).toBeNull();
    expect(parsed.bodyMarkdown).toBe(original.bodyMarkdown);
  });
});
