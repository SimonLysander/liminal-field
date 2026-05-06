import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ContentRepoService } from '../content-repo.service';
import {
  ContentChangeLog,
  ContentChangeType,
  ContentItem,
} from '../content-item.entity';

describe('ContentRepoService', () => {
  let service: ContentRepoService;
  let tempDirectory: string;
  let previousCwd: string;

  beforeEach(async () => {
    previousCwd = process.cwd();
    tempDirectory = await mkdtemp(join(tmpdir(), 'lf-content-repo-'));
    process.chdir(tempDirectory);
    const configService = {
      getOrThrow: () => tempDirectory,
    } as unknown as ConfigService;
    service = new ContentRepoService(configService);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('writes and parses main.md with plain text and asset refs', async () => {
    await service.writeMainMarkdown(
      'ci_test',
      [
        '# Demo Title',
        '',
        'This is **bold** text with [a link](https://example.com).',
        '',
        '![cover](./assets/cover.png)',
        '',
        '[clip](./assets/demo.mp4)',
      ].join('\n'),
    );

    const source = await service.readContentSource('ci_test');

    expect(source.plainText).toBe(
      'Demo Title This is bold text with a link. clip',
    );
    expect(source.assetRefs).toEqual([
      { path: './assets/cover.png', type: 'image' },
      { path: './assets/demo.mp4', type: 'video' },
    ]);
  });

  it('rejects empty main.md content', async () => {
    await expect(
      service.writeMainMarkdown('ci_empty', '   \n\n  '),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects non-relative asset paths', async () => {
    await expect(
      service.writeMainMarkdown(
        'ci_invalid_asset',
        '![cover](assets/cover.png)\n\nSome content',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('writes README with the minimal protocol fields', async () => {
    const now = new Date('2026-04-17T08:00:00.000Z');
    const content = Object.assign(new ContentItem(), {
      _id: 'ci_readme',
      latestVersion: {
        commitHash: 'abc123',
        title: 'React Hooks Intro',
        summary: 'A short guide to hooks.',
      },
      changeLogs: [
        {
          commitHash: 'abc123',
          title: 'React Hooks Intro',
          summary: 'A short guide to hooks.',
          createdAt: now,
          changeType: ContentChangeType.patch,
          changeNote: 'Refined the examples',
        } satisfies ContentChangeLog,
      ],
      createdAt: now,
      updatedAt: now,
    });

    await service.ensureContentScaffold(content.id);
    await service.writeReadme(content, [
      { path: './assets/cover.png', type: 'image' },
    ]);

    const readme = await readFile(
      join(tempDirectory, 'content', 'ci_readme', 'README.md'),
      'utf8',
    );

    expect(readme).toContain('# React Hooks Intro');
    expect(readme).toContain('A short guide to hooks.');
    expect(readme).toContain('## Recent Updates');
    expect(readme).toContain('Created: 2026-04-17');
    expect(readme).toContain('Media: 1 images');
    expect(readme).not.toContain('Status:');
    expect(readme).not.toContain('Updated:');
  });

  it('stores uploaded assets with a safe generated file name', async () => {
    const stored = await service.storeAsset(
      'ci_asset',
      '../Cover Image.PNG',
      Buffer.from('asset'),
    );

    expect(stored.path).toMatch(/^\.\/*assets\/cover-image-[a-z0-9]{8}\.png$/);
    expect(stored.fileName).toMatch(/^cover-image-[a-z0-9]{8}\.png$/);
  });

  describe('path traversal protection', () => {
    it('rejects readAssetBuffer with directory traversal', async () => {
      await expect(
        service.readAssetBuffer('ci_test', '../../etc/passwd'),
      ).rejects.toThrow();
    });

    it('rejects readAssetBuffer with absolute-looking names', async () => {
      await expect(
        service.readAssetBuffer('ci_test', '../secret.txt'),
      ).rejects.toThrow();
    });

    it('deleteAsset with traversal path only touches basename (no throw for nonexistent)', async () => {
      // basename('../../etc/passwd') → 'passwd'，只在 assets 目录下操作
      // 文件不存在时静默忽略（设计行为），关键是不会触及 /etc/passwd
      await expect(
        service.deleteAsset('ci_test', '../../etc/passwd'),
      ).resolves.toBeUndefined();
    });

    it('strips directory components and reads only basename', async () => {
      const stored = await service.storeAsset(
        'ci_safe',
        'photo.png',
        Buffer.from('img-data'),
      );
      // readAssetBuffer should work with just the safe fileName
      const result = await service.readAssetBuffer('ci_safe', stored.fileName);
      expect(result.buffer.toString()).toBe('img-data');
      expect(result.contentType).toBe('image/png');
    });
  });

  it('readContentSource respects scope parameter', async () => {
    await service.writeMainMarkdown(
      'ci_scope',
      'Text with ![img](./assets/photo.png)',
    );
    const notesSource = await service.readContentSource('ci_scope', {
      scope: 'notes',
    });
    expect(notesSource.bodyMarkdown).toContain(
      '/api/v1/spaces/notes/items/ci_scope/assets/',
    );

    const gallerySource = await service.readContentSource('ci_scope', {
      scope: 'gallery',
    });
    expect(gallerySource.bodyMarkdown).toContain(
      '/api/v1/spaces/gallery/items/ci_scope/assets/',
    );
  });

  it('lists stored assets with type and size', async () => {
    await service.storeAsset('ci_assets', 'cover.png', Buffer.from('cover'));
    await service.storeAsset('ci_assets', 'voice.mp3', Buffer.from('voice'));

    const assets = await service.listAssets('ci_assets');

    expect(assets).toHaveLength(2);
    const [coverAsset, voiceAsset] = assets;

    expect(coverAsset?.path).toMatch(/^\.\/*assets\/cover-[a-z0-9]{8}\.png$/);
    expect(coverAsset?.fileName).toMatch(/^cover-[a-z0-9]{8}\.png$/);
    expect(coverAsset?.type).toBe('image');
    expect(coverAsset?.size).toBe(5);

    expect(voiceAsset?.path).toMatch(/^\.\/*assets\/voice-[a-z0-9]{8}\.mp3$/);
    expect(voiceAsset?.fileName).toMatch(/^voice-[a-z0-9]{8}\.mp3$/);
    expect(voiceAsset?.type).toBe('audio');
    expect(voiceAsset?.size).toBe(5);
  });
});
