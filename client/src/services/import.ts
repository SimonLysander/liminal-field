import { request } from './request';

export interface AssetRef {
  ref: string;
  filename: string;
  status: 'missing' | 'resolved';
}

export interface ParseResult {
  parseId: string;
  title: string;
  markdown: string;
  assets: AssetRef[];
}

export interface ImportConfirmResult {
  nodeId: string;
  contentItemId: string;
}

export const importApi = {
  /** 上传 .md 文件进行解析 */
  parse: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ParseResult>('/spaces/notes/import/parse', {
      method: 'POST',
      body: form,
    });
  },

  /** 上传文件夹内容，按文件名匹配缺失资源 */
  resolveAssets: (parseId: string, files: FileList) => {
    const form = new FormData();
    form.append('parseId', parseId);
    for (let i = 0; i < files.length; i++) {
      form.append('files', files[i]);
    }
    return request<AssetRef[]>('/spaces/notes/import/resolve-assets', {
      method: 'POST',
      body: form,
    });
  },

  /** 确认导入：正式创建 node + content item */
  confirm: (parseId: string, parentId?: string, title?: string) =>
    request<ImportConfirmResult>('/spaces/notes/import/confirm', {
      method: 'POST',
      body: JSON.stringify({ parseId, parentId, title }),
    }),
};
