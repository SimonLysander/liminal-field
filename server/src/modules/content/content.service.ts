import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  ContentChangeLog,
  ContentChangeType,
  ContentItem,
  ContentStatus,
  ContentVersion,
} from './content-item.entity';
import { ContentGitService } from './content-git.service';
import { ContentRepoService } from './content-repo.service';
import { ContentRepository } from './content.repository';
import { ChangeLogDto } from './dto/change-log.dto';
import { ContentAssetRefDto, ContentDetailDto } from './dto/content-detail.dto';
import { ContentHistoryEntryDto } from './dto/content-history.dto';
import { ContentListItemDto } from './dto/content-list-item.dto';
import { ContentQueryDto, ContentVisibility } from './dto/content-query.dto';
import { CreateContentDto } from './dto/create-content.dto';
import { ContentSaveAction, SaveContentDto } from './dto/save-content.dto';

@Injectable()
export class ContentService {
  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly contentGitService: ContentGitService,
  ) {}

  private buildContentId(): string {
    return `ci_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  private toChangeLogDto(changeLog: ContentChangeLog): ChangeLogDto {
    return ChangeLogDto.fromEntity(changeLog);
  }

  private buildVersionSnapshot(
    commitHash: string,
    title: string,
    summary?: string,
  ): ContentVersion {
    return {
      commitHash,
      title,
      summary,
    };
  }

  private resolveLatestVersion(content: ContentItem): ContentVersion {
    if (content.latestVersion) {
      return content.latestVersion;
    }

    throw new BadRequestException(
      `Content ${content.id} does not have a latest formal version`,
    );
  }

  private resolvePublishedVersion(content: ContentItem): ContentVersion | null {
    if (content.publishedVersion) {
      return content.publishedVersion;
    }

    return null;
  }

  private toListItemDto(
    content: ContentItem,
    options?: { publicView?: boolean },
  ): ContentListItemDto {
    const latestVersion = this.resolveLatestVersion(content);
    const publishedVersion = this.resolvePublishedVersion(content);
    const normalizedStatus = publishedVersion
      ? ContentStatus.published
      : ContentStatus.committed;
    const title =
      options?.publicView && publishedVersion
        ? publishedVersion.title
        : latestVersion.title;
    const summary =
      options?.publicView && publishedVersion
        ? publishedVersion.summary
        : latestVersion.summary;

    return {
      id: content.id,
      title,
      summary,
      status: normalizedStatus,
      latestVersion,
      publishedVersion,
      latestCommitHash: latestVersion.commitHash,
      publishedCommitHash: publishedVersion?.commitHash,
      hasUnpublishedChanges:
        !!publishedVersion &&
        latestVersion.commitHash !== publishedVersion.commitHash,
      latestChange: content.changeLogs[0]
        ? this.toChangeLogDto(content.changeLogs[0])
        : undefined,
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString(),
    };
  }

  private toAssetRefDtos(
    assetRefs: { path: string; type: ContentAssetRefDto['type'] }[],
  ): ContentAssetRefDto[] {
    return assetRefs.map((assetRef) => ({
      path: assetRef.path,
      type: assetRef.type,
    }));
  }

  private buildChangeLog(
    title: string,
    summary: string | undefined,
    note: string,
    type: ContentChangeType | undefined,
    createdAt: Date,
    commitHash?: string,
  ): ContentChangeLog {
    return {
      commitHash,
      title,
      summary,
      createdAt,
      changeType: type ?? ContentChangeType.patch,
      changeNote: note,
    };
  }

  private isPublished(content: ContentItem): boolean {
    return !!this.resolvePublishedVersion(content);
  }

  private isReadableInQuery(
    content: ContentItem,
    query?: ContentQueryDto,
  ): boolean {
    if (query?.visibility === ContentVisibility.all) {
      if (!query.status) {
        return true;
      }

      if (query.status === ContentStatus.published) {
        return this.isPublished(content);
      }

      if (query.status === ContentStatus.committed) {
        return !this.isPublished(content);
      }

      return false;
    }

    return this.isPublished(content);
  }

  private enforceActionStateTransition(
    current: ContentItem,
    action: ContentSaveAction | undefined,
  ): void {
    if (!action) {
      return;
    }

    const currentStatus = this.isPublished(current)
      ? ContentStatus.published
      : ContentStatus.committed;

    if (
      action === ContentSaveAction.publish &&
      currentStatus !== ContentStatus.committed &&
      !(
        currentStatus === ContentStatus.published &&
        this.resolveLatestVersion(current).commitHash !==
          this.resolvePublishedVersion(current)?.commitHash
      )
    ) {
      throw new BadRequestException(
        'Only committed content or published content with newer committed changes can be published',
      );
    }

    if (
      action === ContentSaveAction.unpublish &&
      currentStatus !== ContentStatus.published
    ) {
      throw new BadRequestException(
        'Only published content can be unpublished',
      );
    }
  }

  private toDetailDto(
    content: ContentItem,
    source: Awaited<ReturnType<ContentRepoService['readContentSource']>>,
    options?: { publicView?: boolean },
  ): ContentDetailDto {
    const latestVersion = this.resolveLatestVersion(content);
    const publishedVersion = this.resolvePublishedVersion(content);
    const normalizedStatus = publishedVersion
      ? ContentStatus.published
      : ContentStatus.committed;
    const title =
      options?.publicView && publishedVersion
        ? publishedVersion.title
        : latestVersion.title;
    const summary =
      options?.publicView && publishedVersion
        ? publishedVersion.summary
        : latestVersion.summary;

    return {
      id: content.id,
      title,
      summary,
      status: normalizedStatus,
      latestVersion,
      publishedVersion,
      latestCommitHash: latestVersion.commitHash,
      publishedCommitHash: publishedVersion?.commitHash,
      hasUnpublishedChanges:
        !!publishedVersion &&
        latestVersion.commitHash !== publishedVersion.commitHash,
      bodyMarkdown: source.bodyMarkdown,
      plainText: source.plainText,
      assetRefs: this.toAssetRefDtos(source.assetRefs),
      changeLogs: content.changeLogs.map((changeLog) =>
        this.toChangeLogDto(changeLog),
      ),
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString(),
    };
  }

  async createContent(dto: CreateContentDto): Promise<ContentDetailDto> {
    const now = new Date();
    const id = this.buildContentId();
    const summary = dto.summary;
    const initialChange = this.buildChangeLog(
      dto.title,
      summary,
      dto.changeNote?.trim() || 'Initial content creation',
      dto.changeType,
      now,
    );

    // Formal content writes must switch to the internal work branch before any
    // file changes happen, otherwise runtime saves would dirty main even if
    // only explicit Commit actions later create Git commits.
    await this.contentGitService.prepareWritableWorkspace();

    // 初始正文允许为空（管理端新建 DOC 节点时尚无内容），用零宽空格占位以满足
    // writeMainMarkdown 的非空校验。编辑器首次保存时会覆盖该占位符。
    const body = dto.bodyMarkdown || '\u200B';

    // Write the Markdown source before persisting metadata so the database
    // never points at a content item whose canonical file source is missing.
    await this.contentRepoService.writeMainMarkdown(id, body);

    // README 在 commit 之前写入，确保随 main.md 一起进入 Git commit
    const preCommitSource = await this.contentRepoService.readContentSource(id);
    const tempContent = {
      id,
      _id: id,
      latestVersion: { commitHash: '', title: dto.title, summary },
      changeLogs: [initialChange],
      createdAt: now,
      updatedAt: now,
    } as ContentItem;
    await this.contentRepoService.writeReadme(tempContent, preCommitSource.assetRefs);

    const initialCommitHash =
      await this.contentGitService.recordCommittedContentChange(
        id,
        initialChange.changeNote,
      );

    if (!initialCommitHash) {
      throw new BadRequestException(
        'Failed to create the initial formal content version',
      );
    }

    const initialVersion = this.buildVersionSnapshot(
      initialCommitHash,
      dto.title,
      summary,
    );
    const content = await this.contentRepository.create({
      id,
      latestVersion: initialVersion,
      publishedVersion:
        dto.status === ContentStatus.published ? initialVersion : null,
      changeLogs: [
        {
          ...initialChange,
          commitHash: initialCommitHash,
        },
      ],
      createdAt: now,
      updatedAt: now,
      createdBy: dto.createdBy,
      updatedBy: dto.createdBy,
    });

    const source = await this.contentRepoService.readContentSource(id);

    return this.toDetailDto(content, source);
  }

  async saveContent(
    id: string,
    dto: SaveContentDto,
  ): Promise<ContentDetailDto> {
    const current = await this.contentRepository.findById(id);
    if (!current) {
      throw new NotFoundException(`Content ${id} not found`);
    }

    const now = new Date();
    this.enforceActionStateTransition(current, dto.action);
    await this.contentGitService.prepareWritableWorkspace();

    if (dto.action === ContentSaveAction.commit || !dto.action) {
      // Only version-forming actions write the canonical Markdown source.
      // Publish and Unpublish are visibility transitions and must not rewrite
      // the latest committed files from a stale formal-content view.
      await this.contentRepoService.writeMainMarkdown(id, dto.bodyMarkdown);
    }

    const nextChangeLogs = [
      this.buildChangeLog(
        dto.title,
        dto.summary,
        dto.changeNote,
        dto.changeType,
        now,
      ),
      ...current.changeLogs,
    ].slice(0, 20);

    let nextLatestVersion = this.resolveLatestVersion(current);
    let nextPublishedVersion = this.resolvePublishedVersion(current);

    // README 在 commit 之前写入，确保随内容一起进入 Git commit
    const preCommitSource = await this.contentRepoService.readContentSource(id);
    // toObject() 把 Mongoose document 转为普通 JS 对象，
    // 否则 _id / createdAt 等字段在 spread 时均为 undefined
    const preCommitContent = {
      ...current.toObject(),
      latestVersion: {
        commitHash: this.resolveLatestVersion(current).commitHash,
        title: dto.title,
        summary: dto.summary,
      },
      changeLogs: nextChangeLogs,
    } as ContentItem;
    await this.contentRepoService.writeReadme(preCommitContent, preCommitSource.assetRefs);

    if (dto.action === ContentSaveAction.commit) {
      const committedHash =
        await this.contentGitService.recordCommittedContentChange(
          current.id,
          dto.changeNote,
        );
      if (committedHash) {
        nextLatestVersion = this.buildVersionSnapshot(
          committedHash,
          dto.title,
          dto.summary,
        );
        nextChangeLogs[0] = {
          ...nextChangeLogs[0],
          commitHash: committedHash,
        };
      }
    }

    if (dto.action === ContentSaveAction.publish) {
      nextPublishedVersion = { ...nextLatestVersion };
    }

    if (dto.action === ContentSaveAction.unpublish) {
      nextPublishedVersion = null;
    }

    if (!dto.action) {
      nextLatestVersion = this.buildVersionSnapshot(
        nextLatestVersion.commitHash,
        dto.title,
        dto.summary,
      );
    }

    const updated = await this.contentRepository.update(id, {
      latestVersion: nextLatestVersion,
      publishedVersion: nextPublishedVersion,
      changeLogs: nextChangeLogs,
      updatedAt: now,
      updatedBy: dto.updatedBy,
    });

    if (!updated) {
      throw new NotFoundException(`Content ${id} not found`);
    }

    const source = await this.contentRepoService.readContentSource(id);

    return this.toDetailDto(updated, source);
  }

  async getContentById(
    id: string,
    query?: ContentQueryDto,
  ): Promise<ContentDetailDto> {
    const content = await this.contentRepository.findById(id);
    if (!content) {
      throw new NotFoundException(`Content ${id} not found`);
    }
    if (!this.isReadableInQuery(content, query)) {
      throw new NotFoundException(`Content ${id} not found`);
    }

    const publicView = query?.visibility !== ContentVisibility.all;
    const publishedVersion = this.resolvePublishedVersion(content);
    const source = await this.contentRepoService.readContentSource(id, {
      commitHash:
        publicView && publishedVersion
          ? publishedVersion.commitHash
          : undefined,
    });
    return this.toDetailDto(content, source, {
      publicView,
    });
  }

  async getContentByVersion(
    id: string,
    commitHash: string,
  ): Promise<ContentDetailDto> {
    const content = await this.contentRepository.findById(id);
    if (!content) {
      throw new NotFoundException(`Content ${id} not found`);
    }

    const source = await this.contentRepoService.readContentSource(id, {
      commitHash,
    });

    return this.toDetailDto(content, source);
  }

  async getContentHistory(id: string): Promise<ContentHistoryEntryDto[]> {
    await this.assertContentItemExists(id);
    return this.contentGitService.listContentHistory(id);
  }

  async listContents(query: ContentQueryDto): Promise<ContentListItemDto[]> {
    const keyword = query.q?.trim().toLowerCase();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    if (!keyword) {
      const contents = await this.contentRepository.list({ page, pageSize });
      return contents
        .filter((content) => this.isReadableInQuery(content, query))
        .map((content) =>
          this.toListItemDto(content, {
            publicView: query.visibility !== ContentVisibility.all,
          }),
        );
    }

    const contents = await this.contentRepository.listAll();
    const matched = contents.filter((content) => {
      if (!this.isReadableInQuery(content, query)) {
        return false;
      }

      const latestVersion = this.resolveLatestVersion(content);
      const publishedVersion = this.resolvePublishedVersion(content);
      const title =
        query.visibility !== ContentVisibility.all && publishedVersion
          ? publishedVersion.title
          : latestVersion.title;
      const summary =
        query.visibility !== ContentVisibility.all && publishedVersion
          ? publishedVersion.summary
          : latestVersion.summary;
      return `${title} ${summary}`.toLowerCase().includes(keyword);
    });

    return matched
      .slice((page - 1) * pageSize, page * pageSize)
      .map((content) =>
        this.toListItemDto(content, {
          publicView: query.visibility !== ContentVisibility.all,
        }),
      );
  }

  async searchContents(query: ContentQueryDto): Promise<ContentListItemDto[]> {
    const contents = (await this.contentRepository.listAll()).filter(
      (content) => this.isReadableInQuery(content, query),
    );
    const keyword = query.q?.trim().toLowerCase();

    if (!keyword) {
      return contents.map((content) =>
        this.toListItemDto(content, {
          publicView: query.visibility !== ContentVisibility.all,
        }),
      );
    }

    const matched: ContentItem[] = [];
    for (const content of contents) {
      const latestVersion = this.resolveLatestVersion(content);
      const publishedVersion = this.resolvePublishedVersion(content);
      const title =
        query.visibility !== ContentVisibility.all && publishedVersion
          ? publishedVersion.title
          : latestVersion.title;
      const summary =
        query.visibility !== ContentVisibility.all && publishedVersion
          ? publishedVersion.summary
          : latestVersion.summary;
      const basicHaystack = `${title} ${summary}`.toLowerCase();
      if (basicHaystack.includes(keyword)) {
        matched.push(content);
        continue;
      }

      // Title and summary stay as the cheap first-pass filter. Only when those
      // miss do we read canonical Markdown and search its extracted plain text.
      const source = await this.contentRepoService.readContentSource(
        content.id,
      );
      if (source.plainText.toLowerCase().includes(keyword)) {
        matched.push(content);
      }
    }

    return matched.map((content) =>
      this.toListItemDto(content, {
        publicView: query.visibility !== ContentVisibility.all,
      }),
    );
  }

  async getHome(): Promise<{
    hero: ContentListItemDto | null;
    featured: ContentListItemDto[];
    latest: ContentListItemDto[];
  }> {
    const contents = (
      await this.contentRepository.list({
        page: 1,
        pageSize: 12,
      })
    ).filter((content) => this.isPublished(content));
    const items = contents.map((content) =>
      this.toListItemDto(content, { publicView: true }),
    );

    return {
      hero: items[0] ?? null,
      featured: items.slice(1, 4),
      latest: items.slice(0, 6),
    };
  }

  /**
   * 按 ID 获取单个内容的列表项 DTO（含 latestVersion/publishedVersion）。
   * 供 NoteViewService 在列表场景复用，避免读取 Git 源文件的开销。
   */
  async getContentListItem(id: string): Promise<ContentListItemDto> {
    const content = await this.contentRepository.findById(id);
    if (!content) {
      throw new NotFoundException(`Content ${id} not found`);
    }
    return this.toListItemDto(content);
  }

  async assertContentItemExists(id: string): Promise<void> {
    const content = await this.contentRepository.findById(id);
    if (!content) {
      throw new NotFoundException(`Content ${id} not found`);
    }
  }

  async assertContentEditable(id: string): Promise<void> {
    const content = await this.contentRepository.findById(id);
    if (!content) {
      throw new NotFoundException(`Content ${id} not found`);
    }
  }

  async prepareWritableContentWorkspace(): Promise<void> {
    await this.contentGitService.prepareWritableWorkspace();
  }

  async isContentItemReadable(
    id: string,
    visibility?: ContentVisibility,
  ): Promise<boolean> {
    const content = await this.contentRepository.findById(id);
    if (!content) {
      return false;
    }

    if (visibility === ContentVisibility.all) {
      return true;
    }

    return this.isPublished(content);
  }
}
