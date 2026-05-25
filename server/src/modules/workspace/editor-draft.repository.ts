/**
 * 编辑器草稿 Repository — 按 contentItemId 一对一覆盖最近草稿。
 * Autosave 只保留每个内容项最近一次服务端草稿，避免把草稿集合演化成版本历史系统。
 *
 * 两套方法：
 * - findByContentItemId / save / deleteByContentItemId：原有 notes/gallery 路径（fileName=null）
 * - findByContentItemAndFileName / saveWithFileName / deleteByContentItemAndFileName：
 *   anthology 条目专用（fileName="entries/eXXX.md"），_id 格式 "draft:{contentItemId}:{fileName}"
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
}
