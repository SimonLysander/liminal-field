import { ImportService } from '../import.service';

/**
 * ImportService.parse 单元测试
 *
 * mock 所有外部依赖（MinIO、MinerU、MongoDB、Content、Navigation），
 * 只测试 parse 方法的文本处理和资源扫描逻辑。
 */

// 构造 mock 依赖
const mockMinioService = {
  putObject: jest.fn().mockResolvedValue(undefined),
  getObject: jest.fn(),
  listByPrefix: jest.fn().mockResolvedValue([]),
  removeByPrefix: jest.fn().mockResolvedValue(undefined),
};

const mockMineruService = {
  isConfigured: jest.fn().mockReturnValue(true),
  convert: jest.fn(),
};

const mockImportSessionRepo = {
  create: jest.fn().mockResolvedValue({}),
  findById: jest.fn(),
  updateAssets: jest.fn(),
  deleteById: jest.fn(),
};

const mockContentRepoService = {};
const mockContentGitService = {};
const mockContentRepository = {};
const mockNavigationNodeService = {};

function createService(): ImportService {
  return new ImportService(
    mockMinioService as any,
    mockMineruService as any,
    mockImportSessionRepo as any,
    mockContentRepoService as any,
    mockContentGitService as any,
    mockContentRepository as any,
    mockNavigationNodeService as any,
  );
}

describe('ImportService.parse', () => {
  let service: ImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createService();
  });

  it('parses .md file and extracts local image refs', async () => {
    const md = '# Title\n\n![](./img/photo.png)\n\ntext ![diagram](../assets/d.jpg)';
    const buffer = Buffer.from(md, 'utf-8');

    const result = await service.parse('notes.md', buffer);

    expect(result.title).toBe('notes');
    expect(result.parseId).toHaveLength(16);
    expect(result.assets).toHaveLength(2);
    expect(result.assets[0]).toMatchObject({ filename: 'photo.png', status: 'missing' });
    expect(result.assets[1]).toMatchObject({ filename: 'd.jpg', status: 'missing' });
  });

  it('applies heading normalization', async () => {
    const md = '### Title\n\n#### Sub';
    const buffer = Buffer.from(md, 'utf-8');

    const result = await service.parse('test.md', buffer);

    expect(result.markdown).toContain('# Title');
    expect(result.markdown).toContain('## Sub');
  });

  it('converts obsidian highlights', async () => {
    const md = 'this is ==important== text';
    const buffer = Buffer.from(md, 'utf-8');

    const result = await service.parse('test.md', buffer);

    expect(result.markdown).toContain('<mark>important</mark>');
  });

  it('collapses excessive blank lines', async () => {
    const md = 'a\n\n\n\n\nb';
    const buffer = Buffer.from(md, 'utf-8');

    const result = await service.parse('test.md', buffer);

    expect(result.markdown).toBe('a\n\nb');
  });

  it('does not extract http(s) URLs as local refs', async () => {
    const md = '![](https://example.com/img.png)\n![](./local.png)';
    const buffer = Buffer.from(md, 'utf-8');

    const result = await service.parse('test.md', buffer);

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0].filename).toBe('local.png');
  });

  it('deduplicates same filename refs', async () => {
    const md = '![](./a/img.png)\n![](./b/img.png)';
    const buffer = Buffer.from(md, 'utf-8');

    const result = await service.parse('test.md', buffer);

    expect(result.assets).toHaveLength(1);
  });

  it('stores session in MongoDB and markdown in MinIO', async () => {
    const buffer = Buffer.from('# Hello', 'utf-8');

    const result = await service.parse('test.md', buffer);

    expect(mockImportSessionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.parseId,
        title: 'test',
        assets: [],
      }),
    );
    expect(mockMinioService.putObject).toHaveBeenCalledWith(
      expect.stringContaining('content.md'),
      expect.any(Buffer),
      'text/markdown',
    );
  });

  it('routes docx to MinerU and marks extracted images as resolved', async () => {
    const images = new Map<string, Buffer>();
    images.set('fig1.png', Buffer.from('fake-png'));

    mockMineruService.convert.mockResolvedValue({
      markdown: '# Doc\n\n![](images/fig1.png)',
      images,
    });

    const buffer = Buffer.from('fake-docx-content');
    const result = await service.parse('report.docx', buffer);

    expect(mockMineruService.convert).toHaveBeenCalledWith('report.docx', buffer);
    expect(result.title).toBe('report');
    expect(result.assets.find((a) => a.filename === 'fig1.png')?.status).toBe('resolved');
    // 图片应存入 MinIO
    expect(mockMinioService.putObject).toHaveBeenCalledWith(
      expect.stringContaining('assets/fig1.png'),
      expect.any(Buffer),
      'image/png',
    );
  });

  it('uses filename (not content) as title', async () => {
    const md = '# Content Title\n\nSome text';
    const buffer = Buffer.from(md, 'utf-8');

    const result = await service.parse('我的笔记.md', buffer);

    expect(result.title).toBe('我的笔记');
  });
});
