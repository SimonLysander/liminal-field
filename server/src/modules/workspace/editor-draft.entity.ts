/**
 * 编辑器草稿实体 — 存储在 editor_drafts MongoDB 集合。
 * 每个 contentItem 至多保留一份最近草稿（draft:${contentItemId}），
 * 用于编辑器 autosave，不产生 Git 版本记录。
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

  @prop({ required: true, trim: true })
  summary!: string;

  @prop({ required: true, trim: true })
  changeNote!: string;

  @prop({ required: true, type: () => Date, index: true })
  savedAt!: Date;

  @prop({ trim: true })
  savedBy?: string;
}
