import { parseGalleryContent, serializeGalleryContent } from './gallery-view.service';

// ─── parseGalleryContent ────────────────────────────────────────────────────

describe('parseGalleryContent', () => {
  it('完整 frontmatter（date + location + cover + photos）→ 正确解析，hasFrontmatter: true', () => {
    const raw = [
      '---',
      'date: "2024-03-15"',
      'location: 北京',
      'cover: photo-abc.jpg',
      'photos:',
      '  - file: photo-abc.jpg',
      '    caption: 老胡同里的光影',
      '    tags:',
      '      camera: GR III',
      '---',
      '',
      '这是正文。',
    ].join('\n');

    const result = parseGalleryContent(raw);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.cover).toBe('photo-abc.jpg');
    expect(result.date).toBe('2024-03-15');
    expect(result.location).toBe('北京');
    expect(result.photos).toHaveLength(1);
    expect(result.photos[0]).toEqual({
      file: 'photo-abc.jpg',
      caption: '老胡同里的光影',
      tags: { camera: 'GR III' },
    });
    expect(result.prose).toBe('这是正文。');
  });

  it('旧数据兼容：tags.location 自动迁移为一级 location', () => {
    const raw = [
      '---',
      'cover: photo-abc.jpg',
      'tags:',
      '  location: 上海',
      'photos: []',
      '---',
      '',
      '旧格式正文。',
    ].join('\n');

    const result = parseGalleryContent(raw);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.location).toBe('上海');
    expect(result.date).toBeNull();
  });

  it('无 frontmatter（纯 prose）→ photos: [], hasFrontmatter: false', () => {
    const raw = '这是一段没有 frontmatter 的正文。';

    const result = parseGalleryContent(raw);

    expect(result.hasFrontmatter).toBe(false);
    expect(result.photos).toEqual([]);
    expect(result.cover).toBeNull();
    expect(result.date).toBeNull();
    expect(result.location).toBeNull();
    expect(result.prose).toBe(raw);
  });

  it('frontmatter 中 photos 为空数组 → photos: [], hasFrontmatter: true', () => {
    const raw = ['---', 'cover: cover.jpg', 'photos: []', '---', '', '正文'].join('\n');

    const result = parseGalleryContent(raw);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.photos).toEqual([]);
  });

  it('frontmatter 中无 photos 字段 → photos: [], hasFrontmatter: true', () => {
    const raw = ['---', 'cover: cover.jpg', '---', '', '正文'].join('\n');

    const result = parseGalleryContent(raw);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.photos).toEqual([]);
  });

  it('YAML 解析失败 → 降级为无 frontmatter', () => {
    // 故意写出非法 YAML（缩进混乱 + 不合法字符）
    const raw = ['---', ': invalid: yaml: [broken', '---', '', '正文'].join('\n');

    const result = parseGalleryContent(raw);

    expect(result.hasFrontmatter).toBe(false);
    expect(result.photos).toEqual([]);
    expect(result.prose).toBe(raw);
  });

  it('只有开头 --- 没有关闭标记 → 降级为无 frontmatter', () => {
    const raw = '---\ncover: photo.jpg\n没有关闭的 frontmatter';

    const result = parseGalleryContent(raw);

    expect(result.hasFrontmatter).toBe(false);
    expect(result.photos).toEqual([]);
    expect(result.prose).toBe(raw);
  });

  it('photos 中有 file 字段缺失的条目 → 被过滤掉', () => {
    const raw = [
      '---',
      'photos:',
      '  - file: valid.jpg',
      '    caption: 有效照片',
      '    tags: {}',
      '  - caption: 缺少 file 字段',
      '    tags: {}',
      '---',
      '',
    ].join('\n');

    const result = parseGalleryContent(raw);

    expect(result.hasFrontmatter).toBe(true);
    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].file).toBe('valid.jpg');
  });
});

// ─── serializeGalleryContent ────────────────────────────────────────────────

describe('serializeGalleryContent', () => {
  it('有 photos + cover + date + location → 生成完整 frontmatter', () => {
    const result = serializeGalleryContent({
      photos: [{ file: 'photo-1.jpg', caption: '第一张', tags: { camera: 'GR III' } }],
      cover: 'photo-1.jpg',
      date: '2024-03-15',
      location: '上海',
      prose: '一些正文。',
    });

    expect(result).toMatch(/^---\n/);
    expect(result).toContain('cover: photo-1.jpg');
    expect(result).toContain('location: 上海');
    expect(result).toContain('2024-03-15');
    expect(result).toContain('photo-1.jpg');
    expect(result).toContain('一些正文。');
    expect(result).toMatch(/---\n\n一些正文。$/);
  });

  it('无 photos 无 cover 无 date 无 location → 始终生成 frontmatter（空 photos 字段）', () => {
    const result = serializeGalleryContent({
      photos: [],
      cover: null,
      date: null,
      location: null,
      prose: '纯正文，没有元数据。',
    });

    // 始终生成 frontmatter（空 photos 也写入），确保 parseGalleryContent 识别 hasFrontmatter=true
    expect(result).toContain('---');
    expect(result).toContain('photos: []');
    expect(result).toContain('纯正文，没有元数据。');
  });

  it('空 photos 但有 cover → 生成 frontmatter（cover 不为 null）', () => {
    const result = serializeGalleryContent({
      photos: [],
      cover: 'cover.jpg',
      date: null,
      location: null,
      prose: '正文',
    });

    expect(result).toMatch(/^---\n/);
    expect(result).toContain('cover: cover.jpg');
  });
});

// ─── round-trip（serialize → parse）────────────────────────────────────────

describe('serializeGalleryContent → parseGalleryContent round-trip', () => {
  it('序列化后再解析，结果与原始数据一致', () => {
    const original = {
      photos: [
        { file: 'a.jpg', caption: '照片 A', tags: { camera: 'Sony' } },
        { file: 'b.jpg', caption: '照片 B', tags: {} },
      ],
      cover: 'a.jpg',
      date: '2024-06-01',
      location: '广州',
      prose: '游记正文。',
    };

    const serialized = serializeGalleryContent(original);
    const parsed = parseGalleryContent(serialized);

    expect(parsed.hasFrontmatter).toBe(true);
    expect(parsed.cover).toBe(original.cover);
    expect(parsed.date).toBe(original.date);
    expect(parsed.location).toBe(original.location);
    expect(parsed.prose).toBe(original.prose);
    expect(parsed.photos).toHaveLength(2);
    expect(parsed.photos[0]).toEqual(original.photos[0]);
    expect(parsed.photos[1]).toEqual(original.photos[1]);
  });
});
