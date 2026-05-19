/**
 * 编辑器草稿实体 — 存储在 editor_drafts MongoDB 集合。
 *
 * 两类草稿共用此实体，通过 _id 格式区分：
 * - Notes/Gallery 单文件草稿：_id = "draft:{contentItemId}"，fileName = null
 * - Anthology 条目草稿：_id = "draft:{contentItemId}:{fileName}"，fileName = "entries/eXXX.md"
 *
 * fileName 字段为 null 时，兼容原有 notes/gallery 逻辑（findByContentItemId/upsert/deleteByContentItemId）。
 */
import { modelOptions, prop, Severity } from '@typegoose/typegoose';

@modelOptions({
  schemaOptions: {
    collection: 'editor_drafts',
  },
  options: { allowMixed: Severity.ERROR },
})
export class EditorDraft {
  @prop({ required: true, trim: true })
  _id!: string;

  @prop({ required: true, trim: true, index: true })
  contentItemId!: string;

  @prop({ required: true })
  bodyMarkdown!: string;

  @prop({ required: true, trim: true })
  title!: string;

  @prop({ trim: true })
  summary?: string;

  @prop({ required: true, trim: true })
  changeNote!: string;

  @prop({ required: true, type: () => Date, index: true })
  savedAt!: Date;

  @prop({ trim: true })
  savedBy?: string;

  /**
   * 关联的文件名（仅 anthology 条目草稿使用）。
   * null 表示主文档草稿（notes/gallery），"entries/eXXX.md" 表示条目草稿。
   */
  @prop({ type: String, default: null })
  fileName?: string | null;
}
