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

export interface BatchParsedItem {
  relativePath: string;
  parseId: string;
  title: string;
  missingAssets: string[];
}

export interface BatchParsedResult {
  batchId: string;
  items: BatchParsedItem[];
}

export interface BatchConfirmResult {
  jobId: string;
  foldersCreated: number;
  docsCreated: number;
}

export interface BatchSession {
  _id: string;
  parentId: string;
  items: Array<{ parseId: string; relativePath: string; title: string }>;
}

export const importApi = {
  parse: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ParseResult>('/spaces/notes/import/parse', {
      method: 'POST',
      body: form,
    });
  },

  getParse: (parseId: string) =>
    request<ParseResult>(`/spaces/notes/import/parse/${parseId}`),

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

  confirm: (parseId: string, parentId?: string, title?: string) =>
    request<ImportConfirmResult>('/spaces/notes/import/confirm', {
      method: 'POST',
      body: JSON.stringify({ parseId, parentId, title }),
    }),

  batchParse: (formData: FormData) =>
    request<BatchParsedResult>('/spaces/notes/import/batch-parse', {
      method: 'POST',
      body: formData,
    }),

  batchConfirm: (dto: { batchId: string; parentId: string; selectedPaths: string[] }) =>
    request<BatchConfirmResult>('/spaces/notes/import/batch-confirm', {
      method: 'POST',
      body: JSON.stringify(dto),
    }),

  getBatch: (batchId: string) =>
    request<BatchSession>(`/spaces/notes/import/batch/${batchId}`),

  cancelBatch: (batchId: string) =>
    request<void>(`/spaces/notes/import/batch/${batchId}`, { method: 'DELETE' }),

  cancelParse: (parseId: string) =>
    request<void>(`/spaces/notes/import/parse/${parseId}`, { method: 'DELETE' }),

  getBatchJobProgress: (jobId: string) =>
    request<BatchJobProgress>(`/spaces/notes/import/batch-job/${jobId}`),
};

export interface BatchJobProgress {
  total: number;
  completed: number;
  status: 'processing' | 'done' | 'failed';
  foldersCreated: number;
}
