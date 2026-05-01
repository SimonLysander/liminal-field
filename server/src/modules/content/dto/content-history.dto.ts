export class ContentHistoryEntryDto {
  commitHash!: string;
  committedAt!: string;
  authorName!: string;
  authorEmail!: string;
  message!: string;
  action!: 'commit' | 'unknown';
}
