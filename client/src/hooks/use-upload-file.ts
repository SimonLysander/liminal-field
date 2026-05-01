/**
 * useUploadFile — 编辑器图片上传 hook。
 *
 * 通过 XHR 将文件上传到自有服务器 MinIO 草稿桶，
 * 替代原来的 UploadThing 第三方 CDN。
 * 通过 DraftAssetContext 获取 contentItemId 以构建上传 URL。
 */
import * as React from 'react';

import { toast } from 'sonner';

import { useDraftAssetContext } from '@/contexts/DraftAssetContext';

/** 上传完成后的文件信息，PlaceholderElement 依赖 url 和 name 字段。 */
export interface UploadedFile {
  url: string;
  name: string;
  size: number;
  type: string;
}

interface UseUploadFileProps {
  onUploadComplete?: (file: UploadedFile) => void;
  onUploadError?: (error: unknown) => void;
}

export function useUploadFile(props: UseUploadFileProps = {}) {
  const { onUploadComplete, onUploadError } = props;
  const { contentItemId } = useDraftAssetContext();

  const [uploadedFile, setUploadedFile] = React.useState<UploadedFile>();
  const [uploadingFile, setUploadingFile] = React.useState<File>();
  const [progress, setProgress] = React.useState<number>(0);
  const [isUploading, setIsUploading] = React.useState(false);

  const uploadFile = React.useCallback(
    async (file: File) => {
      setIsUploading(true);
      setUploadingFile(file);
      setProgress(0);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const result = await new Promise<UploadedFile>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open(
            'POST',
            `/api/v1/spaces/notes/items/${contentItemId}/draft-assets`,
          );

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setProgress(Math.round((e.loaded / e.total) * 100));
            }
          };

          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              // 服务端统一包装为 { code, msg, data }，上传结果在 data.data
              const resp = JSON.parse(xhr.responseText);
              const payload = resp.data ?? resp;
              resolve({
                url: payload.path,
                name: payload.fileName,
                size: payload.size,
                type: payload.contentType,
              });
            } else {
              reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
            }
          };

          xhr.onerror = () => reject(new Error('Upload failed: network error'));
          xhr.send(formData);
        });

        setUploadedFile(result);
        onUploadComplete?.(result);
        return result;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '上传失败，请重试');
        onUploadError?.(error);
      } finally {
        setProgress(0);
        setIsUploading(false);
        setUploadingFile(undefined);
      }
    },
    [contentItemId, onUploadComplete, onUploadError],
  );

  return {
    isUploading,
    progress,
    uploadedFile,
    uploadFile,
    uploadingFile,
  };
}
