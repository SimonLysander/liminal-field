import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';
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
import { ContentSnapshotRepository } from './content-snapshot.repository';
import { OssService } from '../oss/oss.service';
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
  private readonly logger = new Logger(ContentService.name);

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentRepoService: ContentRepoService,
    private readonly contentGitService: ContentGitService,
    private readonly snapshotRepository: ContentSnapshotRepository,
    private readonly ossService: OssService,
  ) {}

  private buildContentId(): string {
    return `ci_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }

  /** V2: 生成版本标识符，不依赖 Git commitHash，snapshot 创建即可用 */
  private generateVersionId(): string {
    return nanoid(16);
  }

  private toChangeLogDto(changeLog: ContentChangeLog): ChangeLogDto {
    return ChangeLogDto.fromEntity(changeLog);
  }

  private buildVersionSnapshot(
    commitHash: string,
    title: string,
    summary?: string,
    versionId?: string,
  ): ContentVersion {
    return {
      versionId,
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
      // V2 Phase 3: 用 versionId 比较，commitHash 可能还在异步回填中，versionId 写入即可用
      hasUnpublishedChanges:
        !!publishedVersion &&
        latestVersion.versionId !== publishedVersion.versionId,
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
      /* V2: 从未提交过（无 versionId）→ 不能发布。commitHash 可能异步回填中，用 versionId 判断。 */
      const latestVid = this.resolveLatestVersion(current).versionId;
      if (!latestVid) {
        throw new BadRequestException(
          'Cannot publish: no committed version exists yet',
        );
      }
      /* 已发布且无新变更 → 不能重复发布（指定历史 commitHash 除外）
       * V2: 用 versionId 比较替代 commitHash（后者可能异步回填中）。 */
      if (
        !publishCommitHash &&
        currentStatus !== ContentStatus.committed &&
        !(
          currentStatus === ContentStatus.published &&
          latestVid !== this.resolvePublishedVersion(current)?.versionId
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
      // V2 Phase 3: 用 versionId 比较，commitHash 可能还在异步回填中，versionId 写入即可用
      hasUnpublishedChanges:
        !!publishedVersion &&
        latestVersion.versionId !== publishedVersion.versionId,
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
    const versionId = this.generateVersionId();

    // V2: 创建时即生成初始快照（空正文），确保 getContentById 始终能查到 snapshot
    await this.snapshotRepository.create({
      versionId,
      contentItemId: id,
      title: dto.title,
      summary,
      bodyMarkdown: '',
      assetRefs: [],
      createdAt: now,
      changeNote: '',
    });

    const content = await this.contentRepository.create({
      id,
      latestVersion: { versionId, commitHash: '', title: dto.title, summary },
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

    // V2 Phase 3: prepareWritableWorkspace 移入 archiveToGit，不再阻塞请求
    // publish/unpublish 不写 Git，无需调用

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

    // V2 Phase 3: 先写 MongoDB（同步），Git 后台异步归档
    if (dto.action === ContentSaveAction.commit) {
      const versionId = this.generateVersionId();

      // commitHash 待异步回填，先用空字符串占位
      nextLatestVersion = this.buildVersionSnapshot(
        '',
        dto.title,
        summary,
        versionId,
      );

      // V2: 创建版本快照，公开读取将从此处读取而非 git show
      await this.snapshotRepository.create({
        versionId,
        contentItemId: id,
        title: dto.title,
        summary,
        bodyMarkdown: dto.bodyMarkdown,
        assetRefs: this.contentRepoService
          .extractAssetRefs(dto.bodyMarkdown)
          .map((ref) => ref.path),
        createdAt: now,
        changeNote: dto.changeNote ?? '',
        // commitHash 有意省略——异步回填
      });

      // 异步归档到 Git，不阻塞请求；错误由 archiveToGit 内部捕获并记录日志
      void this.archiveToGit(
        id,
        versionId,
        dto.bodyMarkdown,
        dto.changeNote ?? '',
        dto.title,
        summary,
        nextChangeLogs,
      );
    }

    if (dto.action === ContentSaveAction.publish) {
      /*
       * 发布指定版本：dto.publishCommitHash 指定历史 commitHash，
       * 直接把 publishedVersion 指向该版本，不产生新提交。
       * 未指定时默认发布 latestVersion（兼容原行为）。
       * V2: 继承 latestVersion.versionId 或按 commitHash 查找对应 snapshot。
       */
      const targetHash = dto.publishCommitHash ?? nextLatestVersion.commitHash;
      let targetVersionId = nextLatestVersion.versionId;
      if (dto.publishCommitHash) {
        const snapshots = await this.snapshotRepository.listByContentItemId(id);
        const matched = snapshots.find(
          (s) => s.commitHash === dto.publishCommitHash,
        );
        targetVersionId = matched?.versionId;
      }
      nextPublishedVersion = this.buildVersionSnapshot(
        targetHash,
        nextLatestVersion.title,
        nextLatestVersion.summary ?? '',
        targetVersionId,
      );
    }

    if (dto.action === ContentSaveAction.unpublish) {
      nextPublishedVersion = null;
    }

    // V2 Phase 3: 无 action 的保存（草稿写入），同样先写 MongoDB，再异步写磁盘
    if (!dto.action) {
      const versionId = this.generateVersionId();
      nextLatestVersion = this.buildVersionSnapshot(
        nextLatestVersion.commitHash,
        dto.title,
        summary,
        versionId,
      );

      // V2: 无 action 的保存也创建快照（写入 Markdown 但不产生 git commit）
      await this.snapshotRepository.create({
        versionId,
        contentItemId: id,
        title: dto.title,
        summary,
        bodyMarkdown: dto.bodyMarkdown,
        assetRefs: this.contentRepoService
          .extractAssetRefs(dto.bodyMarkdown)
          .map((ref) => ref.path),
        createdAt: now,
        changeNote: dto.changeNote ?? '',
      });

      // no-action 保存不产生 git commit，但仍写磁盘供后续 commit 使用
      void this.archiveMarkdownToDisk(id, dto.bodyMarkdown).catch(
        (err: unknown) => {
          this.logger.warn(
            `archiveMarkdownToDisk failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        },
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

    // V2 Phase 3: 响应从 snapshot 构建，不再走 Git 磁盘
    let responseMarkdown = '';
    if (dto.action === ContentSaveAction.commit || !dto.action) {
      // 刚写入的正文直接从 DTO 取，避免再查一次 DB
      responseMarkdown = dto.bodyMarkdown;
    } else {
      // publish/unpublish：从 latestVersion 对应的 snapshot 读取
      const latestVid = updated.latestVersion?.versionId;
      if (latestVid) {
        const snap = await this.snapshotRepository.findByVersionId(latestVid);
        responseMarkdown = snap?.bodyMarkdown ?? '';
      }
    }

    return this.toDetailDto(updated, { bodyMarkdown: responseMarkdown });
  }

  /**
   * V2 Phase 3: 异步归档到 Git（fire-and-forget）。
   *
   * 在 MongoDB 写入成功后后台执行，不阻塞 HTTP 请求。
   * 完成后回填 commitHash 到 ContentSnapshot 和 ContentItem。
   * 失败时仅记录日志，snapshot.commitHash 保持为空（可被定时任务重试）。
   */
  private async archiveToGit(
    contentId: string,
    versionId: string,
    bodyMarkdown: string,
    changeNote: string,
    title: string,
    summary: string,
    changeLogs: ContentChangeLog[],
  ): Promise<void> {
    try {
      await this.contentGitService.prepareWritableWorkspace();
      await this.contentRepoService.writeMainMarkdown(contentId, bodyMarkdown);

      // README 需要 content 信息，从 MongoDB 重新读取，确保拿到最新数据
      const content = await this.contentRepository.findById(contentId);
      if (content) {
        const assetRefs =
          this.contentRepoService.extractAssetRefs(bodyMarkdown);
        // toObject() 把 Mongoose document 转为普通 JS 对象，
        // 否则 _id / createdAt 等字段在 spread 时均为 undefined
        const plainContent = (
          content as { toObject(): ContentItem }
        ).toObject();
        await this.contentRepoService.writeReadme(
          {
            ...plainContent,
            latestVersion: { commitHash: '', title, summary, versionId },
            changeLogs,
          } as ContentItem,
          assetRefs,
        );
      }

      const committedHash =
        await this.contentGitService.recordCommittedContentChange(
          contentId,
          changeNote,
        );

      if (committedHash) {
        // 回填 commitHash 到 ContentSnapshot
        await this.snapshotRepository.backfillCommitHash(
          versionId,
          committedHash,
        );

        // 回填 commitHash 到 ContentItem 的 latestVersion 和 changeLogs
        const current = await this.contentRepository.findById(contentId);
        if (current?.latestVersion?.versionId === versionId) {
          const updatedChangeLogs = current.changeLogs.map((log, index) => {
            // 最新 changeLog（index 0）尚无 commitHash，对应本次 Git commit
            if (index === 0 && !log.commitHash) {
              return { ...log, commitHash: committedHash };
            }
            return log;
          });

          // Mongoose 子文档 spread 会丢字段，用 JSON 序列化确保提取所有字段（含 versionId）
          const latestPlain = JSON.parse(
            JSON.stringify(current.latestVersion),
          ) as Record<string, unknown>;
          await this.contentRepository.update(contentId, {
            latestVersion: {
              ...latestPlain,
              commitHash: committedHash,
            } as ContentVersion,
            publishedVersion: current.publishedVersion ?? null,
            changeLogs: updatedChangeLogs,
            updatedAt: current.updatedAt,
          });
        }
      }

      this.logger.log(
        `Git archived: ${contentId} → ${committedHash ?? 'no-change'}`,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `archiveToGit failed for ${contentId}/${versionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // 不抛出——snapshot.commitHash 保持为空，可被定时任务重试
    }
  }

  /** 仅写 main.md 到磁盘，不做 git commit（供后续 commit 时使用）。 */
  private async archiveMarkdownToDisk(
    contentId: string,
    bodyMarkdown: string,
  ): Promise<void> {
    await this.contentRepoService.writeMainMarkdown(contentId, bodyMarkdown);
  }

  /**
   * V2 发布：publishedVersion 指向目标 snapshot（纯指针操作，不写 Git）。
   * @param versionId 可选 nanoid，不传则发布 latestVersion。
   */
  async publishVersion(id: string, versionId?: string): Promise<void> {
    const content = await this.contentRepository.findById(id);
    if (!content) throw new NotFoundException(`Content ${id} not found`);

    const latestVersion = this.resolveLatestVersion(content);
    if (!latestVersion.versionId) {
      throw new BadRequestException(
        'Cannot publish: no committed version exists yet',
      );
    }

    // 目标 snapshot：不传 versionId 则发布最新版
    const targetVersionId = versionId ?? latestVersion.versionId!;
    const snapshot =
      await this.snapshotRepository.findByVersionId(targetVersionId);
    if (!snapshot) {
      throw new NotFoundException(
        `Version ${targetVersionId} not found`,
      );
    }

    const publishedVersion = this.buildVersionSnapshot(
      snapshot.commitHash ?? '',
      snapshot.title,
      snapshot.summary ?? '',
      targetVersionId,
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

    // V2: 从 ContentSnapshot 读取正文，不再走 Git show / fs.readFile。
    // 公开视图读已发布版本的快照，管理视图读最新版本的快照。
    const versionId = publicView
      ? content.publishedVersion?.versionId
      : content.latestVersion?.versionId;

    if (!versionId) {
      throw new NotFoundException(`Content ${id} has no snapshot`);
    }

    const snapshot = await this.snapshotRepository.findByVersionId(versionId);
    if (!snapshot) {
      throw new NotFoundException(
        `Snapshot ${versionId} not found for content ${id}`,
      );
    }

    // 将图片路径统一重写为新签名的 OSS URL（或代理 URL）。
    // 匹配两种存储格式：./assets/{fileName}（正常）和完整 OSS URL（历史脏数据）。
    const scope = options?.scope ?? 'notes';
    const useOss = this.ossService.isDraftStorageReady();
    const buildUrl = (fileName: string) => {
      if (useOss) {
        const url = this.ossService.getPublicUrl(
          `assets/${id}/${fileName}`,
          OssService.IMAGE_PRESETS.reading,
        );
        return url.includes('?')
          ? `${url}&v=${versionId}`
          : `${url}?v=${versionId}`;
      }
      return `/api/v1/spaces/${scope}/items/${id}/assets/${fileName}?v=${versionId}`;
    };
    const resolvedMarkdown = snapshot.bodyMarkdown
      // 正常格式：./assets/{fileName}
      .replaceAll(
        /\.\/assets\/([^)\s"]+)/g,
        (_match, fileName: string) => buildUrl(fileName),
      )
      // 脏数据兼容：完整 OSS 签名 URL（过期后需重新签名）
      .replaceAll(
        new RegExp(`https?://[^/]+/assets/${id}/([^?)\\s"]+)[^)\\s"]*`, 'g'),
        (_match, fileName: string) => buildUrl(fileName),
      );

    return this.toDetailDto(
      content,
      { bodyMarkdown: resolvedMarkdown },
      { publicView },
    );
  }

  /**
   * V2: 优先从 ContentSnapshot 读取历史版本，Git 作为 fallback。
   * versionOrHash 可以是 versionId（nanoid）或 commitHash（git sha）。
   */
  async getContentByVersion(
    id: string,
    versionOrHash: string,
    options?: { scope?: string },
  ): Promise<ContentDetailDto> {
    const content = await this.contentRepository.findById(id);
    if (!content) {
      throw new NotFoundException(`Content ${id} not found`);
    }

    // 优先按 versionId 查 snapshot
    let snapshot = await this.snapshotRepository.findByVersionId(versionOrHash);

    // 找不到则按 commitHash 在 snapshot 表中反查
    if (!snapshot) {
      const snapshots = await this.snapshotRepository.listByContentItemId(id);
      snapshot = snapshots.find((s) => s.commitHash === versionOrHash) ?? null;
    }

    if (snapshot) {
      return this.toDetailDto(content, {
        bodyMarkdown: snapshot.bodyMarkdown,
        plainText: snapshot.bodyMarkdown.replace(/[#*_\[\]()>`~\\|]/g, ''),
      });
    }

    // 最终 fallback：Git（兼容旧数据）
    const source = await this.contentRepoService.readContentSource(id, {
      commitHash: versionOrHash,
      scope: options?.scope,
    });
    return this.toDetailDto(content, source);
  }

  /**
   * V2 版本历史：从 ContentSnapshot 读取，不依赖 Git log。
   * 每个 snapshot 即一个版本条目，commitHash 可能为空（异步归档未完成）。
   */
  async getContentHistory(id: string): Promise<ContentHistoryEntryDto[]> {
    const content = await this.contentRepository.findById(id);
    if (!content) throw new NotFoundException(`Content ${id} not found`);

    const snapshots = await this.snapshotRepository.listByContentItemId(id);

    return snapshots.map((snap) => {
      // 从 changeLogs 中匹配该 snapshot 的变更说明
      const log = content.changeLogs.find(
        (c) => c.createdAt.getTime() === snap.createdAt.getTime(),
      );
      return {
        versionId: snap.versionId,
        commitHash: snap.commitHash ?? '',
        committedAt: snap.createdAt.toISOString(),
        changeType: log?.changeType ?? 'patch',
        changeNote: log?.changeNote ?? snap.changeNote ?? '',
        title: snap.title,
      };
    });
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

  /**
   * 全局搜索：标题/摘要 + 正文全文，全部下推到 MongoDB。
   *
   * 两阶段搜索：先按标题/摘要匹配（$regex），再按 ContentSnapshot.bodyMarkdown
   * 匹配（aggregation），合并去重。避免全量加载内存和逐条读磁盘。
   */
  async searchContents(query: ContentQueryDto): Promise<ContentListItemDto[]> {
    const keyword = query.q?.trim();
    const pageSize = query.pageSize ?? 20;
    const publicView = query.visibility !== ContentVisibility.all;

    if (!keyword) {
      const contents = await this.contentRepository.list({
        page: query.page,
        pageSize,
      });
      return contents
        .filter((content) => this.isReadableInQuery(content, query))
        .map((content) => this.toListItemDto(content, { publicView }));
    }

    // 阶段 1：标题/摘要搜索（MongoDB $regex）
    const titleMatches = await this.contentRepository.searchByKeyword(keyword, {
      page: 1,
      pageSize,
    });

    // 阶段 2：正文全文搜索（ContentSnapshot aggregation）
    const bodyMatchIds =
      await this.snapshotRepository.searchContentIdsByBodyKeyword(
        keyword,
        pageSize,
      );

    // 合并去重：标题匹配的 ID 集合 + 正文匹配的 ID 集合
    const seenIds = new Set(titleMatches.map((c) => c.id));
    const bodyOnlyIds = bodyMatchIds.filter((id) => !seenIds.has(id));

    // 补充加载正文匹配但标题未匹配的 ContentItem
    const bodyOnlyItems = await Promise.all(
      bodyOnlyIds.map((id) => this.contentRepository.findById(id)),
    );

    const allMatches = [
      ...titleMatches,
      ...bodyOnlyItems.filter((c): c is ContentItem => c !== null),
    ];

    return allMatches
      .filter((content) => this.isReadableInQuery(content, query))
      .slice(0, pageSize)
      .map((content) => this.toListItemDto(content, { publicView }));
  }

  /** 最近 N 条已发布内容（供首页使用）。 */
  async getPublishedLatest(limit: number): Promise<ContentListItemDto[]> {
    // 多取一些候选条目再过滤，避免 limit*2 内已发布条目不足的边缘情况
    const contents = (
      await this.contentRepository.list({ page: 1, pageSize: limit * 2 })
    ).filter((content) => this.isPublished(content));
    return contents
      .slice(0, limit)
      .map((content) => this.toListItemDto(content, { publicView: true }));
  }

  /** 已发布内容总数。 */
  async countPublished(): Promise<number> {
    return this.contentRepository.countPublished();
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
