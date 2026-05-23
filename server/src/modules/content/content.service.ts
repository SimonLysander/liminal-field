import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from 'nestjs-typegoose';
import { ReturnModelType } from '@typegoose/typegoose';
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
import { NavigationNode } from '../navigation/navigation.entity';
import { ChangeLogDto } from './dto/change-log.dto';
import { ContentDetailDto } from './dto/content-detail.dto';
import { extractHeadings } from '../../common/extract-headings';
import { ContentHistoryEntryDto } from './dto/content-history.dto';
import { ContentListItemDto } from './dto/content-list-item.dto';
import { ContentQueryDto, ContentVisibility } from './dto/content-query.dto';
import { SearchResultDto } from './dto/search-result.dto';
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
    @InjectModel(NavigationNode)
    private readonly navigationModel: ReturnModelType<typeof NavigationNode>,
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
      publishedAt: content.publishedAt?.toISOString() ?? null,
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
    options?: { publicView?: boolean; snapshotTitle?: string; snapshotSummary?: string },
  ): ContentDetailDto {
    const latestVersion = this.resolveLatestVersion(content);
    const publishedVersion = this.resolvePublishedVersion(content);
    const normalizedStatus = publishedVersion
      ? ContentStatus.published
      : ContentStatus.committed;
    /* 优先级：snapshot 覆盖 > publicView 用 publishedVersion > 默认 latestVersion */
    const title =
      options?.snapshotTitle !== undefined
        ? options.snapshotTitle
        : options?.publicView && publishedVersion
          ? publishedVersion.title
          : latestVersion.title;
    const summary =
      options?.snapshotSummary !== undefined
        ? options.snapshotSummary
        : options?.publicView && publishedVersion
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
      publishedAt: content.publishedAt?.toISOString() ?? null,
    };
  }

  /**
   * 导入创建内容：一次性创建 ContentItem + Snapshot（含 bodyMarkdown）。
   * 供 ImportService 调用，避免绕过版本管理协议直接操作底层 Repository。
   *
   * contentId 可由调用方提前传入（场景：调用前已用 contentId 执行磁盘写入/资源迁移），
   * 不传则内部自动生成。
   */
  async importContent(params: {
    contentId?: string;
    title: string;
    bodyMarkdown: string;
    changeNote: string;
    assetRefs?: string[];
    createdAt?: Date;
  }): Promise<{ contentId: string; versionId: string }> {
    const contentId = params.contentId ?? this.buildContentId();
    const versionId = this.generateVersionId();
    const now = params.createdAt ?? new Date();

    await this.snapshotRepository.create({
      versionId,
      contentItemId: contentId,
      title: params.title,
      summary: params.title,
      bodyMarkdown: params.bodyMarkdown,
      assetRefs: params.assetRefs ?? [],
      createdAt: now,
      changeNote: params.changeNote,
    });

    const changeLog = this.buildChangeLog(
      params.title,
      params.title,
      params.changeNote,
      ContentChangeType.major,
      now,
    );

    await this.contentRepository.create({
      id: contentId,
      latestVersion: {
        versionId,
        commitHash: '',
        title: params.title,
        summary: params.title,
      },
      publishedVersion: null,
      changeLogs: [changeLog],
      createdAt: now,
      updatedAt: now,
    });

    return { contentId, versionId };
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
    const summary = dto.summary ?? '';
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
      changeNote: '自动创建',
      source: 'system',
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
    const isSubFile = dto.fileName != null;

    if (dto.action === ContentSaveAction.commit) {
      const versionId = this.generateVersionId();

      // fileName 为 null（main.md）时更新 latestVersion，非 null（子文件）时不更新
      if (!isSubFile) {
        nextLatestVersion = this.buildVersionSnapshot(
          '',
          dto.title,
          summary,
          versionId,
        );
      }

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
        fileName: dto.fileName ?? null,
        ...(dto.source ? { source: dto.source } : {}),
        // commitHash 有意省略——异步回填
      });

      // 异步归档到 Git，不阻塞请求；错误由 archiveToGit 内部捕获并记录日志。
      // 主文件(main.md)与子文件(entries/*.md)都归档:传 fileName 让子文件按其路径
      // 写入,否则文集条目正文永远进不了 Git、恢复时丢失(历史踩坑)。
      void this.archiveToGit(
        id,
        versionId,
        dto.bodyMarkdown,
        dto.changeNote ?? '',
        dto.title,
        summary,
        nextChangeLogs,
        dto.fileName ?? null,
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

      if (!isSubFile) {
        nextLatestVersion = this.buildVersionSnapshot(
          nextLatestVersion.commitHash,
          dto.title,
          summary,
          versionId,
        );
      }

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
        fileName: dto.fileName ?? null,
        ...(dto.source ? { source: dto.source } : {}),
      });

      // no-action 保存不产生 git commit，但仍写磁盘供后续 commit 使用
      if (!isSubFile) {
        void this.archiveMarkdownToDisk(id, dto.bodyMarkdown).catch(
          (err: unknown) => {
            this.logger.warn(
              `archiveMarkdownToDisk failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          },
        );
      }
    }

    /* publishedAt 逻辑：发布时记录（首次），取消发布时清空 */
    let nextPublishedAt: Date | null | undefined;
    if (dto.action === ContentSaveAction.publish) {
      nextPublishedAt = current.publishedAt ?? now;
    } else if (dto.action === ContentSaveAction.unpublish) {
      nextPublishedAt = null;
    }

    const updated = await this.contentRepository.update(id, {
      latestVersion: nextLatestVersion,
      publishedVersion: nextPublishedVersion,
      changeLogs: nextChangeLogs,
      updatedAt: now,
      updatedBy: dto.updatedBy,
      ...(nextPublishedAt !== undefined && { publishedAt: nextPublishedAt }),
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
    fileName: string | null = null, // 子文件路径(如 entries/e001.md);null = 主文件 main.md
  ): Promise<void> {
    try {
      await this.contentGitService.prepareWritableWorkspace();

      if (fileName) {
        // 子文件(文集条目 entries/eXXX.md):只写该文件本身。
        // 不动 main.md / README / latestVersion——它们只由主文件提交维护,
        // 子文件正文与内容索引无关。历史踩坑:此处若漏写,条目正文永远进不了
        // Git,恢复时被丢弃(见 docs / CLAUDE.md「恢复丢结构」)。
        await this.contentRepoService.writeFileMarkdown(
          contentId,
          fileName,
          bodyMarkdown,
        );
      } else {
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
    const targetVersionId = versionId ?? latestVersion.versionId;
    const snapshot =
      await this.snapshotRepository.findByVersionId(targetVersionId);
    if (!snapshot) {
      throw new NotFoundException(`Version ${targetVersionId} not found`);
    }

    /* 发布最新版时，用 latestVersion 的 title/summary（可能被 patchMeta 更新过）；
     * 发布历史版本时，用快照自身的 title/summary。 */
    const isPublishingLatest = targetVersionId === latestVersion.versionId;
    const publishedVersion = this.buildVersionSnapshot(
      snapshot.commitHash ?? '',
      isPublishingLatest ? latestVersion.title : snapshot.title,
      isPublishingLatest ? (latestVersion.summary ?? '') : (snapshot.summary ?? ''),
      targetVersionId,
    );

    await this.contentRepository.update(id, {
      latestVersion,
      publishedVersion,
      changeLogs: content.changeLogs,
      updatedAt: new Date(),
      /* 首次发布记录时间，已有则保留（重新发布不刷新） */
      publishedAt: content.publishedAt ?? new Date(),
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
      publishedAt: null,
    });
  }

  /**
   * @param options.rawAssets true 时不做 URL 重写，返回 ./assets/ 相对路径（编辑器上下文）
   */
  async getContentById(
    id: string,
    query?: ContentQueryDto,
    options?: { scope?: string; rawAssets?: boolean },
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

    // 编辑器上下文：保持 ./assets/ 相对路径，不做 URL 重写（防止往返污染）
    // 展示端上下文：重写为 OSS 签名 URL 或代理 URL
    let bodyMarkdown = snapshot.bodyMarkdown;

    if (!options?.rawAssets) {
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
      bodyMarkdown = bodyMarkdown
        .replaceAll(/\.\/assets\/([^)\s"]+)/g, (_match, fileName: string) =>
          buildUrl(fileName),
        )
        .replaceAll(
          new RegExp(`https?://[^/]+/assets/${id}/([^?)\\s"]+)[^)\\s"]*`, 'g'),
          (_match, fileName: string) => buildUrl(fileName),
        );
    }

    return this.toDetailDto(content, { bodyMarkdown }, { publicView });
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
      return this.toDetailDto(
        content,
        { bodyMarkdown: snapshot.bodyMarkdown },
        { snapshotTitle: snapshot.title, snapshotSummary: snapshot.summary ?? '' },
      );
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
        source: snap.source ?? 'user',
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
   * 两阶段搜索核心：标题/摘要 $regex + 正文全文 aggregation，合并去重。
   * searchContents 和 searchWithScope 共用此逻辑，避免重复。
   */
  private async twoPhaseSearch(
    query: ContentQueryDto,
  ): Promise<ContentItem[]> {
    const keyword = query.q?.trim();
    const pageSize = query.pageSize ?? 20;

    if (!keyword) {
      const contents = await this.contentRepository.list({
        page: query.page,
        pageSize,
      });
      return contents.filter((c) => this.isReadableInQuery(c, query));
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

    // 合并去重：标题匹配优先，正文匹配补充
    const seenIds = new Set(titleMatches.map((c) => c.id));
    const bodyOnlyIds = bodyMatchIds.filter((id) => !seenIds.has(id));

    const bodyOnlyItems = await Promise.all(
      bodyOnlyIds.map((id) => this.contentRepository.findById(id)),
    );

    return [
      ...titleMatches,
      ...bodyOnlyItems.filter((c): c is ContentItem => c !== null),
    ]
      .filter((content) => this.isReadableInQuery(content, query))
      .slice(0, pageSize);
  }

  /**
   * 全局搜索：标题/摘要 + 正文全文，全部下推到 MongoDB。
   */
  async searchContents(query: ContentQueryDto): Promise<ContentListItemDto[]> {
    const publicView = query.visibility !== ContentVisibility.all;
    const matches = await this.twoPhaseSearch(query);
    return matches.map((content) => this.toListItemDto(content, { publicView }));
  }

  /**
   * 增强搜索：在 twoPhaseSearch 基础上增加 scope 过滤和 snippet 提取。
   *
   * 1. 执行两阶段搜索获取匹配的 ContentItem
   * 2. 批量查询 NavigationNode 获取 contentItemId -> scope 映射
   * 3. 按 scope 过滤（如果指定了）
   * 4. 从最新 snapshot 中提取匹配片段
   */
  async searchWithScope(
    query: ContentQueryDto,
  ): Promise<SearchResultDto[]> {
    const publicView = query.visibility !== ContentVisibility.all;
    const keyword = query.q?.trim() ?? '';
    const matches = await this.twoPhaseSearch(query);
    return this.enrichWithScopeAndSnippet(matches, keyword, query.scope, publicView);
  }

  /**
   * 为搜索结果补充 scope、path 和 snippet，按 scope 过滤。
   */
  private async enrichWithScopeAndSnippet(
    items: ContentItem[],
    keyword: string,
    scopeFilter: string | undefined,
    publicView: boolean,
  ): Promise<SearchResultDto[]> {
    if (items.length === 0) return [];

    // 批量查询 NavigationNode（scope + parentId）
    const contentIds = items.map((c) => c.id);
    const navNodes = await this.navigationModel
      .find({ contentItemId: { $in: contentIds } })
      .lean();

    const scopeMap = new Map<string, string>();
    const parentIdMap = new Map<string, string>(); // contentItemId → parentId
    for (const node of navNodes) {
      if (node.contentItemId) {
        scopeMap.set(node.contentItemId, node.scope);
        if (node.parentId) {
          parentIdMap.set(node.contentItemId, node.parentId.toString());
        }
      }
    }

    // 批量查询所有祖先节点名称，构建路径（最多 3 级）
    const pathMap = await this.buildPathMap(parentIdMap);

    // 按 scope 过滤
    let filtered = items;
    if (scopeFilter) {
      filtered = items.filter(
        (c) => scopeMap.get(c.id) === scopeFilter,
      );
    }

    // 批量获取最新 snapshot 用于 snippet 提取
    const snapshots = await Promise.all(
      filtered.map((c) => {
        const vid = publicView
          ? (c.publishedVersion?.versionId ?? c.latestVersion.versionId)
          : c.latestVersion.versionId;
        return vid
          ? this.snapshotRepository.findByVersionId(vid)
          : Promise.resolve(null);
      }),
    );

    return filtered.map((item, i) => {
      const title = publicView
        ? (item.publishedVersion?.title ?? item.latestVersion.title)
        : item.latestVersion.title;
      const body = snapshots[i]?.bodyMarkdown ?? '';

      return {
        contentItemId: item.id,
        title,
        scope: scopeMap.get(item.id) ?? 'notes',
        path: pathMap.get(item.id) ?? '',
        snippet: keyword
          ? this.extractSnippet(body, keyword)
          : this.extractLeadSnippet(body),
        updatedAt: item.updatedAt.toISOString(),
      };
    });
  }

  /**
   * 从 parentIdMap（contentItemId → 直接父节点 ID）批量构建文件夹路径。
   * 向上追溯最多 3 级祖先，返回 contentItemId → "祖父 / 父" 格式的路径。
   */
  private async buildPathMap(
    parentIdMap: Map<string, string>,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (parentIdMap.size === 0) return result;

    // 收集所有需要查询的节点 ID（去重），逐级向上追溯
    const allIds = new Set(parentIdMap.values());
    const nodeNameMap = new Map<string, string>();   // nodeId → name
    const nodeParentMap = new Map<string, string>(); // nodeId → parentId

    // 最多查 3 轮（3 级文件夹深度）
    let pendingIds = [...allIds];
    for (let depth = 0; depth < 3 && pendingIds.length > 0; depth++) {
      const nodes = await this.navigationModel
        .find({ _id: { $in: pendingIds } })
        .lean();

      const nextPending: string[] = [];
      for (const node of nodes) {
        const id = node._id.toString();
        nodeNameMap.set(id, node.name);
        if (node.parentId) {
          const pid = node.parentId.toString();
          nodeParentMap.set(id, pid);
          if (!nodeNameMap.has(pid) && !allIds.has(pid)) {
            nextPending.push(pid);
            allIds.add(pid);
          }
        }
      }
      pendingIds = nextPending;
    }

    // 为每个 contentItemId 构建路径字符串
    for (const [contentItemId, directParentId] of parentIdMap) {
      const parts: string[] = [];
      let nodeId: string | undefined = directParentId;
      for (let i = 0; i < 3 && nodeId; i++) {
        const name = nodeNameMap.get(nodeId);
        if (name) parts.unshift(name);
        nodeId = nodeParentMap.get(nodeId);
      }
      result.set(contentItemId, parts.join(' / '));
    }

    return result;
  }

  /**
   * 从 bodyMarkdown 中提取关键词附近的上下文片段。
   * 清理 Markdown 语法后返回 ~100 字的纯文本。
   */
  private extractSnippet(
    bodyMarkdown: string,
    keyword: string,
    maxLen = 100,
  ): string {
    const plain = this.stripMarkdown(bodyMarkdown);
    const idx = plain.toLowerCase().indexOf(keyword.toLowerCase());

    if (idx === -1) {
      // 标题匹配但正文没有关键词，返回开头摘要
      return this.extractLeadSnippet(bodyMarkdown);
    }

    const half = Math.floor(maxLen / 2);
    const start = Math.max(0, idx - half);
    const end = Math.min(plain.length, idx + keyword.length + half);

    let snippet = plain.slice(start, end).trim();
    if (start > 0) snippet = '...' + snippet;
    if (end < plain.length) snippet = snippet + '...';

    return snippet;
  }

  /** 返回正文开头 ~100 字作为摘要 */
  private extractLeadSnippet(bodyMarkdown: string): string {
    const plain = this.stripMarkdown(bodyMarkdown);
    if (plain.length <= 100) return plain;
    return plain.slice(0, 100).trim() + '...';
  }

  /** 清理 Markdown 语法，返回纯文本（只移除成对标记，保留内容中的 * _ 等字符） */
  private stripMarkdown(md: string): string {
    return md
      .replace(/^---[\s\S]*?---\n*/m, '')          // frontmatter
      .replace(/^#{1,6}\s+/gm, '')                  // 标题标记
      .replace(/!\[.*?\]\(.*?\)/g, '')               // 图片
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')       // 链接保留文字
      .replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1')       // **bold** / *italic*
      .replace(/_{1,3}([^_]+)_{1,3}/g, '$1')          // __bold__ / _italic_
      .replace(/~~([^~]+)~~/g, '$1')                  // ~~strikethrough~~
      .replace(/`([^`]+)`/g, '$1')                    // `inline code`
      .replace(/^>\s?/gm, '')                         // blockquote 行首 >
      .replace(/\n{2,}/g, ' ')                        // 多换行变空格
      .replace(/\n/g, ' ')                            // 单换行变空格
      .trim();
  }

  /**
   * 最近 N 条已发布内容（供首页使用）。
   * @param contentIds 可选白名单，传入时只返回这些 ID 中已发布的条目（用于 scope 过滤）。
   */
  async getPublishedLatest(
    limit: number,
    contentIds?: string[],
  ): Promise<ContentListItemDto[]> {
    let candidates: ContentItem[];
    if (contentIds) {
      // scope 过滤：只查指定 ID 集合
      candidates = (
        await Promise.all(
          contentIds.map((id) => this.contentRepository.findById(id)),
        )
      )
        .filter((c): c is ContentItem => c !== null && this.isPublished(c))
        .sort(
          (a, b) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
    } else {
      // 无 scope 限制：取最新的一批再过滤
      candidates = (
        await this.contentRepository.list({ page: 1, pageSize: limit * 2 })
      ).filter((content) => this.isPublished(content));
    }
    return candidates
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

  /**
   * 轻量更新元数据（summary 等），不创建新版本。
   * 只改 ContentItem.latestVersion，不动 ContentSnapshot（快照是不可变的历史记录）。
   * 下次 commit 时新快照会自然捕获最新的 summary。
   */
  async patchMeta(
    id: string,
    fields: { title?: string; summary?: string },
  ): Promise<void> {
    const updated = await this.contentRepository.patchMeta(id, fields);
    if (!updated) throw new NotFoundException(`Content ${id} not found`);
  }

  /**
   * 获取某文件的最新 snapshot。
   * fileName 不传或 null = main.md，传值 = 子文件（如 "entries/e001.md"）。
   */
  async getLatestSnapshot(
    contentItemId: string,
    fileName?: string | null,
  ): Promise<ContentSnapshot | null> {
    if (fileName) {
      return this.snapshotRepository.findLatestByFileName(contentItemId, fileName);
    }
    // fileName=null: 取 main.md 的最新 snapshot（即 latestVersion 指向的）
    const item = await this.contentRepository.findById(contentItemId);
    if (!item?.latestVersion?.versionId) return null;
    return this.snapshotRepository.findByVersionId(item.latestVersion.versionId);
  }

  /**
   * 列出某文件的版本历史。
   * fileName 不传或 null = main.md 历史，传值 = 子文件历史。
   */
  async listVersionsByFileName(
    contentItemId: string,
    fileName?: string | null,
  ): Promise<ContentSnapshot[]> {
    if (fileName) {
      return this.snapshotRepository.listByFileName(contentItemId, fileName);
    }
    return this.snapshotRepository.listByContentItemId(contentItemId);
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
