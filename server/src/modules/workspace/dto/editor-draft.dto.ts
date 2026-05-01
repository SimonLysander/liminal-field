export class EditorDraftDto {
  id!: string;
  contentItemId!: string;
  title!: string;
  summary!: string;
  bodyMarkdown!: string;
  changeNote!: string;
  savedAt!: string;
  savedBy?: string;
}
