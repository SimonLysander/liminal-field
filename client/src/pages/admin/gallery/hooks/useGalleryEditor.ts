/*
 * useGalleryEditor — 画廊编辑页核心状态 hook
 *
 * 职责：
 *   1. 加载帖子详情 + 草稿（优先草稿，否则回退到正式版本）
 *   2. 标题 / 随笔内容的 1500ms debounce 自动保存到草稿
 *   3. 照片操作（重排、上传、删除、说明、封面）立即保存 meta
 *   4. 位置标签更新立即保存 meta
 *   5. 手动保存：PUT /items/:id（Git commit）+ 删除草稿
 *   6. 新建帖子
 *
 * 关于 effectiveId：
 *   新建场景传 undefined，创建成功后 effectiveId 更新为真实 ID，
 *   自动保存等依赖 ID 的逻辑才能正常工作。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { toast } from 'sonner';
import {
  galleryApi,
  type GalleryPhoto,
  type GalleryPostDetail,
  type PhotoMetaItem,
  type SaveDraftDto,
} from '@/services/workspace';

// ─── 状态类型 ───

type SaveStatus = 'saved' | 'dirty' | 'saving';

export interface GalleryEditorState {
  loading: boolean;
  title: string;
  prose: string;
  photos: GalleryPhoto[];
  tags: Record<string, string>;
  coverPhotoFileName: string | null;
  saveStatus: SaveStatus;
}

export interface GalleryEditorActions {
  updateTitle: (value: string) => void;
  updateProse: (value: string) => void;
  reorderPhotos: (fromIndex: number, toIndex: number) => void;
  updateCaption: (photoId: string, caption: string) => void;
  uploadPhotos: (files: File[]) => Promise<void>;
  deletePhoto: (photoId: string) => void;
  setCover: (photoId: string) => void;
  updateLocation: (location: string | undefined) => void;
  save: () => Promise<void>;
  createPost: () => Promise<string>;
}

// ─── Hook ───

export function useGalleryEditor(postId: string | undefined): GalleryEditorState & GalleryEditorActions {
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [prose, setProse] = useState('');
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  const [tags, setTags] = useState<Record<string, string>>({});
  const [coverPhotoFileName, setCoverPhotoFileName] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

  // effectiveId：新建时为 undefined，创建后更新为真实 ID
  const effectiveIdRef = useRef<string | undefined>(postId);
  // 始终指向最新的 title/prose，供 auto-save effect 读取
  const titleRef = useRef(title);
  const proseRef = useRef(prose);

  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { proseRef.current = prose; }, [prose]);

  // ─── 初始化加载 ───

  useEffect(() => {
    if (!postId) {
      // 新建场景：无需加载，直接就绪
      setLoading(false);
      return;
    }

    const init = async () => {
      setLoading(true);
      try {
        // 先尝试加载草稿，失败则静默忽略
        let draft = null;
        try {
          draft = await galleryApi.getDraft(postId);
        } catch { /* 无草稿，正常情况 */ }

        const detail: GalleryPostDetail = await galleryApi.getById(postId);

        // 草稿优先：标题和随笔从草稿恢复，照片/元数据始终从正式版本取
        if (draft) {
          setTitle(draft.title);
          setProse(draft.bodyMarkdown === '\u200B' ? '' : draft.bodyMarkdown);
        } else {
          setTitle(detail.title);
          setProse(detail.description === '\u200B' ? '' : (detail.description ?? ''));
        }

        setPhotos(detail.photos ?? []);
        setTags(detail.tags ?? {});
        setCoverPhotoFileName(detail.coverPhotoFileName ?? null);
        setSaveStatus('saved');
      } catch {
        toast.error('加载画廊动态失败');
      } finally {
        setLoading(false);
      }
    };

    void init();
  }, [postId]);

  // ─── 自动保存草稿（1500ms debounce） ───

  const saveDraft = useCallback(async () => {
    const id = effectiveIdRef.current;
    if (!id) return;

    setSaveStatus('saving');
    const payload: SaveDraftDto = {
      title: titleRef.current,
      summary: titleRef.current,
      bodyMarkdown: proseRef.current || '\u200B',
      changeNote: '自动保存',
    };

    try {
      await galleryApi.saveDraft(id, payload);
      setSaveStatus('saved');
    } catch {
      // 自动保存失败时不打断用户，但还原为 dirty 状态以便下次重试
      setSaveStatus('dirty');
    }
  }, []);

  // 仅在 title / prose 变脏时触发 debounce
  useEffect(() => {
    const id = effectiveIdRef.current;
    if (!id || saveStatus !== 'dirty') return;
    const timer = window.setTimeout(() => void saveDraft(), 1500);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveStatus, postId, title, prose]);

  // ─── 辅助：保存照片 meta ───

  const savePhotoMeta = useCallback(
    async (
      nextPhotos: GalleryPhoto[],
      nextCover: string | null,
      nextTags: Record<string, string>,
    ) => {
      const id = effectiveIdRef.current;
      if (!id) return;

      const photoMeta: PhotoMetaItem[] = nextPhotos.map((p, i) => ({
        fileName: p.fileName,
        caption: p.caption,
        order: i,
      }));

      try {
        const updated = await galleryApi.updateMeta(id, {
          photos: photoMeta,
          coverPhotoFileName: nextCover,
          tags: nextTags,
        });
        // 用服务端返回值更新本地状态，确保数据一致
        setPhotos(updated.photos ?? []);
        setTags(updated.tags ?? {});
        setCoverPhotoFileName(updated.coverPhotoFileName ?? null);
      } catch {
        toast.error('保存元数据失败');
      }
    },
    [],
  );

  // ─── 文本更新（标记 dirty，触发 debounce auto-save） ───

  const updateTitle = useCallback((value: string) => {
    setTitle(value);
    setSaveStatus('dirty');
  }, []);

  const updateProse = useCallback((value: string) => {
    setProse(value);
    setSaveStatus('dirty');
  }, []);

  // ─── 照片操作（立即保存 meta） ───

  const reorderPhotos = useCallback(
    (fromIndex: number, toIndex: number) => {
      setPhotos((prev) => {
        const next = arrayMove(prev, fromIndex, toIndex);
        void savePhotoMeta(next, coverPhotoFileName, tags);
        return next;
      });
    },
    [coverPhotoFileName, tags, savePhotoMeta],
  );

  const updateCaption = useCallback(
    (photoId: string, caption: string) => {
      setPhotos((prev) => {
        const next = prev.map((p) => (p.id === photoId ? { ...p, caption } : p));
        void savePhotoMeta(next, coverPhotoFileName, tags);
        return next;
      });
    },
    [coverPhotoFileName, tags, savePhotoMeta],
  );

  const uploadPhotos = useCallback(
    async (files: File[]) => {
      const id = effectiveIdRef.current;
      if (!id) return;

      try {
        // 逐个上传，上传完成后统一从 API 重新拉取照片列表
        await Promise.all(files.map((file) => galleryApi.uploadPhoto(id, file)));
        const detail = await galleryApi.getById(id);
        setPhotos(detail.photos ?? []);
        toast.success(`已上传 ${files.length} 张照片`);
      } catch {
        toast.error('照片上传失败');
      }
    },
    [],
  );

  const deletePhoto = useCallback(
    (photoId: string) => {
      const id = effectiveIdRef.current;
      if (!id) return;

      void (async () => {
        try {
          await galleryApi.deletePhoto(id, photoId);
          setPhotos((prev) => {
            const next = prev.filter((p) => p.id !== photoId);
            // 若删的是封面照片，清除封面引用
            const nextCover = coverPhotoFileName === prev.find((p) => p.id === photoId)?.fileName
              ? null
              : coverPhotoFileName;
            void savePhotoMeta(next, nextCover, tags);
            return next;
          });
        } catch {
          toast.error('删除照片失败');
        }
      })();
    },
    [coverPhotoFileName, tags, savePhotoMeta],
  );

  const setCover = useCallback(
    (photoId: string) => {
      setPhotos((prev) => {
        const photo = prev.find((p) => p.id === photoId);
        if (!photo) return prev;
        const nextCover = photo.fileName;
        setCoverPhotoFileName(nextCover);
        void savePhotoMeta(prev, nextCover, tags);
        return prev;
      });
    },
    [tags, savePhotoMeta],
  );

  // ─── 位置标签更新（立即保存 meta） ───

  const updateLocation = useCallback(
    (location: string | undefined) => {
      setTags((prev) => {
        const next = { ...prev };
        if (location) {
          next['location'] = location;
        } else {
          delete next['location'];
        }
        void savePhotoMeta(photos, coverPhotoFileName, next);
        return next;
      });
    },
    [photos, coverPhotoFileName, savePhotoMeta],
  );

  // ─── 手动保存草稿（不做 Git commit，只存草稿） ───

  const save = useCallback(async () => {
    const id = effectiveIdRef.current;
    if (!id) return;

    setSaveStatus('saving');
    try {
      await galleryApi.saveDraft(id, {
        title: titleRef.current,
        summary: titleRef.current,
        bodyMarkdown: proseRef.current || '\u200B',
        changeNote: '手动保存草稿',
      });
      setSaveStatus('saved');
      toast.success('草稿已保存');
    } catch {
      setSaveStatus('dirty');
      toast.error('保存失败');
    }
  }, []);

  // ─── 新建帖子 ───

  const createPost = useCallback(async (): Promise<string> => {
    const post = await galleryApi.create({
      title: title || '无标题',
      description: prose || '\u200B',
    });
    effectiveIdRef.current = post.id;
    setSaveStatus('saved');
    return post.id;
  }, [title, prose]);

  return {
    loading,
    title,
    prose,
    photos,
    tags,
    coverPhotoFileName,
    saveStatus,
    updateTitle,
    updateProse,
    reorderPhotos,
    updateCaption,
    uploadPhotos,
    deletePhoto,
    setCover,
    updateLocation,
    save,
    createPost,
  };
}
