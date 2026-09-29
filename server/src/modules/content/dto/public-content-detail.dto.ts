import { NotFoundException } from '@nestjs/common';
import { ContentStatus } from '../content-item.entity';
import { HeadingDto } from '../../../common/extract-headings';
import { ContentDetailDto, ContentVersionDto } from './content-detail.dto';

/** Public responses use an allowlist, never a spread of the admin DTO. */
export class PublicContentDetailDto {
  id!: string;
  title!: string;
  summary!: string;
  status!: ContentStatus.published;
  publishedVersion!: ContentVersionDto;
  bodyMarkdown!: string;
  headings!: HeadingDto[];
  createdAt!: string;
  updatedAt!: string;
  publishedAt!: string | null;

  static fromDetail(detail: ContentDetailDto): PublicContentDetailDto {
    if (!detail.publishedVersion)
      throw new NotFoundException('Content not found');
    return {
      id: detail.id,
      title: detail.publishedVersion.title,
      summary: detail.publishedVersion.summary,
      status: ContentStatus.published,
      publishedVersion: detail.publishedVersion,
      bodyMarkdown: detail.bodyMarkdown,
      headings: detail.headings,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      publishedAt: detail.publishedAt ?? null,
    };
  }
}
