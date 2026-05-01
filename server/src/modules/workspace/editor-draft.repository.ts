/**
 * 编辑器草稿 Repository — 按 contentItemId 一对一覆盖最近草稿。
 * Autosave 只保留每个内容项最近一次服务端草稿，避免把草稿集合演化成版本历史系统。
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

@Injectable()
export class EditorDraftRepository {
  constructor(
    @Inject(getModelToken(EditorDraft.name))
    private readonly editorDraftModel: ReturnModelType<typeof EditorDraft>,
  ) {}

  private buildDraftId(contentItemId: string): string {
    return `draft:${contentItemId}`;
  }

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
}
