/**
 * AnthologyViewService — 文集 scope 的视图层逻辑。
 *
 * 架构角色(统一页面树 Phase 1 重构,2026-05-31):
 * 文集 = 一个 NavigationNode(scope=anthology,容器),其下每篇条目都是真正的
 * **子 NavigationNode**(parentId=文集节点,scope=anthology),各自背一个独立的
 * ContentItem(通过 contentService.createContent 创建)。条目正文/版本/草稿走子
 * ContentItem 的常规笔记机制(fileName 始终 null,与 notes 完全一致)。
 *
 * 关键约定:
 * - **nodeId = 子节点的 contentItemId(ci_xxx)**。前端用它当不透明字符串,
 *   后端用它直接定位子 ContentItem。
 * - 文集容器自身也是 ContentItem,带 bodyMarkdown(卷首语)+ title + description。
 * - 容器与子节点的 CRUD/草稿/发布通通走通用 `:scope/items/:id` 接口,本 service
 *   只承担「视图组装」职责:
 *   - buildOverview - 阅读端卷宗概览 DTO(含卷首语 + 已发布子节点目录)
 *   - buildEntryDetail - 阅读端单篇阅读 DTO(含正文 + prev/next 导航)
 *   - publishAnthologyAndDescendants - 一键递归发布容器+所有子节点
 *   - buildCollectionContextForEntry - 给 Aurora 的整集脉络上下文
 *
 * 不再有 saveEntry / loadEntry / publishEntry / unpublishEntry / addEntry /
 * removeEntry / reorderEntries / getEntryDraft 等方法 —— 全部并入通用接口。
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
  AnthologyEntryDetailDto,
  AnthologyEntryRef,
} from './dto/anthology-view.dto';
import { ContentHistoryEntryDto } from '../content/dto/content-history.dto';
import { EditorDraftRepository } from './editor-draft.repository';
import { EditorDraft } from './editor-draft.entity';
import { EditorDraftDto } from './dto/editor-draft.dto';
import { SaveDraftDto } from './dto/save-draft.dto';

// ─── 内部数据结构 ───────────────────────────────────────────────────────────

/** 解析文集索引 frontmatter(main.md)的返回结构。 */
interface ParsedAnthologyIndex {
  title: string;
  description: string;
  /** frontmatter 之后的正文(卷首语)。无 frontmatter 时为整段原文。 */
  body: string;
}

/** 解析条目内容(子 ContentItem bodyMarkdown)的返回结构。 */
interface ParsedEntryContent {
  /** 条目日期(frontmatter date 行,旧数据兼容),无则 null。 */
  date: string | null;
  /** frontmatter 后的正文 Markdown(对外只返回这一段)。 */
  bodyMarkdown: string;
}

// ─── 纯函数(解析/序列化)── export 供单元测试 ──────────────────────────────

/**
 * 解析文集索引(容器节点 main.md),取 title/description 和卷首语正文。
 * 容器 main.md 由 commitContainerIndex 写成 "---\ntitle/description\n---\n卷首语" 格式。
 */
export function parseAnthologyIndex(raw: string): ParsedAnthologyIndex {
  const defaults: ParsedAnthologyIndex = {
    title: '',
    description: '',
    body: '',
  };

  if (!raw.startsWith('---')) return { ...defaults, body: raw };

  const closingIdx = raw.indexOf('\n---', 3);
  if (closingIdx === -1) return { ...defaults, body: raw };

  const yamlContent = raw.slice(4, closingIdx);
  const body = raw.slice(closingIdx + 4).trimStart();

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
    body,
  };
}

/**
 * 序列化文集索引为 main.md bodyMarkdown(title/description frontmatter + 可选卷首语)。
 * commitContainerIndex 用,容器创建时仅写 title/description(body 空)。
 */
export function serializeAnthologyIndex(data: {
  title: string;
  description: string;
  body?: string;
}): string {
  const yamlStr = yaml.dump(
    { title: data.title, description: data.description },
    { indent: 2, lineWidth: -1, forceQuotes: true, quotingType: '"' },
  );
  return data.body
    ? `---\n${yamlStr}---\n\n${data.body}`
    : `---\n${yamlStr}---\n`;
}

/**
 * 将各种来源的日期值规范化为 ISO 日期字符串("YYYY-MM-DD")或 null。
 * js-yaml 解析时 YAML 裸日期(2026-05-01,无引号)会被自动转为 Date 对象。
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
 * 解析条目内容:旧数据(saveEntry 时代)子 ContentItem 的 bodyMarkdown 头部可能有 date
 * frontmatter,剥离后返回 date + 纯正文。Phase 1 后新写入的子节点不再包装 frontmatter,
 * 解析依旧兼容(旧数据 round-trip)——新数据走 defaults(date=null,bodyMarkdown=raw)。
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
   * 加载并解析最新的索引 snapshot(容器 main.md),含 title/description 和卷首语 body。
   * 刚创建尚无快照时返回空默认值(不抛异常)。
   */
  private async loadIndex(
    contentItemId: string,
  ): Promise<ParsedAnthologyIndex> {
    const item = await this.contentRepository.findById(contentItemId);
    if (!item)
      throw new NotFoundException(`Anthology ${contentItemId} not found`);

    const versionId = item.latestVersion?.versionId;
    if (!versionId) return { title: '', description: '', body: '' };

    const snapshot = await this.snapshotRepository.findByVersionId(versionId);
    if (!snapshot) return { title: '', description: '', body: '' };

    return parseAnthologyIndex(snapshot.bodyMarkdown);
  }

  /**
   * 定位文集容器的 NavigationNode。找不到(不是文集 / 已删)抛 404。
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
   * 列出文集下的子条目节点(按 order 升序)。
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
   * 读取某条目子 ContentItem 的最新 snapshot(main.md,fileName=null)。
   */
  private async loadEntryLatestSnapshot(
    nodeId: string,
  ): Promise<ContentSnapshot | null> {
    return this.contentService.getLatestSnapshot(nodeId, null);
  }

  /** 条目子 ContentItem 的标题:取其 latestVersion.title。 */
  private entryTitle(
    node: NavigationNode,
    item: { latestVersion?: { title: string } } | null,
  ): string {
    return item?.latestVersion?.title || node.name;
  }

  /**
   * 根据条目在列表中的位置计算 prev/next 导航引用(nodeId + title)。
   */
  private buildPrevNext(
    entries: { nodeId: string; title: string }[],
    entryIdx: number,
  ): {
    prev: { nodeId: string; title: string } | null;
    next: { nodeId: string; title: string } | null;
  } {
    const prev =
      entryIdx > 0
        ? {
            nodeId: entries[entryIdx - 1].nodeId,
            title: entries[entryIdx - 1].title,
          }
        : null;
    const next =
      entryIdx < entries.length - 1
        ? {
            nodeId: entries[entryIdx + 1].nodeId,
            title: entries[entryIdx + 1].title,
          }
        : null;
    return { prev, next };
  }

  /**
   * 把若干子节点组装成 { nodeId, title, date } 的有序列表(目录展示用)。
   * date 从每个子 ContentItem 的正文 frontmatter 读取(旧数据兼容),
   * 兜底快照 createdAt。Phase 8 起字段统一为 nodeId(与通用页面树命名对齐)。
   */
  private async toEntryRefs(
    nodes: NavigationNode[],
  ): Promise<AnthologyEntryRef[]> {
    return Promise.all(
      nodes.map(async (node) => {
        const nodeId = node.contentItemId;
        const item = await this.contentRepository.findById(nodeId);
        const snapshot = await this.loadEntryLatestSnapshot(nodeId);
        const parsed = snapshot
          ? parseEntryContent(snapshot.bodyMarkdown)
          : { date: null, bodyMarkdown: '' };
        const date =
          parsed.date ??
          (snapshot ? snapshot.createdAt.toISOString().split('T')[0] : null);
        return { nodeId, title: this.entryTitle(node, item), date };
      }),
    );
  }

  /**
   * 提交文集容器自身的 main.md(title/description frontmatter,可选卷首语 body)。
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

  /**
   * 给 Aurora 拼"整集脉络"字符串(#150 续 2026-05-31):
   * 输入文集子节点的合成 contentItemId(形如 `${anthologyId}:${childNodeId}`),
   * 返回该子节点所属文集的 标题/描述/子节点列表/当前位置 的一段文本。
   *
   * 设计:把前端 anthology/edit.tsx 里那段拼装搬到后端——避免前端每轮 chat 都重发同一份脉络
   * (#150 按需化原则:工具能提供的不要一直注入 + 后端 pull 替代前端 push)。
   * 非合成 id 格式(无 `:`)或文集已删 → 返回 null,prompt.handler 自然不会注入 <collection>。
   */
  async buildCollectionContextForEntry(
    entryContentItemId: string,
  ): Promise<string | null> {
    const sep = entryContentItemId.indexOf(':');
    if (sep < 0) return null;
    const anthologyId = entryContentItemId.slice(0, sep);
    const currentNodeId = entryContentItemId.slice(sep + 1);
    try {
      // 走阅读端 detail(含已发布子节点列表),Aurora 上下文跟随容器视角
      const anthologyNode = await this.getAnthologyNode(anthologyId);
      const children = await this.listEntryNodes(anthologyNode);
      const entries = await this.toEntryRefs(children);
      const index = await this.loadIndex(anthologyId);

      const list = entries
        .map(
          (e, i) =>
            `${i + 1}. ${e.title || '(无标题)'} (nodeId: ${e.nodeId})${e.nodeId === currentNodeId ? ' ← 当前正在编辑' : ''}`,
        )
        .join('\n');
      const desc = index.description?.trim()
        ? `\n集简介:${index.description.trim()}`
        : '';
      return `本条目属于文集《${index.title}》,共 ${entries.length} 篇。${desc}\n条目顺序:\n${list}`;
    } catch (err) {
      this.logger.warn(
        `[buildCollectionContextForEntry] 取整集脉络失败 anthologyId=${anthologyId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // ── 发布 ──────────────────────────────────────────────────────────────────

  /**
   * 文集级发布(上线):把文集容器的 publishedVersion 指向当前最新索引 snapshot。
   * 发布顺序(2026-05-28):文集先上线,再逐条发布条目。
   */
  async publishAnthology(contentItemId: string): Promise<void> {
    await this.contentService.publishVersion(contentItemId);
  }

  /**
   * 文集级取消发布(下线):清除文集容器的 publishedVersion,读者立即看不到该文集。
   */
  async unpublishAnthology(contentItemId: string): Promise<void> {
    await this.contentService.unpublishVersion(contentItemId);
  }

  /**
   * 递归发布:容器 + 所有子节点。
   * 顺序:先发容器(否则子节点发布会因「请先发布文集」校验失败),再 Promise.all 发所有子节点。
   * 用于灾后恢复后的「一键发布全部」/手动批量上线。
   */
  async publishAnthologyAndDescendants(contentItemId: string): Promise<void> {
    // 1. 先发容器
    await this.publishAnthology(contentItemId);

    // 2. 再发所有有内容的子节点
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const children = await this.listEntryNodes(anthologyNode);
    await Promise.all(
      children.map(async (node) => {
        const item = await this.contentRepository.findById(node.contentItemId);
        if (item?.latestVersion?.versionId) {
          await this.contentService
            .publishVersion(node.contentItemId)
            .catch((err) =>
              this.logger.warn(
                `批量发布条目 ${node.contentItemId} 失败(跳过): ${String(err)}`,
              ),
            );
        }
      }),
    );
  }

  /**
   * 发布最新版(供一键发布全部 publish-all 统一派发;实现 ScopePublisher)。
   * 文集特有顺序:先整集上线,再逐条发布条目。
   */
  async publishLatest(contentItemId: string): Promise<void> {
    await this.publishAnthologyAndDescendants(contentItemId);
  }

  // ── 阅读端 DTO 组装 ──────────────────────────────────────────────────────

  /**
   * 加载已发布版本的索引:校验文集存在且已发布,返回 ContentItem + 解析后的索引数据。
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
      : { title: '', description: '', body: '' };

    return { item, indexData };
  }

  /** 已发布的子条目节点(按 order)。供展示端列表/详情共用。 */
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
   * 展示端列表 DTO:从已发布版本读取,entryCount 只计算已发布子节点数。
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
   * 展示端详情 DTO:从已发布版本读取,只包含已发布子节点。
   * Phase 1 新增 bodyMarkdown 字段(卷首语),为空字符串=容器无正文。
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
      // 卷首语:容器节点本身的正文(serializeAnthologyIndex 的 body 段)
      bodyMarkdown: indexData.body,
      entries: await this.toEntryRefs(publishedNodes),
    };
  }

  /**
   * 获取单篇条目详情(展示端 + 管理端通用)。含正文和 prev/next 导航。
   *
   * @param usePublished true 时只在「文集已发布 + 条目已发布」时可见,正文取条目已发布
   *                     版本的冻结 snapshot;false 时取条目最新 snapshot(管理端/编辑)。
   */
  async getEntryDetail(
    contentItemId: string,
    nodeId: string,
    usePublished = false,
  ): Promise<AnthologyEntryDetailDto> {
    const anthologyNode = await this.getAnthologyNode(contentItemId);

    // 展示端:文集本身必须已发布
    if (usePublished) {
      const anthologyItem =
        await this.contentRepository.findById(contentItemId);
      if (!anthologyItem?.publishedVersion) {
        throw new NotFoundException(
          `Anthology ${contentItemId} is not published`,
        );
      }
    }

    // 兄弟列表(按 order),展示端只保留已发布的子节点
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
      nodeId: node.contentItemId,
      title: this.entryTitle(node, item),
    }));

    // 校验目标条目确实挂在该文集下且(在 usePublished 下)可见
    const entryIdx = visibleRefs.findIndex((e) => e.nodeId === nodeId);
    if (entryIdx === -1) {
      // 子节点本身可能在 navigationRepository 里存在但不属于该文集,统一抛 404
      const candidateNode =
        await this.navigationRepository.findByContentItemId(nodeId);
      if (
        !candidateNode ||
        candidateNode.parentId?.toString() !== anthologyNode._id.toString()
      ) {
        throw new NotFoundException(`Entry ${nodeId} not found`);
      }
      throw new NotFoundException(`Entry ${nodeId} not found`);
    }
    const { node: entryNode, item: entryItem } = visiblePairs[entryIdx];

    // 正文 snapshot:展示端取已发布冻结版本,管理端取最新版本
    let entrySnapshot: ContentSnapshot | null;
    if (usePublished) {
      const publishedVid = entryItem?.publishedVersion?.versionId;
      entrySnapshot = publishedVid
        ? await this.snapshotRepository.findByVersionId(publishedVid)
        : null;
    } else {
      entrySnapshot = await this.loadEntryLatestSnapshot(nodeId);
    }

    const { prev, next } = this.buildPrevNext(visibleRefs, entryIdx);

    if (!entrySnapshot) {
      // 展示端:已发布条目却查不到正文快照(版本悬空)→ 严格 404
      if (usePublished) {
        throw new NotFoundException(`Entry ${nodeId} has no content snapshot`);
      }
      // 管理端:正文快照缺失 → 返回空正文让编辑器正常打开(自愈),不堵死用户。
      return {
        nodeId,
        title: this.entryTitle(entryNode, entryItem),
        date: new Date().toISOString().split('T')[0],
        updatedAt: new Date().toISOString(),
        bodyMarkdown: '',
        prev,
        next,
      };
    }

    // updatedAt 取该子节点最新 snapshot 的 createdAt(与 NoteReader 同语义)
    const latestSnapshot = await this.loadEntryLatestSnapshot(nodeId);
    const parsed = parseEntryContent(entrySnapshot.bodyMarkdown);

    return {
      nodeId,
      title: this.entryTitle(entryNode, entryItem),
      date: parsed.date ?? entrySnapshot.createdAt.toISOString().split('T')[0],
      updatedAt: (latestSnapshot ?? entrySnapshot).createdAt.toISOString(),
      bodyMarkdown: parsed.bodyMarkdown,
      prev,
      next,
    };
  }

  /**
   * 获取单篇条目的历史版本内容(按 versionId 精确查找 snapshot)。
   * 与 NoteViewService.getByVersion 语义对等。供管理端版本时间线点击使用。
   */
  async getEntryByVersion(
    contentItemId: string,
    nodeId: string,
    versionId: string,
  ): Promise<AnthologyEntryDetailDto> {
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const entryNode =
      await this.navigationRepository.findByContentItemId(nodeId);
    if (
      !entryNode ||
      entryNode.parentId?.toString() !== anthologyNode._id.toString()
    ) {
      throw new NotFoundException(`Entry ${nodeId} not found`);
    }
    const entryItem = await this.contentRepository.findById(nodeId);

    const snapshot = await this.snapshotRepository.findByVersionId(versionId);
    if (!snapshot) {
      throw new NotFoundException(`Version ${versionId} not found`);
    }

    const parsed = parseEntryContent(snapshot.bodyMarkdown);

    // prev/next 从当前条目列表取(管理端预览历史版本,导航仍以当前列表为准)
    const children = await this.listEntryNodes(anthologyNode);
    const childItems = await Promise.all(
      children.map((n) => this.contentRepository.findById(n.contentItemId)),
    );
    const refs = children.map((n, i) => ({
      nodeId: n.contentItemId,
      title: this.entryTitle(n, childItems[i]),
    }));
    const entryIdx = refs.findIndex((e) => e.nodeId === nodeId);
    const { prev, next } = this.buildPrevNext(refs, entryIdx);

    return {
      nodeId,
      title: this.entryTitle(entryNode, entryItem),
      date: parsed.date ?? snapshot.createdAt.toISOString().split('T')[0],
      updatedAt: snapshot.createdAt.toISOString(),
      bodyMarkdown: parsed.bodyMarkdown,
      prev,
      next,
    };
  }

  /**
   * 获取单篇条目的版本历史(子 ContentItem 的 main.md 快照列表)。
   * 与 Notes 的 getHistory 语义对等。供管理端版本时间线组件使用。
   */
  async getEntryHistory(
    contentItemId: string,
    nodeId: string,
  ): Promise<ContentHistoryEntryDto[]> {
    const anthologyNode = await this.getAnthologyNode(contentItemId);
    const entryNode =
      await this.navigationRepository.findByContentItemId(nodeId);
    if (
      !entryNode ||
      entryNode.parentId?.toString() !== anthologyNode._id.toString()
    ) {
      throw new NotFoundException(`Entry ${nodeId} not found`);
    }

    const snapshots = await this.contentService.listVersionsByFileName(
      nodeId,
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

  // ── 管理端容器视图(暴露给 controller 用的轻量 DTO) ─────────────────────

  /**
   * 管理端文集容器详情:复用阅读端字段 + 状态信息(committed/published + 未发布变更)。
   * 子节点列表沿用通用页面树接口(navigation),此处只暴露容器自身视图。
   */
  async toAdminDetail(contentItemId: string): Promise<{
    id: string;
    title: string;
    description: string;
    bodyMarkdown: string;
    status: 'committed' | 'published';
    hasUnpublishedChanges: boolean;
    entries: AnthologyEntryRef[];
  }> {
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
      bodyMarkdown: indexData.body,
      status: item.publishedVersion ? 'published' : 'committed',
      hasUnpublishedChanges: item.publishedVersion
        ? item.latestVersion?.versionId !== item.publishedVersion.versionId
        : false,
      entries: await this.toEntryRefs(children),
    };
  }

  /**
   * 管理端列表 DTO:从最新版本读取,含状态信息。
   * 复用展示端 Public 的 entryCount 形状,只补 status 字段。
   */
  async toAdminListItem(contentItemId: string): Promise<
    AnthologyPublicListItemDto & {
      status: 'committed' | 'published';
      hasUnpublishedChanges: boolean;
    }
  > {
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

  // ── 草稿 CRUD(通用节点接口,容器和子节点都走这套) ────────────────────────

  /** EditorDraft 实体 → EditorDraftDto。 */
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
   * 获取节点草稿(容器或子节点 都走这套)。无草稿返回 null(200),避免 404 噪音。
   */
  async getNodeDraft(nodeId: string): Promise<EditorDraftDto | null> {
    await this.contentService.assertContentItemExists(nodeId);
    const draft = await this.editorDraftRepository.findByContentItemId(nodeId);
    if (!draft) return null;
    return this.toDraftDto(draft);
  }

  /**
   * 保存节点草稿(autosave):只写 MongoDB,不产生 Git snapshot。
   */
  async saveNodeDraft(
    nodeId: string,
    dto: SaveDraftDto,
  ): Promise<EditorDraftDto> {
    await this.contentService.assertContentEditable(nodeId);
    const draft = await this.editorDraftRepository.save({
      contentItemId: nodeId,
      title: dto.title,
      summary: dto.summary ?? '',
      bodyMarkdown: dto.bodyMarkdown,
      changeNote: dto.changeNote,
      savedAt: new Date(),
      savedBy: dto.savedBy,
    });
    return this.toDraftDto(draft);
  }

  /** 丢弃节点草稿。 */
  async deleteNodeDraft(nodeId: string): Promise<void> {
    await this.contentService.assertContentItemExists(nodeId);
    await this.editorDraftRepository.deleteByContentItemId(nodeId);
  }
}
