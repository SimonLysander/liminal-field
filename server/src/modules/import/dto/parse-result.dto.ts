/** parse API 响应中的单个资源引用 */
export class AssetRefDto {
  /** markdown 中的原始引用路径，如 ./img/tree.png */
  ref: string;
  /** 从路径提取的文件名（basename），如 tree.png */
  filename: string;
  /** 匹配状态 */
  status: 'missing' | 'resolved';
}

/** POST /import/parse 的响应 */
export class ParseResultDto {
  parseId: string;
  title: string;
  markdown: string;
  assets: AssetRefDto[];
}
