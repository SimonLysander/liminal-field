/**
 * 编辑器草稿 Repository — 按 contentItemId 一对一覆盖最近草稿。
 * Autosave 只保留每个内容项最近一次服务端草稿，避免把草稿集合演化成版本历史系统。
 *
 * 三套方法，前缀严格隔离：
 * - findByContentItemId / save / deleteByContentItemId：原有 notes/gallery 路径（draft:{id}，fileName=null）
 * - findByContentItemAndFileName / saveWithFileName / deleteByContentItemAndFileName：
 *   anthology 条目专用（draft:{id}:{fileName}），_id 格式 "draft:{contentItemId}:{fileName}"
 * - findAiDraftByContentItemId / saveAiDraft / deleteAiDraftByContentItemId：
 *   AI 初稿专用（aidraft:{id}），对用户只读、永不参与 commit/publish 流水线
 *
 * ⚠ 隔离红线：commit/publish 流水线只调 draft: 系列方法；aidraft: 系列由学习模块独立管理。
 */
import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import type { ReturnModelType } from '@typegoose/typegoose';
import { getModelToken } from 'nestjs-typegoose';
import { EditorDraft } from './editor-draft.entity';

export interface SaveEditorDraftInput {
  contentItemId: string;
  bodyMarkdown: string;
  title: string;
  summary: string;
  changeNote: string;
  savedAt: Date;
  savedBy?: string;
}

export interface SaveEditorDraftWithFileNameInput extends SaveEditorDraftInput {
  fileName: string;
}

/**
 * AI 初稿保存参数 — 与 SaveEditorDraftInput 字段对齐，无 fileName（AI 初稿不区分条目）。
 * changeNote 记录 Aurora 生成批次信息（如 "aurora-gen-v1"），便于追溯。
 */
export interface SaveAiDraftInput {
  contentItemId: string;
  bodyMarkdown: string;
  title: string;
  summary: string;
  changeNote: string;
  savedAt: Date;
  savedBy?: string;
}

@Injectable()
export class EditorDraftRepository {
  constructor(
    @Inject(getModelToken(EditorDraft.name))
    private readonly editorDraftModel: ReturnModelType<typeof EditorDraft>,
  ) {}

  private buildDraftId(contentItemId: string): string {
    return `draft:${contentItemId}`;
  }

  /**
   * 构建带 fileName 的草稿 _id（anthology 条目专用）。
   * fileName 中的斜杠保留："draft:{contentItemId}:entries/eXXX.md"。
   */
  private buildDraftIdWithFileName(
    contentItemId: string,
    fileName: string,
  ): string {
    return `draft:${contentItemId}:${fileName}`;
  }

  /**
   * 构建 AI 初稿 _id。
   * 前缀 "aidraft:" 与 "draft:" 严格分离，确保 commit/publish 流水线按精确 _id 查询时天然看不见它。
   * 不带 fileName，避免与 anthology 的 "draft:{id}:{fileName}" 撞结构。
   */
  buildAiDraftId(contentItemId: string): string {
    return `aidraft:${contentItemId}`;
  }

  // ─── Notes/Gallery 草稿（fileName=null）──────────────────────────────────

  async findByContentItemId(
    contentItemId: string,
  ): Promise<EditorDraft | null> {
    return this.editorDraftModel.findById(this.buildDraftId(contentItemId));
  }

  async save(input: SaveEditorDraftInput): Promise<EditorDraft> {
    const draft = await this.editorDraftModel.findByIdAndUpdate(
      this.buildDraftId(input.contentItemId),
      {
        $set: {
          contentItemId: input.contentItemId,
          bodyMarkdown: input.bodyMarkdown,
          title: input.title,
          summary: input.summary,
          changeNote: input.changeNote,
          savedAt: input.savedAt,
          savedBy: input.savedBy,
          fileName: null,
        },
      },
      {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    if (!draft) {
      throw new InternalServerErrorException('Failed to persist editor draft');
    }

    return draft;
  }

  async deleteByContentItemId(contentItemId: string): Promise<void> {
    await this.editorDraftModel.findByIdAndDelete(
      this.buildDraftId(contentItemId),
    );
  }

  // ─── Anthology 条目草稿（fileName 非 null）───────────────────────────────

  /** 查询条目草稿。无草稿返回 null。 */
  async findByContentItemAndFileName(
    contentItemId: string,
    fileName: string,
  ): Promise<EditorDraft | null> {
    return this.editorDraftModel.findById(
      this.buildDraftIdWithFileName(contentItemId, fileName),
    );
  }

  /** 保存条目草稿（upsert）。 */
  async saveWithFileName(
    input: SaveEditorDraftWithFileNameInput,
  ): Promise<EditorDraft> {
    const draft = await this.editorDraftModel.findByIdAndUpdate(
      this.buildDraftIdWithFileName(input.contentItemId, input.fileName),
      {
        $set: {
          contentItemId: input.contentItemId,
          bodyMarkdown: input.bodyMarkdown,
          title: input.title,
          summary: input.summary,
          changeNote: input.changeNote,
          savedAt: input.savedAt,
          savedBy: input.savedBy,
          fileName: input.fileName,
        },
      },
      {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    if (!draft) {
      throw new InternalServerErrorException(
        'Failed to persist entry editor draft',
      );
    }

    return draft;
  }

  /** 删除条目草稿。 */
  async deleteByContentItemAndFileName(
    contentItemId: string,
    fileName: string,
  ): Promise<void> {
    await this.editorDraftModel.findByIdAndDelete(
      this.buildDraftIdWithFileName(contentItemId, fileName),
    );
  }

  // ─── AI 初稿（aidraft: 前缀，Aurora 生成，对用户只读）────────────────────────
  //
  // 隔离原理：所有现有 commit/publish 路径（note-view / gallery-view / workspace.service）
  // 均通过 buildDraftId("draft:"+id) 精确查询 _id，不做前缀扫描/正则。
  // aidraft: 前缀的文档对这些路径天然不可见，无需在调用方增加过滤条件。
  //
  // 唯一例外：LocalResetService.clearDrafts() 用 deleteMany({}) 会连带清空 aidraft。
  // 这是正确行为——clear-local/sync-from-remote 要清除所有本地 WIP，AI 初稿亦在其列。

  /** 查询 AI 初稿。无初稿返回 null。 */
  async findAiDraftByContentItemId(
    contentItemId: string,
  ): Promise<EditorDraft | null> {
    return this.editorDraftModel.findById(this.buildAiDraftId(contentItemId));
  }

  /**
   * 保存 AI 初稿（upsert）。每次 Aurora 生成新内容时覆盖，只保留最新一份。
   * fileName 固定 null，与 notes/gallery 草稿结构对齐，不引入条目层级。
   */
  async saveAiDraft(input: SaveAiDraftInput): Promise<EditorDraft> {
    const draft = await this.editorDraftModel.findByIdAndUpdate(
      this.buildAiDraftId(input.contentItemId),
      {
        $set: {
          contentItemId: input.contentItemId,
          bodyMarkdown: input.bodyMarkdown,
          title: input.title,
          summary: input.summary,
          changeNote: input.changeNote,
          savedAt: input.savedAt,
          savedBy: input.savedBy,
          fileName: null,
        },
      },
      {
        returnDocument: 'after',
        upsert: true,
        setDefaultsOnInsert: true,
      },
    );

    if (!draft) {
      throw new InternalServerErrorException(
        'Failed to persist AI draft (aidraft)',
      );
    }

    return draft;
  }

  /** 删除 AI 初稿（学习节点删除时清理，或手动重置）。 */
  async deleteAiDraftByContentItemId(contentItemId: string): Promise<void> {
    await this.editorDraftModel.findByIdAndDelete(
      this.buildAiDraftId(contentItemId),
    );
  }
}
