/**
 * ManifestService — 仓库清单读写。
 *
 * 清单文件 .liminal-field.yaml 存储导航树结构和统计信息，
 * 随 Git push 一起提交，供灾难恢复时重建 MongoDB 导航索引。
 *
 * 依赖关系：
 * - NavigationRepository：读取全部导航节点，构建树形结构
 * - ContentRepository：统计内容数量（按 scope 分组）
 * - ContentRepoService：获取 repoRoot 路径，确保与 Git 层使用相同的磁盘路径
 */
import { Injectable, Logger } from '@nestjs/common';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import * as yaml from 'js-yaml';
import { NavigationRepository } from '../navigation/navigation.repository';
import { ContentRepository } from '../content/content.repository';
import { ContentRepoService } from '../content/content-repo.service';
import { NavigationScope } from '../navigation/navigation.entity';

/** 清单中单个导航节点的序列化结构 */
export interface ManifestNode {
  id: string;
  name: string;
  /** FOLDER = 科目节点，DOC = 内容节点 */
  type: 'FOLDER' | 'DOC';
  contentItemId?: string;
  order: number;
  children?: ManifestNode[];
}

/** 清单顶层结构 */
export interface Manifest {
  /** 格式版本，向后兼容用 */
  version: number;
  /** 按 scope 分组的导航树，key = scope 枚举值 */
  navigation: Record<string, ManifestNode[]>;
  stats: {
    totalItems: number;
    notes: number;
    gallery: number;
    anthology: number;
  };
}

/**
 * 推送前给 UI 展示的 manifest 差异:列出哪些节点的结构/顺序变了。
 * 路径形如 "/notes/随笔/2025 笔记",根用 scope 名兜底。
 */
export interface ManifestDiff {
  /** 同 id 节点,位置改变(同父级 order 改 或 跨父级移动) */
  reorderedPaths: string[];
  /** 同 id 节点改名,from = 磁盘旧路径,to = mongo 新路径 */
  renamedPaths: { from: string; to: string }[];
  /** mongo 有但磁盘 yaml 没有的节点 */
  addedPaths: string[];
  /** 磁盘 yaml 有但 mongo 没有的节点(只有手动删才会出现) */
  removedPaths: string[];
  /** 4 类总数,前端用来判 "无变化" */
  totalChanges: number;
}

/** flattenManifest 输出:id → 节点扁平信息,给 diff 算法用 */
interface FlatNode {
  id: string;
  /** 从根 (scope) 一路拼接的人类可读路径 */
  path: string;
  name: string;
  order: number;
  parentId: string | null;
}

const MANIFEST_FILE_NAME = '.liminal-field.yaml';
const MANIFEST_VERSION = 1;

@Injectable()
export class ManifestService {
  private readonly logger = new Logger(ManifestService.name);
  private readonly repoRoot: string;

  constructor(
    private readonly navigationRepository: NavigationRepository,
    private readonly contentRepository: ContentRepository,
    private readonly contentRepoService: ContentRepoService,
  ) {
    // 与 ContentRepoService / ContentGitService 使用同一个已解析的绝对路径
    this.repoRoot = this.contentRepoService.repoRoot;
  }

  /**
   * 从当前 MongoDB 导航树序列化出 yaml 字符串(不落盘),给 writeManifest 和
   * computeManifestDiff 共用。提取出来避免 dirty 检测每次都写文件。
   */
  async serializeManifestToYaml(): Promise<string> {
    const allItems = await this.contentRepository.listAll();
    const navigation: Record<string, ManifestNode[]> = {};
    for (const scope of Object.values(NavigationScope)) {
      const roots = await this.navigationRepository.findRootNodes(scope);
      navigation[scope] = await Promise.all(
        roots.map((root) => this.serializeNode(root._id.toString())),
      );
    }
    const notesCount = await this.countContentNodesByScope(
      NavigationScope.notes,
    );
    const galleryCount = await this.countContentNodesByScope(
      NavigationScope.gallery,
    );
    const anthologyCount = await this.countContentNodesByScope(
      NavigationScope.anthology,
    );
    const manifest: Manifest = {
      version: MANIFEST_VERSION,
      navigation,
      stats: {
        totalItems: allItems.length,
        notes: notesCount,
        gallery: galleryCount,
        anthology: anthologyCount,
      },
    };
    return yaml.dump(manifest, {
      indent: 2,
      lineWidth: 120,
      quotingType: '"',
    });
  }

  /**
   * 将当前 MongoDB 导航树序列化写入 .liminal-field.yaml。
   */
  async writeManifest(): Promise<void> {
    const yamlContent = await this.serializeManifestToYaml();
    const manifestPath = join(this.repoRoot, MANIFEST_FILE_NAME);
    await writeFile(manifestPath, yamlContent, 'utf8');
    this.logger.log(`Manifest written`);
  }

  /**
   * 检查 mongo 当前 order 派生的 yaml 跟磁盘 .liminal-field.yaml 是否字节一致。
   *
   * 用途:让 syncStatus 知道"有 reorder 但 git 没提交"——平时 reorder
   * 不触发 commit,这个 diff 信号让 UI 把同步状态标"未同步"+ 按钮可点。
   */
  async isManifestDirty(): Promise<boolean> {
    const current = await this.serializeManifestToYaml();
    const onDisk = await this.readManifestRaw();
    return current !== onDisk;
  }

  /**
   * 算 mongo 派生 manifest vs 磁盘 .liminal-field.yaml 的语义 diff,
   * 给推送 dialog 展示"本次会推什么"。
   *
   * 算法:把两边 manifest 树拍平成 id-indexed Map,然后按 id 集合做四类比对——
   * 新增/移除/改名/位置变化(同父级 order 改 或 跨父级移动统一归位置)。
   * 同时 name 和 parent 都变时优先归 renamed(from→to 信息已含 parent 路径)。
   */
  async computeManifestDiff(): Promise<ManifestDiff> {
    const currentYaml = await this.serializeManifestToYaml();
    const onDiskYaml = await this.readManifestRaw();

    const current = yaml.load(currentYaml) as Manifest | null;
    const onDisk = onDiskYaml
      ? (yaml.load(onDiskYaml) as Manifest | null)
      : null;

    const currentIndex = current
      ? this.flattenManifest(current)
      : new Map<string, FlatNode>();
    const onDiskIndex = onDisk
      ? this.flattenManifest(onDisk)
      : new Map<string, FlatNode>();

    const addedPaths: string[] = [];
    const removedPaths: string[] = [];
    const renamedPaths: { from: string; to: string }[] = [];
    const reorderedPaths: string[] = [];

    for (const [id, c] of currentIndex) {
      const o = onDiskIndex.get(id);
      if (!o) {
        addedPaths.push(c.path);
        continue;
      }
      if (c.name !== o.name) {
        renamedPaths.push({ from: o.path, to: c.path });
      } else if (c.parentId !== o.parentId || c.order !== o.order) {
        reorderedPaths.push(c.path);
      }
    }
    for (const [id, o] of onDiskIndex) {
      if (!currentIndex.has(id)) removedPaths.push(o.path);
    }

    return {
      reorderedPaths,
      renamedPaths,
      addedPaths,
      removedPaths,
      totalChanges:
        reorderedPaths.length +
        renamedPaths.length +
        addedPaths.length +
        removedPaths.length,
    };
  }

  /** 把 manifest 树按 BFS 拍平成 id-indexed Map,记录节点的完整路径 */
  private flattenManifest(m: Manifest): Map<string, FlatNode> {
    const out = new Map<string, FlatNode>();
    const navigation = m.navigation ?? {};
    for (const [scope, roots] of Object.entries(navigation)) {
      const queue: Array<{
        node: ManifestNode;
        parentPath: string;
        parentId: string | null;
      }> = (roots ?? []).map((root) => ({
        node: root,
        parentPath: `/${scope}`,
        parentId: null,
      }));
      while (queue.length > 0) {
        const { node, parentPath, parentId } = queue.shift()!;
        const path = `${parentPath}/${node.name}`;
        out.set(node.id, {
          id: node.id,
          path,
          name: node.name,
          order: node.order,
          parentId,
        });
        if (node.children?.length) {
          for (const child of node.children) {
            queue.push({ node: child, parentPath: path, parentId: node.id });
          }
        }
      }
    }
    return out;
  }

  /** 读 yaml 文件原始字节(不解析,给 dirty 检测用)。文件不存在返空串。 */
  private async readManifestRaw(): Promise<string> {
    const manifestPath = join(this.repoRoot, MANIFEST_FILE_NAME);
    try {
      return await readFile(manifestPath, 'utf8');
    } catch {
      return '';
    }
  }

  /**
   * 从磁盘读取清单文件并解析。文件不存在时返回 null，不抛出异常。
   */
  async readManifest(): Promise<Manifest | null> {
    const manifestPath = join(this.repoRoot, MANIFEST_FILE_NAME);
    try {
      const content = await readFile(manifestPath, 'utf8');
      return yaml.load(content) as Manifest;
    } catch (err: unknown) {
      // ENOENT 表示清单尚未生成（新仓库或迁移前），属于正常情况
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      this.logger.warn(
        `读取清单失败: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /** 检查清单文件是否存在 */
  async manifestExists(): Promise<boolean> {
    try {
      await readFile(join(this.repoRoot, MANIFEST_FILE_NAME), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 递归序列化单个节点及其所有子节点。
   * 子节点按 MongoDB 中存储的 order 排序（findChildrenByParentId 已排序）。
   */
  private async serializeNode(nodeId: string): Promise<ManifestNode> {
    const node = await this.navigationRepository.findById(nodeId);
    if (!node) {
      // 防御性处理：理论上不会发生，但避免硬崩溃
      return { id: nodeId, name: '', type: 'FOLDER', order: 0 };
    }

    const children =
      await this.navigationRepository.findChildrenByParentId(nodeId);
    // 节点同质化:有子节点 = 文件夹,叶子 = 文档。
    const isFolder = children.length > 0;

    const manifestNode: ManifestNode = {
      id: node._id.toString(),
      name: node.name,
      type: isFolder ? 'FOLDER' : 'DOC',
      order: node.order,
    };

    if (node.contentItemId) {
      manifestNode.contentItemId = node.contentItemId;
    }

    if (children.length > 0) {
      manifestNode.children = await Promise.all(
        children.map((child) => this.serializeNode(child._id.toString())),
      );
    }

    return manifestNode;
  }

  /** 统计指定 scope 下内容类型节点（DOC 节点）的数量 */
  private async countContentNodesByScope(scope: string): Promise<number> {
    const roots = await this.navigationRepository.findRootNodes(scope);
    let count = 0;

    // 广度优先遍历统计内容（叶子）节点。节点同质化:叶子(无子节点) = 一篇内容。
    const queue = [...roots];
    while (queue.length > 0) {
      const node = queue.shift()!;
      const children = await this.navigationRepository.findChildrenByParentId(
        node._id.toString(),
      );
      if (children.length === 0) {
        count++;
      }
      queue.push(...children);
    }

    return count;
  }
}
