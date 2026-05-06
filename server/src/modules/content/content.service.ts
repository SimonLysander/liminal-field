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
import { ContentDetailDto } from './dto/content-detail.dto';
import { extractHeadings } from '../../common/extract-headings';
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
    publishCommitHash?: string,
  ): void {
    if (!action) {
      return;
    }

    const currentStatus = this.isPublished(current)
      ? ContentStatus.published
      : ContentStatus.committed;

    if (action === ContentSaveAction.publish) {
      /* 从未提交过（commitHash 为空）→ 不能发布 */
      const latestHash = this.resolveLatestVersion(current).commitHash;
      if (!latestHash) {
        throw new BadRequestException(
          'Cannot publish: no committed version exists yet',
        );
      }
      /* 已发布且无新变更 → 不能重复发布（指定历史 commitHash 除外） */
      if (
        !publishCommitHash &&
        currentStatus !== ContentStatus.committed &&
        !(
          currentStatus === ContentStatus.published &&
          latestHash !== this.resolvePublishedVersion(current)?.commitHash
        )
      ) {
        throw new BadRequestException(
          'Only committed content or published content with newer committed changes can be published',
        );
      }
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
    source: { bodyMarkdown: string },
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
      hasUnpublishedChanges:
        !!publishedVersion &&
        latestVersion.commitHash !== publishedVersion.commitHash,
      bodyMarkdown: source.bodyMarkdown,
      // 后端提取标题树，前端直接消费，不再自行解析 markdown
      headings: extractHeadings(source.bodyMarkdown),
      changeLogs: content.changeLogs.map((changeLog) =>
        this.toChangeLogDto(changeLog),
      ),
      createdAt: content.createdAt.toISOString(),
      updatedAt: content.updatedAt.toISOString(),
    };
  }

  /**
   * 创建内容条目：只建 MongoDB 记录，不写 Git。
   *
   * 第一次真正的 saveContent(action=commit) 才会写 main.md + git commit，
   * 版本链从第一次业务提交开始，没有空的"创建"节点。
   */
  async createContent(dto: CreateContentDto): Promise<ContentDetailDto> {
    const now = new Date();
    const id = this.buildContentId();
    const summary = dto.summary || dto.title;

    const content = await this.contentRepository.create({
      id,
      latestVersion: { commitHash: '', title: dto.title, summary },
      publishedVersion: null,
      changeLogs: [],
      createdAt: now,
      updatedAt: now,
      createdBy: dto.createdBy,
      updatedBy: dto.createdBy,
    });

    return this.toDetailDto(content, { bodyMarkdown: '' });
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
    const summary = dto.summary || '';
    this.enforceActionStateTransition(
      current,
      dto.action,
      dto.publishCommitHash,
    );
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
        summary,
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
    const plainContent = (current as { toObject(): ContentItem }).toObject();
    const preCommitContent = {
      ...plainContent,
      latestVersion: {
        commitHash: this.resolveLatestVersion(current).commitHash,
        title: dto.title,
        summary,
      },
      changeLogs: nextChangeLogs,
    } as ContentItem;
    await this.contentRepoService.writeReadme(
      preCommitContent,
      preCommitSource.assetRefs,
    );

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
          summary,
        );
        nextChangeLogs[0] = {
          ...nextChangeLogs[0],
          commitHash: committedHash,
        };
      }
    }

    if (dto.action === ContentSaveAction.publish) {
      /*
       * 发布指定版本：dto.publishCommitHash 指定历史 commitHash，
       * 直接把 publishedVersion 指向该版本，不产生新提交。
       * 未指定时默认发布 latestVersion（兼容原行为）。
       */
      const targetHash = dto.publishCommitHash ?? nextLatestVersion.commitHash;
      nextPublishedVersion = this.buildVersionSnapshot(
        targetHash,
        nextLatestVersion.title,
        nextLatestVersion.summary ?? '',
      );
    }

    if (dto.action === ContentSaveAction.unpublish) {
      nextPublishedVersion = null;
    }

    if (!dto.action) {
      nextLatestVersion = this.buildVersionSnapshot(
        nextLatestVersion.commitHash,
        dto.title,
        summary,
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

  /**
   * 发布指定版本：纯指针操作，publishedVersion 指向目标 commitHash。
   * 不走 saveContent 流程，不写 Git，不生成 changeLog。
   * @param commitHash 可选，不传则发布 latestVersion。
   *
   * 发布历史版本时，title/summary 从 changeLogs 中查找对应记录，
   * 而不是直接用 latestVersion.title，避免"发布 A 版本却显示 B 版本标题"。
   */
  async publishVersion(id: string, commitHash?: string): Promise<void> {
    const content = await this.contentRepository.findById(id);
    if (!content) throw new NotFoundException(`Content ${id} not found`);

    const latestVersion = this.resolveLatestVersion(content);
    if (!latestVersion.commitHash) {
      throw new BadRequestException(
        'Cannot publish: no committed version exists yet',
      );
    }

    const targetHash = commitHash ?? latestVersion.commitHash;

    // 发布历史版本时，从 changeLogs 中找到该版本对应的 title/summary，
    // 避免用 latestVersion 的元数据覆盖历史版本的真实标题。
    const changeLog = commitHash
      ? content.changeLogs.find((c) => c.commitHash === commitHash)
      : null;
    const title = changeLog?.title ?? latestVersion.title;
    const summary = changeLog?.summary ?? latestVersion.summary ?? '';

    const publishedVersion = this.buildVersionSnapshot(
      targetHash,
      title,
      summary,
    );

    await this.contentRepository.update(id, {
      latestVersion,
      publishedVersion,
      changeLogs: content.changeLogs,
      updatedAt: new Date(),
    });
  }

  /**
   * 取消发布：清除 publishedVersion 指针。
   * 不走 saveContent 流程，不写 Git。
   */
  async unpublishVersion(id: string): Promise<void> {
    const content = await this.contentRepository.findById(id);
    if (!content) throw new NotFoundException(`Content ${id} not found`);

    const publishedVersion = this.resolvePublishedVersion(content);
    if (!publishedVersion) {
      throw new BadRequestException('Content is not published');
    }

    await this.contentRepository.update(id, {
      latestVersion: this.resolveLatestVersion(content),
      publishedVersion: null,
      changeLogs: content.changeLogs,
      updatedAt: new Date(),
    });
  }

  async getContentById(
    id: string,
    query?: ContentQueryDto,
    options?: { scope?: string },
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
      scope: options?.scope,
    });
    return this.toDetailDto(content, source, {
      publicView,
    });
  }

  async getContentByVersion(
    id: string,
    commitHash: string,
    options?: { scope?: string },
  ): Promise<ContentDetailDto> {
    const content = await this.contentRepository.findById(id);
    if (!content) {
      throw new NotFoundException(`Content ${id} not found`);
    }

    const source = await this.contentRepoService.readContentSource(id, {
      commitHash,
      scope: options?.scope,
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

    // 标题/摘要搜索下推到 MongoDB $regex，避免全量加载到内存
    const contents = await this.contentRepository.searchByKeyword(keyword, {
      page,
      pageSize,
    });
    return contents
      .filter((content) => this.isReadableInQuery(content, query))
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

  /**
   * 校验内容存在且可编辑。
   * 当前为单用户系统，可编辑条件 = 存在即可编。
   * 未来如需归档/锁定等状态限制，在此方法中扩展。
   */
  async assertContentEditable(id: string): Promise<void> {
    await this.assertContentItemExists(id);
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
