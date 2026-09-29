import { ConflictException, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import { ExternalAssetsService } from '../external-assets.service';
import { PublicLibraryService } from '../public-library.service';
import { ExternalReferenceService } from '../external-reference.service';
import { ContentRepoService } from '../../content/content-repo.service';
import { OssService } from '../../oss/oss.service';
import type { PublicDocument } from '../external-read.contract';
import { documentStructure } from '../document-structure';

describe('ExternalAssetsService optional image previews', () => {
  const document: PublicDocument = {
    item: {
      target: 'notes:example',
      scope: 'notes',
      kind: 'page',
      title: 'Example',
      summary: '',
      url: '/note?node=example',
      parentTarget: null,
      bodyAvailable: true,
      childrenAvailable: false,
      revision: 'published-revision',
    },
    markdown: '![Image](./assets/image.png)',
    structure: documentStructure('![Image](./assets/image.png)'),
    metadata: {},
    assets: [{ fileName: 'image.png', description: 'Image', metadata: {} }],
    citations: [],
    updatedAt: null,
    contentItemId: 'example',
    commitHash: 'a'.repeat(40),
  };
  const library = { currentDocument: jest.fn() };
  const references = {
    decode: jest.fn(),
    encode: jest.fn(),
    assertRevision: jest.fn(),
  };
  const oss = { isDraftStorageReady: jest.fn(), getObjectStream: jest.fn() };
  const repo = { readArchivedAssetStream: jest.fn() };
  let service: ExternalAssetsService;
  let stream: Readable;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    library.currentDocument.mockReset().mockResolvedValue(document);
    references.decode.mockReset().mockReturnValue({
      kind: 'asset',
      target: document.item.target,
      revision: document.item.revision,
      fileName: 'image.png',
    });
    references.encode.mockReset().mockReturnValue('signed');
    references.assertRevision.mockReset();
    oss.isDraftStorageReady.mockReset().mockReturnValue(true);
    oss.getObjectStream.mockReset();
    stream = Readable.from([Buffer.from('published image')]);
    repo.readArchivedAssetStream.mockReset().mockResolvedValue(stream);
    service = new ExternalAssetsService(
      library as unknown as PublicLibraryService,
      references as unknown as ExternalReferenceService,
      oss as unknown as OssService,
      repo as unknown as ContentRepoService,
    );
  });
  afterEach(() => {
    stream.destroy();
    jest.restoreAllMocks();
  });

  it('advertises only previews for images, without an original-image URL', () => {
    const asset = service.describe(document)[0];
    expect(asset.representations).toEqual(['preview']);
    expect(asset).not.toHaveProperty('originalUrl');
    expect(
      new URL(asset.url!, 'https://example.com').searchParams.has(
        'representation',
      ),
    ).toBe(false);
  });

  it('prefers the OSS preview when it exists, with its actual WebP MIME', async () => {
    oss.getObjectStream.mockResolvedValue(stream);
    const result = await service.read('signed');
    expect(result).toEqual({
      stream,
      mediaType: 'image/webp',
      fileName: 'image.png',
    });
    expect(oss.getObjectStream).toHaveBeenCalledWith(
      'assets/example/image.png',
      OssService.IMAGE_PRESETS.vision,
    );
    expect(repo.readArchivedAssetStream).not.toHaveBeenCalled();
  });

  it.each([undefined, 'preview'] as const)(
    'does not fetch an archived original when an image preview is missing in %s mode',
    async (representation) => {
      oss.getObjectStream.mockRejectedValue(
        Object.assign(new Error('Missing'), { code: 'NoSuchKey' }),
      );
      await expect(
        service.read('signed', representation),
      ).rejects.toMatchObject({
        status: 415,
        message: 'REPRESENTATION_UNAVAILABLE',
      });
      expect(repo.readArchivedAssetStream).not.toHaveBeenCalled();
    },
  );

  it('rejects explicit original-image requests before accessing storage', async () => {
    await expect(service.read('signed', 'original')).rejects.toMatchObject({
      status: 415,
      message: 'REPRESENTATION_UNAVAILABLE',
    });
    expect(oss.getObjectStream).not.toHaveBeenCalled();
    expect(repo.readArchivedAssetStream).not.toHaveBeenCalled();
  });

  it('keeps image metadata readable when preview storage is unavailable', async () => {
    oss.isDraftStorageReady.mockReturnValue(false);
    expect(service.describe(document)[0]).toMatchObject({
      representations: [],
      url: null,
      description: 'Image',
    });
    await expect(service.read('signed')).rejects.toMatchObject({
      status: 415,
      message: 'REPRESENTATION_UNAVAILABLE',
    });
    expect(oss.getObjectStream).not.toHaveBeenCalled();
    expect(repo.readArchivedAssetStream).not.toHaveBeenCalled();
  });

  it('does not offer unprocessed SVG originals as image previews', async () => {
    const svg = {
      ...document,
      assets: [{ fileName: 'image.svg', description: 'Diagram', metadata: {} }],
    };
    library.currentDocument.mockResolvedValue(svg);
    references.decode.mockReturnValue({
      kind: 'asset',
      target: svg.item.target,
      revision: svg.item.revision,
      fileName: 'image.svg',
    });
    expect(service.describe(svg)[0]).toMatchObject({
      representations: [],
      url: null,
    });
    await expect(service.read('signed', 'original')).rejects.toMatchObject({
      status: 415,
    });
    expect(oss.getObjectStream).not.toHaveBeenCalled();
    expect(repo.readArchivedAssetStream).not.toHaveBeenCalled();
  });

  it('never falls back to originals when storage becomes unavailable during a request', async () => {
    oss.isDraftStorageReady.mockReturnValueOnce(true).mockReturnValue(false);
    await expect(service.read('signed')).rejects.toMatchObject({
      status: 415,
      message: 'REPRESENTATION_UNAVAILABLE',
    });
    expect(oss.getObjectStream).not.toHaveBeenCalled();
    expect(repo.readArchivedAssetStream).not.toHaveBeenCalled();
  });

  it.each([
    Object.assign(new Error('Network disconnected'), { code: 'ECONNRESET' }),
    Object.assign(new Error('Forbidden'), { status: 403 }),
  ])(
    'does not mask storage faults as an automatic fallback: %s',
    async (error) => {
      oss.getObjectStream.mockRejectedValue(error);
      await expect(service.read('signed')).rejects.toMatchObject({
        status: 503,
        message: 'ASSET_READ_FAILED',
      });
      expect(repo.readArchivedAssetStream).not.toHaveBeenCalled();
    },
  );

  it('preserves the published archive fallback for non-image files', async () => {
    const file = {
      ...document,
      assets: [{ fileName: 'data.json', description: 'Data', metadata: {} }],
    };
    library.currentDocument.mockResolvedValue(file);
    references.decode.mockReturnValue({
      kind: 'asset',
      target: file.item.target,
      revision: file.item.revision,
      fileName: 'data.json',
    });
    oss.getObjectStream.mockRejectedValue(
      Object.assign(new Error('Missing'), { code: 'NoSuchKey' }),
    );
    const result = await service.read('signed', 'text');
    expect(result.mediaType).toBe('application/json');
    expect(repo.readArchivedAssetStream).toHaveBeenCalledWith(
      'example',
      'data.json',
      file.commitHash,
    );
  });

  it('rejects stale public references before either storage backend is accessed', async () => {
    references.assertRevision.mockImplementation(() => {
      throw new ConflictException('CONTENT_CHANGED');
    });
    await expect(service.read('signed')).rejects.toMatchObject({
      status: 409,
      message: 'CONTENT_CHANGED',
    });
    expect(oss.getObjectStream).not.toHaveBeenCalled();
    expect(repo.readArchivedAssetStream).not.toHaveBeenCalled();
  });
});
