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
import {
  NavigationNodeType,
  NavigationScope,
} from '../navigation/navigation.entity';

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
    lastUpdated: string;
  };
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
   * 将当前 MongoDB 导航树序列化写入 .liminal-field.yaml。
   *
   * 流程：
   * 1. 查询所有导航节点（无 scope 过滤，一次性取全量）
   * 2. 按 scope 分组，对各 scope 构建父子树
   * 3. 统计内容条数
   * 4. 序列化为 YAML 并落盘
   */
  async writeManifest(): Promise<void> {
    // 取全量节点：按 order ASC + _id ASC 确保序列化结果稳定，避免无意义 diff
    // NavigationRepository 没有 findAll，用 listByParentId(undefined) 只返回根节点；
    // 需要用 findAllDescendants 方式遍历，但更简单的方案是直接读底层 model。
    // 此处用 findRootNodes(scope) × each scope + findAllDescendants 递归。
    const allItems = await this.contentRepository.listAll();

    const navigation: Record<string, ManifestNode[]> = {};

    for (const scope of Object.values(NavigationScope)) {
      const roots = await this.navigationRepository.findRootNodes(scope);
      navigation[scope] = await Promise.all(
        roots.map((root) => this.serializeNode(root._id.toString())),
      );
    }

    // 统计：按 scope 统计关联到内容节点的数量
    const notesCount = await this.countContentNodesByScope(
      NavigationScope.notes,
    );
    const galleryCount = await this.countContentNodesByScope(
      NavigationScope.gallery,
    );

    const manifest: Manifest = {
      version: MANIFEST_VERSION,
      navigation,
      stats: {
        totalItems: allItems.length,
        notes: notesCount,
        gallery: galleryCount,
        lastUpdated: new Date().toISOString(),
      },
    };

    const yamlContent = yaml.dump(manifest, {
      indent: 2,
      lineWidth: 120,
      quotingType: '"',
    });

    const manifestPath = join(this.repoRoot, MANIFEST_FILE_NAME);
    await writeFile(manifestPath, yamlContent, 'utf8');
    this.logger.log(
      `Manifest written: ${allItems.length} items, ${Object.keys(navigation).join('/')} scopes`,
    );
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

    const isFolder = node.nodeType === NavigationNodeType.subject;
    const children =
      await this.navigationRepository.findChildrenByParentId(nodeId);

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

    // 广度优先遍历统计 content 节点
    const queue = [...roots];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (node.nodeType === NavigationNodeType.content) {
        count++;
      }
      const children = await this.navigationRepository.findChildrenByParentId(
        node._id.toString(),
      );
      queue.push(...children);
    }

    return count;
  }
}
