/**
 * LocalResetService — 「清空本地 / 从远端恢复」时,清理那些不在 content/snapshot/navigation
 * 三件套里、却与内容耦合的本地数据。
 *
 * 背景(踩坑):clear-local / sync-from-remote 历史上只删 content_items / content_snapshots /
 * navigation_nodes + Git 仓,漏删了 editor_drafts(草稿),导致内容删了草稿还在 → 下次撞 id
 * 会读到陈旧"幽灵草稿"。本服务把这类清理收口到一处,按操作语义粒度调用:
 * - clear-local(彻底清空本地):草稿 + project 类 Lux 记忆(绑定文章,文章没了即孤儿)+ OSS 资产。
 *   保留 user 类记忆(所有者画像,与具体内容无关)。
 * - sync-from-remote(用远端覆盖本地):只清草稿(本地 WIP,远端没有);记忆/资产由恢复链处理,
 *   内容会以相同 id 回来,project 记忆仍有效,故不清。
 *
 * 不直接复用 AgentMemoryRepository / EditorDraftRepository:前者所在的 AgentModule 已 import
 * SettingsModule(单向依赖),反向 import 会形成循环;后者未被 WorkspaceModule 导出。故本服务
 * 经 TypegooseModule.forFeature 直接持有这两个集合的 model。
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from 'nestjs-typegoose';
import { ReturnModelType } from '@typegoose/typegoose';
import { EditorDraft } from '../workspace/editor-draft.entity';
import { AgentMemory } from '../agent/memory/agent-memory.entity';
import { OssService } from '../oss/oss.service';

@Injectable()
export class LocalResetService {
  private readonly logger = new Logger(LocalResetService.name);

  constructor(
    @InjectModel(EditorDraft)
    private readonly editorDraftModel: ReturnModelType<typeof EditorDraft>,
    @InjectModel(AgentMemory)
    private readonly agentMemoryModel: ReturnModelType<typeof AgentMemory>,
    private readonly ossService: OssService,
  ) {}

  /** 清空全部编辑草稿。clear-local 与 sync-from-remote 都需要(草稿是本地 WIP,内容一删即孤儿)。 */
  async clearDrafts(): Promise<number> {
    const { deletedCount } = await this.editorDraftModel.deleteMany({});
    return deletedCount ?? 0;
  }

  /**
   * 清空 project 类 Lux 记忆(绑定具体文章)。仅 clear-local 用——彻底清空后这些记忆已成孤儿。
   * 刻意保留 user 类(所有者画像),它与具体内容无关,不应随内容清空一并抹掉。
   */
  async clearProjectMemories(): Promise<number> {
    const { deletedCount } = await this.agentMemoryModel.deleteMany({
      type: 'project',
    });
    return deletedCount ?? 0;
  }

  /**
   * 清空 OSS 永久内容资产(assets/ 前缀)。仅 clear-local 用。
   * OSS 未配置/不可用时不致命——记日志后继续,不阻断清空主流程。
   */
  async clearContentAssets(): Promise<void> {
    try {
      await this.ossService.removeByPrefix('assets/');
    } catch (err: unknown) {
      this.logger.warn(
        `清理 OSS 资产失败(非致命): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
