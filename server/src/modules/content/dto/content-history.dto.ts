export class ContentHistoryEntryDto {
  /** V2: versionId（nanoid），不依赖 Git commitHash */
  versionId!: string;
  /** Git commitHash，异步回填，未完成时为空字符串 */
  commitHash!: string;
  committedAt!: string;
  changeType!: string;
  changeNote!: string;
  title!: string;
}
