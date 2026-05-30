/**
 * AnthologyViewService — 文集 scope 的特有视图逻辑。
 *
 * 架构角色（统一页面树 Phase 2，2026-05-29 重构）：
 * 文集 = 一个 NavigationNode（scope=anthology，容器），其下每篇条目都是真正的
 * **子 NavigationNode**（parentId=文集节点，scope=anthology），各自背一个独立的
 * ContentItem（通过 contentService.createContent 创建）。条目正文/版本/草稿走子
 * ContentItem 的常规笔记机制（fileName 始终 null，与 notes 完全一致）。
 *
 * 关键约定：
 * - **entryKey = 子节点的 contentItemId（ci_xxx）**。前端把 entryKey 当不透明字符串，
 *   保持 HTTP 契约不变；后端用它直接定位子 ContentItem。
 * - 条目的发布 = 子 ContentItem.publishedVersion（per-node），不再有 entryPublishStates。
 * - 文集容器的 main.md 只存 title/description（不再有 entries 列表——子节点才是权威来源）。
 *
 * date 保存：条目没有独立的日期字段，复用「笔记式 frontmatter」——把 date 作为一行
 * frontmatter 写进子 ContentItem 的 bodyMarkdown 头部，对外返回 DTO 时剥离 frontmatter
 * 只给正文。这样 date 随条目自己的版本历史一起 round-trip，且子节点仍是普通 ContentItem。
 */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as yaml from 'js-yaml';
import { ContentRepository } from '../content/content.repository';
import { ContentSnapshotRepository } from '../content/content-snapshot.repository';
import type { ContentSnapshot } from '../content/content-snapshot.entity';
import { ContentService } from '../content/content.service';
import { ContentStatus } from '../content/content-item.entity';
import { ContentSaveAction } from '../content/dto/save-content.dto';
import { NavigationRepository } from '../navigation/navigation.repository';
import type { NavigationNode } from '../navigation/navigation.entity';
import {
  AnthologyPublicListItemDto,
  AnthologyPublicDetailDto,
  AnthologyAdminListItemDto,
  AnthologyAdminDetailDto,
  AnthologyEntryDetailDto,
  AnthologyAdminEntryRef,
} from './dto/anthology-view.dto';
import { ContentHistoryEntryDto } from '../content/dto/content-history.dto';
import { SaveAnthologyEntryDto } from './dto/save-anthology.dto';
import { EditorDraftRepository } from './editor-draft.repository';
import { EditorDraft } from './editor-draft.entity';
import { EditorDraftDto } from './dto/editor-draft.dto';
import { SaveDraftDto } from './dto/save-draft.dto';

// ─── 内部数据结构 ───────────────────────────────────────────────────────────

/** 解析文集索引 frontmatter（main.md）的返回结构。 */
interface ParsedAnthologyIndex {
  title: string;
  description: string;
}

/** 解析条目内容（子 ContentItem bodyMarkdown）的返回结构。 */
interface ParsedEntryContent {
  /** 条目日期（frontmatter date 行），无则 null。 */
  date: string | null;
  /** frontmatter 后的正文 Markdown（对外只返回这一段）。 */
  bodyMarkdown: string;
}

// ─── 纯函数（解析/序列化）── export 供单元测试 ──────────────────────────────

/**
 * 解析文集索引 frontmatter（main.md bodyMarkdown），只取 title/description。
 * 条目列表不再存进索引——子节点才是权威来源。
 */
export function parseAnthologyIndex(raw: string): ParsedAnthologyIndex {
  const defaults: ParsedAnthologyIndex = { title: '', description: '' };

  if (!raw.startsWith('---')) return defaults;

  const closingIdx = raw.indexOf('\n---', 3);
  if (closingIdx === -1) return defaults;

  const yamlContent = raw.slice(4, closingIdx);

  let parsed: Record<string, unknown>;
  try {
    parsed = (yaml.load(yamlContent) as Record<string, unknown>) ?? {};
  } catch {
    return defaults;
  }

  return {
    title: typeof parsed.title === 'string' ? parsed.title : '',
    description:
      typeof parsed.description === 'string' ? parsed.description : '',
  };
}

/**
 * 序列化文集索引为 main.md bodyMarkdown（纯 frontmatter，无正文，无 entries 列表）。
 */
export function serializeAnthologyIndex(data: ParsedAnthologyIndex): string {
  const yamlStr = yaml.dump(
    { title: data.title, description: data.description },
    { indent: 2, lineWidth: -1, forceQuotes: true, quotingType: '"' },
  );
  return `---\n${yamlStr}---\n`;
}

/**
 * 将各种来源的日期值规范化为 ISO 日期字符串（"YYYY-MM-DD"）或 null。
 * js-yaml 解析时 YAML 裸日期（2026-05-01，无引号）会被自动转为 Date 对象。
 */
function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    return value.trim();
  }
  return null;
}

/**
 * 解析条目内容：从子 ContentItem 的 bodyMarkdown 头部剥离可选的 date frontmatter，
 * 返回 date + 纯正文。无 frontmatter 时整体即正文、date 为 null。
 */
export function parseEntryContent(raw: string): ParsedEntryContent {
  const defaults: ParsedEntryContent = { date: null, bodyMarkdown: raw };

  if (!raw.startsWith('---')) return defaults;

  const closingIdx = raw.indexOf('\n---', 3);
  if (closingIdx === -1) return defaults;

  const yamlContent = raw.slice(4, closingIdx);
  const body = raw.slice(closingIdx + 4).trimStart();

  let parsed: Record<string, unknown>;
  try {
    parsed = (yaml.load(yamlContent) as Record<string, unknown>) ?? {};
  } catch {
    return defaults;
  }

  return { date: normalizeDate(parsed.date), bodyMarkdown: body };
}

/**
 * 序列化条目内容：把 date 作为一行 frontmatter 包到正文头部供存储。
 * date 为 null 时不写 frontmatter，直接存纯正文（与笔记一致）。
 */
export function serializeEntryContent(data: {
  date: string | null;
  bodyMarkdown: string;
}): string {
  if (!data.date) return data.bodyMarkdown;

  /* 日期强制用引号字符串，防止 js-yaml 把 "2026-05-19" 解析为 Date 对象再序列化成怪格式 */
  const yamlStr = yaml.dump(
    { date: data.date },
    { indent: 2, lineWidth: -1, forceQuotes: true, quotingType: '"' },
  );
  return `---\n${yamlStr}---\n\n${data.bodyMarkdown}`;
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class AnthologyViewService {
  private readonly logger = new Logger(AnthologyViewService.name);

  constructor(
    private readonly contentRepository: ContentRepository,
    private readonly contentService: ContentService,
    private readonly snapshotRepository: ContentSnapshotRepository,
    private readonly editorDraftRepository: EditorDraftRepository,
    private readonly navigationRepository: NavigationRepository,
  ) {}

  // ── 内部辅助 ──────────────────────────────────────────────────────────────

  /**
   * 加载并解析最新的索引 snapshot（main.md），只含 title/description。
   * 刚创建尚无快照时返回空默认值（不抛异常）。
   */
  private async loadIndex(
    contentItemId: string,
  ): Promise<ParsedAnthologyIndex> {
    const item = await this.contentRepository.findById(contentItemId);
    if (!item)
      throw new NotFoundException(`Anthology ${contentItemId} not found`);

    const versionId = item.latestVersion?.versionId;
    if (!versionId) return { title: '', description: '' };

    const snapshot = await this.snapshotRepository.findByVersionId(versionId);
    if (!snapshot) return { title: '', description: '' };

    return parseAnthologyIndex(snapshot.bodyMarkdown);
  }

  /**
   * 定位文集容器的 NavigationNode。找不到（不是文集 / 已删）抛 404。
   */
  private async getAnthologyNode(
    contentItemId: string,
  ): Promise<NavigationNode> {
    const node =
      await this.navigationRepository.findByContentItemId(contentItemId);
    if (!node)
      throw new NotFoundException(`Anthology ${contentItemId} not found`);
    return node;
  }

  /**
   * 列出文集下的子条目节点（按 order 升序）。
   * 子节点 = parentId 指向文集节点、scope=anthology 的节点。
   */
  private async listEntryNodes(
    anthologyNode: NavigationNode,
  ): Promise<NavigationNode[]> {
    return this.navigationRepository.findChildrenByParentId(
      anthologyNode._id.toString(),
      'anthology',
    );
  }

  /**
   * 定位某条目的子节点（entryKey = 子 contentItemId）。
   * 校验它确实挂在该文集之下，避免越文集访问。
   */
  private async getEntryNode(
    anthologyNode: NavigationNode,
    entryKey: string,
  ): Promise<NavigationNode> {
    const node = await this.navigationRepository.findByContentItemId(entryKey);
    if (!node || node.parentId?.toString() !== anthologyNode._id.toString()) {
      throw new NotFoundException(`Entry ${entryKey} not found`);
    }
    return node;
  }

  /**
   * 读取某条目子 ContentItem 的最新 snapshot（main.md，fileName=null）。
   */
  private async loadEntryLatestSnapshot(
    entryKey: string,
  ): Promise<ContentSnapshot | null> {
    return this.contentService.getLatestSnapshot(entryKey, null);
  }

  /** 条目子 ContentItem 的标题：取其 latestVersion.title。 */
  private entryTitle(
    node: NavigationNode,
    item: { latestVersion?: { title: string } } | null,
  ): string {
    return item?.latestVersion?.title || node.name;
  }

  /**
   * 根据条目在列表中的位置计算 prev/next 导航引用。
   */
  private buildPrevNext(
    entries: { key: string; title: string }[],
    entryIdx: number,
  ): {
    prev: { key: string; title: string } | null;
    next: { key: string; title: string } | null;
  } {
    const prev =
      entryIdx > 0
        ? { key: entries[entryIdx - 1].key, title: entries[entryIdx - 1].title }
        : null;
    const next =
      entryIdx < entries.length - 1
        ? { key: entries[entryIdx + 1].key, title: entries[entryIdx + 1].title }
        : null;
    return { prev, next };
  }

  /**
   * 把若干条目节点组装成 { key, title, date } 的有序列表（目录展示用）。
   * date 从每个条目子 ContentItem 的正文 frontmatter 读取（兜底快照 createdAt）。
   */
  private async toEntryRefs(
    nodes: NavigationNode[],
  ): Promise<{ key: string; title: string; date: string | null }[]> {
    return Promise.all(
      nodes.map(async (node) => {
        const key = node.contentItemId;
        const item = await this.contentRepository.findById(key);
        const snapshot = await this.loadEntryLatestSnapshot(key);
        const parsed = snapshot
          ? parseEntryContent(snapshot.bodyMarkdown)
          : { date: null, bodyMarkdown: '' };
        const date =
          parsed.date ??
          (snapshot ? snapshot.createdAt.toISOString().split('T')[0] : null);
        return { key, title: this.entryTitle(node, item), date };
      }),
    );
  }

  // ── 条目 CRUD ────────────────────────────────────────────────────────────

  /**
   * 添加条目：
   * 1. 创建子 ContentItem（contentService.createContent）
   * 2. 在文集节点下挂一个子 NavigationNode（contentItemId=子 ci，order=现有子节点数）
   * 3. 若带正文，提交一次内容（commit，fileName=null，date 写进 frontmatter）
   *
   * entryKey = 子 ContentItem 的 id。
   */
  async addEntry(
    contentItemId: string,
    dto: SaveAnthologyEntryDto,
  ): Promise<AnthologyAdminDetailDto> {
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const existingChildren = await this.listEntryNodes(anthologyNode);

    // 1. 子 ContentItem（与笔记一致，只建 Mongo 记录）
    const child = await this.contentService.createContent({ title: dto.title });

    // 2. 子 NavigationNode：order 排到现有子节点末尾
    await this.navigationRepository.create({
      name: dto.title,
      scope: 'anthology',
      parentId: anthologyNode._id.toString(),
      contentItemId: child.id,
      order: existingChildren.length,
    });

    // 3. 有正文时提交（date 包进 frontmatter）。空正文留给后续 saveEntry。
    if (dto.bodyMarkdown) {
      await this.commitEntryContent(child.id, dto);
    }

    return this.toAdminDetail(contentItemId);
  }

  /**
   * 提交文集容器自身的 main.md（仅 title/description，无 entries 列表）。
   * 节点同质化后条目改子节点、容器索引不再随条目变,但仍需提交一次让它归档进 Git
   * (content/<ci>/main.md),否则清空 Mongo 后无法从 Git 恢复容器(协议 A 欠账)。
   */
  /** 公开:文集容器创建时由 WorkspaceService 调用一次,提交容器 main.md 以归档进 Git。 */
  async commitContainerIndex(contentItemId: string): Promise<void> {
    const item = await this.contentRepository.findById(contentItemId);
    if (!item) return;
    const title = item.latestVersion?.title ?? '';
    const description = item.latestVersion?.summary ?? '';
    await this.contentService.saveContent(contentItemId, {
      title,
      summary: description,
      bodyMarkdown: serializeAnthologyIndex({ title, description }),
      changeNote: '归档文集容器索引',
      status: ContentStatus.committed,
      action: ContentSaveAction.commit,
    });
  }

  /** 提交条目内容到子 ContentItem（fileName=null，date 写进 frontmatter）。 */
  private async commitEntryContent(
    entryKey: string,
    dto: SaveAnthologyEntryDto,
  ): Promise<void> {
    const bodyMarkdown = serializeEntryContent({
      date: dto.date ?? null,
      bodyMarkdown: dto.bodyMarkdown,
    });
    await this.contentService.saveContent(entryKey, {
      title: dto.title,
      summary: dto.title,
      bodyMarkdown,
      changeNote: dto.changeNote ?? `编辑条目 ${dto.title}`,
      status: ContentStatus.committed,
      action: ContentSaveAction.commit,
      // fileName 不传（null）——条目就是普通 ContentItem
    });
  }

  /**
   * 编辑条目：
   * 1. 提交内容新版本到子 ContentItem
   * 2. 同步子节点 name 为 dto.title
   * 3. 删除该节点草稿（与 notes commit 后删草稿对称）
   */
  async saveEntry(
    contentItemId: string,
    entryKey: string,
    dto: SaveAnthologyEntryDto,
  ): Promise<AnthologyAdminDetailDto> {
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const entryNode = await this.getEntryNode(anthologyNode, entryKey);

    await this.commitEntryContent(entryKey, dto);

    // 同步子节点名（标题冗余在节点 name 上，列表无需读快照即可显示）
    await this.navigationRepository.update(entryNode._id.toString(), {
      name: dto.title,
    });

    // 提交成功后清理该条目草稿（忽略错误，不影响主流程）
    await this.editorDraftRepository
      .deleteByContentItemId(entryKey)
      .catch((err) =>
        this.logger.warn(`清理条目草稿失败（非致命）: ${String(err)}`),
      );

    return this.toAdminDetail(contentItemId);
  }

  /**
   * 删除条目：已发布的条目（子 ContentItem.publishedVersion 非空）不能直接删。
   * 删除子 NavigationNode + 子 ContentItem 及其快照、草稿。
   */
  async removeEntry(
    contentItemId: string,
    entryKey: string,
  ): Promise<AnthologyAdminDetailDto> {
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const entryNode = await this.getEntryNode(anthologyNode, entryKey);

    const item = await this.contentRepository.findById(entryKey);
    if (item?.publishedVersion) {
      throw new BadRequestException('已发布的条目不能删除，请先取消发布');
    }

    // 删子节点（索引）
    await this.navigationRepository.deleteById(entryNode._id.toString());

    // 并行清理子 ContentItem / 快照 / 草稿（非致命，失败不影响主流程）
    await Promise.all([
      this.contentRepository
        .deleteById(entryKey)
        .catch((err) =>
          this.logger.warn(
            `清理条目 ContentItem 失败（非致命）: ${String(err)}`,
          ),
        ),
      this.snapshotRepository
        .deleteByContentItemId(entryKey)
        .catch((err) =>
          this.logger.warn(`清理条目 snapshot 失败（非致命）: ${String(err)}`),
        ),
      this.editorDraftRepository
        .deleteByContentItemId(entryKey)
        .catch((err) =>
          this.logger.warn(`清理条目草稿失败（非致命）: ${String(err)}`),
        ),
    ]);

    return this.toAdminDetail(contentItemId);
  }

  /**
   * 重排条目顺序：newOrder = 子 contentItemId 列表，必须与当前子节点集合完全一致。
   * 映射每个 contentItemId 到其子节点 id，bulkUpdateOrder 落 order。
   */
  async reorderEntries(
    contentItemId: string,
    newOrder: string[],
  ): Promise<AnthologyAdminDetailDto> {
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const children = await this.listEntryNodes(anthologyNode);

    // contentItemId → 子节点 id
    const idByKey = new Map(
      children.map((node) => [node.contentItemId, node._id.toString()]),
    );

    const isValidOrder =
      newOrder.length === children.length &&
      newOrder.every((key) => idByKey.has(key));
    if (!isValidOrder) {
      throw new BadRequestException(
        'newOrder 必须包含且仅包含当前所有条目的 key',
      );
    }

    await this.navigationRepository.bulkUpdateOrder(
      newOrder.map((key, order) => ({ id: idByKey.get(key)!, order })),
    );

    return this.toAdminDetail(contentItemId);
  }

  /**
   * 获取单篇条目详情（展示端 + 管理端通用）。含正文和 prev/next 导航。
   *
   * @param usePublished true 时只在「文集已发布 + 条目已发布」时可见，正文取条目已发布
   *                     版本的冻结 snapshot；false 时取条目最新 snapshot（管理端/编辑）。
   */
  async getEntryDetail(
    contentItemId: string,
    entryKey: string,
    usePublished = false,
  ): Promise<AnthologyEntryDetailDto> {
    const anthologyNode = await this.getAnthologyNode(contentItemId);

    // 展示端：文集本身必须已发布
    if (usePublished) {
      const anthologyItem =
        await this.contentRepository.findById(contentItemId);
      if (!anthologyItem?.publishedVersion) {
        throw new NotFoundException(
          `Anthology ${contentItemId} is not published`,
        );
      }
    }

    // 兄弟列表（按 order），展示端只保留已发布的条目
    const children = await this.listEntryNodes(anthologyNode);
    const childItems = await Promise.all(
      children.map((node) =>
        this.contentRepository.findById(node.contentItemId),
      ),
    );
    const visiblePairs = children
      .map((node, i) => ({ node, item: childItems[i] }))
      .filter(({ item }) => (usePublished ? !!item?.publishedVersion : true));

    const visibleRefs = visiblePairs.map(({ node, item }) => ({
      key: node.contentItemId,
      title: this.entryTitle(node, item),
    }));

    const entryIdx = visibleRefs.findIndex((e) => e.key === entryKey);
    if (entryIdx === -1) {
      throw new NotFoundException(`Entry ${entryKey} not found`);
    }
    const { node: entryNode, item: entryItem } = visiblePairs[entryIdx];

    // 正文 snapshot：展示端取已发布冻结版本，管理端取最新版本
    let entrySnapshot: ContentSnapshot | null;
    if (usePublished) {
      const publishedVid = entryItem?.publishedVersion?.versionId;
      entrySnapshot = publishedVid
        ? await this.snapshotRepository.findByVersionId(publishedVid)
        : null;
    } else {
      entrySnapshot = await this.loadEntryLatestSnapshot(entryKey);
    }

    const { prev, next } = this.buildPrevNext(visibleRefs, entryIdx);

    if (!entrySnapshot) {
      // 展示端:已发布条目却查不到正文快照(版本悬空)→ 严格 404,不向读者露空内容。
      if (usePublished) {
        throw new NotFoundException(
          `Entry ${entryKey} has no content snapshot`,
        );
      }
      // 管理端:正文快照缺失(历史恢复丢正文)→ 返回空正文让编辑器正常打开(自愈),不堵死用户。
      return {
        key: entryKey,
        title: this.entryTitle(entryNode, entryItem),
        date: new Date().toISOString().split('T')[0],
        updatedAt: new Date().toISOString(),
        bodyMarkdown: '',
        prev,
        next,
      };
    }

    // updatedAt 取该条目最新 snapshot 的 createdAt（与 NoteReader 同语义）
    const latestSnapshot = await this.loadEntryLatestSnapshot(entryKey);
    const parsed = parseEntryContent(entrySnapshot.bodyMarkdown);

    return {
      key: entryKey,
      title: this.entryTitle(entryNode, entryItem),
      date: parsed.date ?? entrySnapshot.createdAt.toISOString().split('T')[0],
      updatedAt: (latestSnapshot ?? entrySnapshot).createdAt.toISOString(),
      bodyMarkdown: parsed.bodyMarkdown,
      prev,
      next,
    };
  }

  /**
   * 为 Aurora 拼"整集脉络"字符串(2026-05-31 #150 续):
   * 输入文集条目的合成 contentItemId(形如 `${anthologyId}:${entryKey}`),
   * 返回该条目所属文集的 标题/描述/条目列表/当前位置 的一段文本。
   *
   * 设计:把前端 anthology/edit.tsx 里那段拼装搬到后端——避免前端每轮 chat 都重发同一份脉络
   * (#150 按需化原则:工具能提供的不要一直注入 + 后端 pull 替代前端 push)。
   * 非文集条目格式(无 `:`)或文集已删 → 返回 null,prompt.handler 自然不会注入 <collection>。
   */
  async buildCollectionContextForEntry(
    entryContentItemId: string,
  ): Promise<string | null> {
    const sep = entryContentItemId.indexOf(':');
    if (sep < 0) return null;
    const anthologyId = entryContentItemId.slice(0, sep);
    const currentEntryKey = entryContentItemId.slice(sep + 1);
    try {
      const detail = await this.toAdminDetail(anthologyId);
      const list = detail.entries
        .map(
          (e, i) =>
            `${i + 1}. ${e.title || '(无标题)'} (key: ${e.key})${e.key === currentEntryKey ? ' ← 当前正在编辑' : ''}`,
        )
        .join('\n');
      const desc = detail.description?.trim()
        ? `\n集简介:${detail.description.trim()}`
        : '';
      return `本条目属于文集《${detail.title}》,共 ${detail.entries.length} 篇。${desc}\n条目顺序:\n${list}`;
    } catch (err) {
      // 文集已删 / 节点查不到 → 不阻塞 chat,返回 null(prompt 不注入 <collection>)
      this.logger.warn(
        `[buildCollectionContextForEntry] 取整集脉络失败 anthologyId=${anthologyId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // ── 发布 ──────────────────────────────────────────────────────────────────

  /**
   * 文集级发布（上线）：把文集容器的 publishedVersion 指向当前最新索引 snapshot。
   * 发布顺序(2026-05-28):文集先上线、再逐条发布条目（见 publishEntry）。
   */
  async publishAnthology(contentItemId: string): Promise<void> {
    await this.contentService.publishVersion(contentItemId);
  }

  /**
   * 文集级取消发布（下线）：清除文集容器的 publishedVersion，读者立即看不到该文集。
   */
  async unpublishAnthology(contentItemId: string): Promise<void> {
    await this.contentService.unpublishVersion(contentItemId);
  }

  /**
   * 发布单篇条目 = 发布子 ContentItem 的最新版本（per-node publishedVersion）。
   * 发布顺序:必须先发布文集（整集上线），才能发布其中的条目。
   */
  async publishEntry(
    contentItemId: string,
    entryKey: string,
  ): Promise<AnthologyAdminDetailDto> {
    const anthologyItem = await this.contentRepository.findById(contentItemId);
    if (!anthologyItem?.publishedVersion) {
      throw new BadRequestException('请先发布文集,才能发布其中的条目');
    }

    const anthologyNode = await this.getAnthologyNode(contentItemId);
    await this.getEntryNode(anthologyNode, entryKey); // 校验条目存在且属于该文集

    await this.contentService.publishVersion(entryKey);
    return this.toAdminDetail(contentItemId);
  }

  /**
   * 取消发布单篇条目 = 清除子 ContentItem 的 publishedVersion。
   */
  async unpublishEntry(
    contentItemId: string,
    entryKey: string,
  ): Promise<AnthologyAdminDetailDto> {
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    await this.getEntryNode(anthologyNode, entryKey);

    await this.contentService.unpublishVersion(entryKey);
    return this.toAdminDetail(contentItemId);
  }

  /**
   * 批量发布所有条目：逐个发布有内容（有 latestVersion）的子 ContentItem 最新版本。
   * 无内容（从未提交）的条目跳过；已发布且无变更的项 publishVersion 不抛错（指向最新即可）。
   */
  async publishAllEntries(
    contentItemId: string,
  ): Promise<AnthologyAdminDetailDto> {
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const children = await this.listEntryNodes(anthologyNode);

    await Promise.all(
      children.map(async (node) => {
        const item = await this.contentRepository.findById(node.contentItemId);
        // 仅发布有已提交版本的条目（latestVersion.versionId 存在）
        if (item?.latestVersion?.versionId) {
          await this.contentService
            .publishVersion(node.contentItemId)
            .catch((err) =>
              this.logger.warn(
                `批量发布条目 ${node.contentItemId} 失败（跳过）: ${String(err)}`,
              ),
            );
        }
      }),
    );

    return this.toAdminDetail(contentItemId);
  }

  /**
   * 发布最新版（供一键发布全部 publish-all 统一派发;实现 ScopePublisher）。
   * 文集特有顺序(2026-05-28 决策,见 publishEntry 守卫):先整集上线,再逐条发布条目。
   * ——单条目发布要求文集必须已发布(publishEntry 守卫),故 publish-all 同样「容器先、条目后」。
   */
  async publishLatest(contentItemId: string): Promise<void> {
    await this.publishAnthology(contentItemId);
    await this.publishAllEntries(contentItemId);
  }

  // ── 条目草稿 CRUD ────────────────────────────────────────────────────────

  /** 将 EditorDraft 实体转为 EditorDraftDto。 */
  private toDraftDto(draft: EditorDraft): EditorDraftDto {
    return {
      id: draft._id,
      contentItemId: draft.contentItemId,
      title: draft.title,
      summary: draft.summary ?? '',
      bodyMarkdown: draft.bodyMarkdown,
      changeNote: draft.changeNote,
      savedAt: draft.savedAt.toISOString(),
      savedBy: draft.savedBy,
    };
  }

  /**
   * 获取条目草稿。entryKey 即子 ContentItem id，走普通笔记草稿机制（fileName=null）。
   * 无草稿返回 null（200），避免 404 噪音。
   */
  async getEntryDraft(
    contentItemId: string,
    entryKey: string,
  ): Promise<EditorDraftDto | null> {
    await this.contentService.assertContentItemExists(entryKey);
    const draft =
      await this.editorDraftRepository.findByContentItemId(entryKey);
    if (!draft) return null;
    return this.toDraftDto(draft);
  }

  /**
   * 保存条目草稿（autosave）。只写 MongoDB，不产生 Git snapshot。
   */
  async saveEntryDraft(
    contentItemId: string,
    entryKey: string,
    dto: SaveDraftDto,
  ): Promise<EditorDraftDto> {
    await this.contentService.assertContentEditable(entryKey);
    const draft = await this.editorDraftRepository.save({
      contentItemId: entryKey,
      title: dto.title,
      summary: dto.summary ?? '',
      bodyMarkdown: dto.bodyMarkdown,
      changeNote: dto.changeNote,
      savedAt: new Date(),
      savedBy: dto.savedBy,
    });
    return this.toDraftDto(draft);
  }

  /**
   * 丢弃条目草稿。
   */
  async deleteEntryDraft(
    contentItemId: string,
    entryKey: string,
  ): Promise<void> {
    await this.contentService.assertContentItemExists(entryKey);
    await this.editorDraftRepository.deleteByContentItemId(entryKey);
  }

  // ── 条目版本历史 ─────────────────────────────────────────────────────────

  /**
   * 获取单篇条目的历史版本内容（按 versionId 精确查找 snapshot）。
   * 与 NoteViewService.getByVersion 语义对等。
   */
  async getEntryByVersion(
    contentItemId: string,
    entryKey: string,
    versionId: string,
  ): Promise<AnthologyEntryDetailDto> {
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const entryNode = await this.getEntryNode(anthologyNode, entryKey);
    const entryItem = await this.contentRepository.findById(entryKey);

    const snapshot = await this.snapshotRepository.findByVersionId(versionId);
    if (!snapshot) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }

    const parsed = parseEntryContent(snapshot.bodyMarkdown);

    // prev/next 从当前条目列表取（管理端预览历史版本，导航仍以当前列表为准）
    const children = await this.listEntryNodes(anthologyNode);
    const childItems = await Promise.all(
      children.map((n) => this.contentRepository.findById(n.contentItemId)),
    );
    const refs = children.map((n, i) => ({
      key: n.contentItemId,
      title: this.entryTitle(n, childItems[i]),
    }));
    const entryIdx = refs.findIndex((e) => e.key === entryKey);
    const { prev, next } = this.buildPrevNext(refs, entryIdx);

    return {
      key: entryKey,
      title: this.entryTitle(entryNode, entryItem),
      date: parsed.date ?? snapshot.createdAt.toISOString().split('T')[0],
      updatedAt: snapshot.createdAt.toISOString(),
      bodyMarkdown: parsed.bodyMarkdown,
      prev,
      next,
    };
  }

  /**
   * 获取单篇条目的版本历史（子 ContentItem 的 main.md 快照列表）。
   * 与 Notes 的 getHistory 语义对等。
   */
  async getEntryHistory(
    contentItemId: string,
    entryKey: string,
  ): Promise<ContentHistoryEntryDto[]> {
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    await this.getEntryNode(anthologyNode, entryKey);

    const snapshots = await this.contentService.listVersionsByFileName(
      entryKey,
      null,
    );
    return snapshots.map((snap) => ({
      versionId: snap.versionId,
      commitHash: snap.commitHash ?? '',
      committedAt: snap.createdAt.toISOString(),
      changeType: 'patch',
      changeNote: snap.changeNote ?? '',
      source: snap.source ?? 'user',
      title: snap.title,
    }));
  }

  // ── DTO 组装 ─────────────────────────────────────────────────────────────

  /**
   * 加载已发布版本的索引：校验文集存在且已发布，返回 ContentItem + 解析后的索引数据。
   * 展示端 DTO 共用此逻辑。
   */
  private async loadPublishedIndex(contentItemId: string): Promise<{
    item: NonNullable<Awaited<ReturnType<ContentRepository['findById']>>>;
    indexData: ParsedAnthologyIndex;
  }> {
    const item = await this.contentRepository.findById(contentItemId);
    if (!item)
      throw new NotFoundException(`Anthology ${contentItemId} not found`);
    if (!item.publishedVersion) {
      throw new NotFoundException(
        `Anthology ${contentItemId} is not published`,
      );
    }

    const publishedSnapshot = await this.snapshotRepository.findByVersionId(
      item.publishedVersion.versionId!,
    );
    const indexData = publishedSnapshot
      ? parseAnthologyIndex(publishedSnapshot.bodyMarkdown)
      : { title: '', description: '' };

    return { item, indexData };
  }

  /** 已发布的子条目节点（按 order）。供展示端列表/详情共用。 */
  private async listPublishedEntryNodes(
    anthologyNode: NavigationNode,
  ): Promise<NavigationNode[]> {
    const children = await this.listEntryNodes(anthologyNode);
    const items = await Promise.all(
      children.map((n) => this.contentRepository.findById(n.contentItemId)),
    );
    return children.filter((_n, i) => !!items[i]?.publishedVersion);
  }

  /**
   * 展示端列表 DTO：从已发布版本读取，entryCount 只计算已发布条目数。
   */
  async toPublicListItem(
    contentItemId: string,
  ): Promise<AnthologyPublicListItemDto> {
    const { item, indexData } = await this.loadPublishedIndex(contentItemId);
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const publishedNodes = await this.listPublishedEntryNodes(anthologyNode);

    return {
      id: contentItemId,
      title: item.publishedVersion!.title || indexData.title,
      description: indexData.description,
      entryCount: publishedNodes.length,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  /**
   * 展示端详情 DTO：从已发布版本读取，只包含已发布条目。
   */
  async toPublicDetail(
    contentItemId: string,
  ): Promise<AnthologyPublicDetailDto> {
    const { item, indexData } = await this.loadPublishedIndex(contentItemId);
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const publishedNodes = await this.listPublishedEntryNodes(anthologyNode);

    return {
      id: contentItemId,
      title: item.publishedVersion!.title || indexData.title,
      description: indexData.description,
      entries: await this.toEntryRefs(publishedNodes),
    };
  }

  /**
   * 管理端列表 DTO：从最新版本读取，含状态信息。
   */
  async toAdminListItem(
    contentItemId: string,
  ): Promise<AnthologyAdminListItemDto> {
    const item = await this.contentRepository.findById(contentItemId);
    if (!item)
      throw new NotFoundException(`Anthology ${contentItemId} not found`);

    const indexData = await this.loadIndex(contentItemId);
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const children = await this.listEntryNodes(anthologyNode);

    return {
      id: contentItemId,
      title: item.latestVersion?.title || indexData.title,
      description: indexData.description,
      entryCount: children.length,
      status: item.publishedVersion ? 'published' : 'committed',
      hasUnpublishedChanges: item.publishedVersion
        ? item.latestVersion?.versionId !== item.publishedVersion.versionId
        : false,
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  /**
   * 管理端详情 DTO：每条目的状态来自其子 ContentItem。
   * - hasContent: 子 ContentItem 最新 snapshot 存在且正文非空
   * - publishedVersionId: 子 ContentItem.publishedVersion.versionId（null=未发布）
   * - hasUnpublishedChanges: 子 ContentItem 最新 versionId != 已发布 versionId
   */
  async toAdminDetail(contentItemId: string): Promise<AnthologyAdminDetailDto> {
    const item = await this.contentRepository.findById(contentItemId);
    if (!item)
      throw new NotFoundException(`Anthology ${contentItemId} not found`);

    const indexData = await this.loadIndex(contentItemId);
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const children = await this.listEntryNodes(anthologyNode);

    const entries: AnthologyAdminEntryRef[] = await Promise.all(
      children.map(async (node): Promise<AnthologyAdminEntryRef> => {
        const key = node.contentItemId;
        const entryItem = await this.contentRepository.findById(key);
        const snapshot = await this.loadEntryLatestSnapshot(key);
        const parsed = snapshot
          ? parseEntryContent(snapshot.bodyMarkdown)
          : { date: null, bodyMarkdown: '' };

        const hasContent = parsed.bodyMarkdown.length > 0;
        const publishedVersionId =
          entryItem?.publishedVersion?.versionId ?? null;
        const latestVersionId = entryItem?.latestVersion?.versionId ?? null;

        // 已发布且最新版本与已发布版本不同 → 有未发布的新改动
        const hasUnpublishedChanges =
          publishedVersionId !== null &&
          latestVersionId !== null &&
          latestVersionId !== publishedVersionId;

        const date =
          parsed.date ??
          (snapshot ? snapshot.createdAt.toISOString().split('T')[0] : null);

        return {
          key,
          title: this.entryTitle(node, entryItem),
          date,
          hasContent,
          publishedVersionId,
          hasUnpublishedChanges,
        };
      }),
    );

    return {
      id: contentItemId,
      title: item.latestVersion?.title || indexData.title,
      description: indexData.description,
      status: item.publishedVersion ? 'published' : 'committed',
      hasUnpublishedChanges: item.publishedVersion
        ? item.latestVersion?.versionId !== item.publishedVersion.versionId
        : false,
      entries,
    };
  }
}
