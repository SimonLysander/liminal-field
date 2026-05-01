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
