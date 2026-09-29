import {
  BadRequestException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { lookup } from 'mime-types';
import type { Readable } from 'stream';
import { ContentRepoService } from '../content/content-repo.service';
import { OssService } from '../oss/oss.service';
import { PublicLibraryService } from './public-library.service';
import { ExternalReferenceService } from './external-reference.service';
import { isAssetName } from './document-structure';
import type { AssetDescriptor, PublicDocument } from './external-read.contract';

type Representation = 'original' | 'preview' | 'text';

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as {
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  return (
    value.code === 'NoSuchKey' ||
    value.status === 404 ||
    value.statusCode === 404
  );
}

@Injectable()
export class ExternalAssetsService {
  private readonly logger = new Logger(ExternalAssetsService.name);
  constructor(
    private readonly library: PublicLibraryService,
    private readonly references: ExternalReferenceService,
    private readonly oss: OssService,
    private readonly repo: ContentRepoService,
  ) {}

  describe(document: PublicDocument): AssetDescriptor[] {
    if (!document.item.revision) return [];
    return document.assets.map((asset) => {
      const mediaType = lookup(asset.fileName) || 'application/octet-stream';
      const type = mediaType.startsWith('image/')
        ? 'image'
        : mediaType.startsWith('audio/')
          ? 'audio'
          : mediaType.startsWith('video/')
            ? 'video'
            : 'file';
      // External readers never download image originals, including archive fallbacks.
      const representations: Representation[] =
        type === 'image' ? [] : ['original'];
      if (
        type === 'image' &&
        mediaType !== 'image/svg+xml' &&
        this.oss.isDraftStorageReady()
      )
        representations.push('preview');
      if (
        mediaType.startsWith('text/') ||
        ['application/json', 'application/xml'].includes(mediaType)
      )
        representations.push('text');
      const assetRef = this.references.encode({
        kind: 'asset',
        target: document.item.target,
        revision: document.item.revision!,
        fileName: asset.fileName,
      });
      const url = representations.length
        ? `/api/v1/external/assets?assetRef=${assetRef}`
        : null;
      return {
        ...asset,
        assetRef,
        type,
        mediaType,
        representations,
        url,
      };
    });
  }

  async read(
    assetRef: string,
    representation?: Representation,
  ): Promise<{ stream: Readable; mediaType: string; fileName: string }> {
    const ref = this.references.decode(assetRef);
    if (ref.kind !== 'asset' || !isAssetName(ref.fileName))
      throw new BadRequestException('INVALID_REFERENCE');
    const document = await this.library.currentDocument(ref.target);
    if (!document.item.bodyAvailable || !document.item.revision)
      throw new NotFoundException('RESOURCE_NOT_FOUND');
    this.references.assertRevision(ref.revision, document.item.revision);
    const descriptor = this.describe(document).find(
      (asset) => asset.fileName === ref.fileName,
    );
    if (!descriptor || !document.contentItemId)
      throw new NotFoundException('RESOURCE_NOT_FOUND');
    const selected =
      representation ??
      (descriptor.representations.includes('preview') ? 'preview' : 'original');
    if (!descriptor.representations.includes(selected))
      throw new UnsupportedMediaTypeException('REPRESENTATION_UNAVAILABLE');
    const startedAt = Date.now();
    let stream: Readable;
    try {
      if (this.oss.isDraftStorageReady()) {
        // Only permanent storage: never expose the draft namespace or enumerate files.
        try {
          stream = await this.oss.getObjectStream(
            `assets/${document.contentItemId}/${ref.fileName}`,
            selected === 'preview'
              ? OssService.IMAGE_PRESETS.vision
              : undefined,
          );
        } catch (error) {
          if (!isMissingObject(error)) throw error;
          // Missing previews are optional failures, never an original-image fallback.
          if (selected === 'preview')
            throw new UnsupportedMediaTypeException(
              'REPRESENTATION_UNAVAILABLE',
            );
          if (!document.commitHash) throw error;
          this.logger.warn({
            event: 'asset_oss_missing_use_archive',
            contentItemId: document.contentItemId,
            fileName: ref.fileName,
            representation: selected,
          });
          stream = await this.repo.readArchivedAssetStream(
            document.contentItemId,
            ref.fileName,
            document.commitHash,
          );
        }
      } else if (selected === 'preview') {
        // Runtime storage configuration may change after capability discovery.
        throw new UnsupportedMediaTypeException('REPRESENTATION_UNAVAILABLE');
      } else if (document.commitHash) {
        stream = await this.repo.readArchivedAssetStream(
          document.contentItemId,
          ref.fileName,
          document.commitHash,
        );
      } else {
        throw new ServiceUnavailableException('ASSET_NOT_ARCHIVED');
      }
    } catch (error) {
      const context = {
        event: 'asset_read_failed',
        contentItemId: document.contentItemId,
        fileName: ref.fileName,
        representation: selected,
        durationMs: Date.now() - startedAt,
      };
      if (error instanceof HttpException && error.getStatus() < 500)
        this.logger.debug(context);
      else
        this.logger.error(
          context,
          error instanceof Error ? error.stack : undefined,
        );
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('ASSET_READ_FAILED');
    }
    stream.on('error', (error: Error) =>
      this.logger.error(
        {
          event: 'asset_stream_failed',
          contentItemId: document.contentItemId,
          fileName: ref.fileName,
        },
        error.stack,
      ),
    );
    this.logger.debug({
      event: 'asset_stream_opened',
      contentItemId: document.contentItemId,
      fileName: ref.fileName,
      representation: selected,
      durationMs: Date.now() - startedAt,
    });
    return {
      stream,
      mediaType: selected === 'preview' ? 'image/webp' : descriptor.mediaType,
      fileName: ref.fileName,
    };
  }
}
