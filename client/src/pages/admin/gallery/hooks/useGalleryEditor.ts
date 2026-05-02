/*
 * useGalleryEditor — 画廊编辑页核心状态 hook
 *
 * 职责：
 *   1. 加载帖子详情 + 草稿（优先草稿，否则回退到正式版本）
 *   2. 标题 / 随笔内容的 1500ms debounce 自动保存到草稿
 *   3. 所有元数据（照片排序、caption、cover、photo-level tags、post-level tags）
 *      只维护在本地状态，不即时调 updateMeta API
 *   4. 保存草稿：将结构化 JSON 发给后端，后端负责序列化为 frontmatter
 *   5. 提交：发结构化 JSON → update → deleteDraft
 *   6. 照片上传 / 删除仍调 API，操作后同步更新本地 photos 数组 + 标记 dirty
 *   7. 新建帖子
 *
 * 数据流（简化后）：
 *   后端返回结构化 GalleryDraft / GalleryPostDetail
 *     → 本地状态 (photos: GalleryPhoto[], cover, tags, prose)
 *     → 用户操作 → 标记 dirty
 *     → buildSavePayload() → 发 JSON
 *     → 后端序列化 frontmatter（前端不感知）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import { toast } from 'sonner';
import {
  galleryApi,
  type GalleryPhoto,
  type GalleryPostDetail,
  type UpdateGalleryPostDto,
} from '@/services/workspace';

// ─── 状态类型 ───

type SaveStatus = 'saved' | 'dirty' | 'saving';

export interface GalleryEditorState {
  loading: boolean;
  title: string;
  prose: string;
  /** 照片列表，复用 GalleryPhoto 类型（含 id/url/fileName/size/order/caption/tags） */
  photos: GalleryPhoto[];
  /** 帖子级 key-value 标签 */
  tags: Record<string, string>;
  /** 封面照片文件名，null 表示未设置 */
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
  commit: () => Promise<void>;
}

// ─── Hook ───

export function useGalleryEditor(postId: string | undefined): GalleryEditorState & GalleryEditorActions {
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [prose, setProse] = useState('');
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  /** 帖子级标签 */
  const [tags, setTags] = useState<Record<string, string>>({});
  /** 封面文件名 */
  const [coverPhotoFileName, setCoverPhotoFileName] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

  // effectiveId：新建时 undefined，创建后更新为真实 ID
  const effectiveIdRef = useRef<string | undefined>(postId);
  // 始终指向最新值，供 debounce callback 读取（避免闭包陈旧引用）
  const titleRef = useRef(title);
  const proseRef = useRef(prose);
  const photosRef = useRef(photos);
  const tagsRef = useRef(tags);
  const coverRef = useRef(coverPhotoFileName);

  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { proseRef.current = prose; }, [prose]);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => { tagsRef.current = tags; }, [tags]);
  useEffect(() => { coverRef.current = coverPhotoFileName; }, [coverPhotoFileName]);

  // ─── 初始化加载 ───

  useEffect(() => {
    if (!postId) {
      setLoading(false);
      return;
    }

    const init = async () => {
      setLoading(true);
      try {
        // 并行请求：草稿（可能不存在，404 → null）+ 正式详情
        const [draft, detail] = await Promise.all([
          galleryApi.getDraft(postId).catch(() => null),
          galleryApi.getById(postId),
        ]) as [Awaited<ReturnType<typeof galleryApi.getDraft>> | null, GalleryPostDetail];

        if (draft) {
          // 草稿返回的是后端已反序列化的结构化字段，直接使用
          setTitle(draft.title);
          setProse(draft.prose);
          setTags(draft.tags);
          setCoverPhotoFileName(draft.cover);

          // 合并 draft.photos（顺序/元数据来源）与 detail.photos（URL/size 来源）
          const photoMap = new Map((detail.photos ?? []).map((p) => [p.fileName, p]));
          const merged: GalleryPhoto[] = draft.photos.map((dp, i) => {
            const asset = photoMap.get(dp.file);
            return {
              id: asset?.id ?? dp.file,
              url: asset?.url ?? '',
              size: asset?.size ?? 0,
              fileName: dp.file,
              order: i,
              caption: dp.caption,
              tags: dp.tags,
            };
          });
          // 追加 draft 未记录但 detail 中存在的照片（上传后未及时写入草稿的情况）
          const draftFileSet = new Set(draft.photos.map((p) => p.file));
          for (const asset of detail.photos ?? []) {
            if (!draftFileSet.has(asset.fileName)) {
              merged.push({ ...asset, tags: asset.tags ?? {}, order: merged.length });
            }
          }
          setPhotos(merged);
        } else {
          // 无草稿时，从正式版本 detail 初始化
          setTitle(detail.title);
          setProse(detail.description);
          setTags(detail.tags);
          setCoverPhotoFileName(detail.coverPhotoFileName);
          setPhotos(
            (detail.photos ?? []).map((p) => ({ ...p, tags: p.tags ?? {} })),
          );
        }

        setSaveStatus('saved');
      } catch {
        toast.error('加载画廊动态失败');
      } finally {
        setLoading(false);
      }
    };

    void init();
  }, [postId]);

  // ─── 构建结构化保存 payload（前端不再序列化 frontmatter，后端负责） ───

  const buildSavePayload = useCallback((): UpdateGalleryPostDto => ({
    title: titleRef.current,
    prose: proseRef.current,
    photos: photosRef.current.map((p) => ({
      file: p.fileName,
      caption: p.caption,
      tags: p.tags,
    })),
    cover: coverRef.current,
    tags: tagsRef.current,
  }), []);

  // ─── 自动保存草稿（1500ms debounce）───

  const saveDraft = useCallback(async () => {
    const id = effectiveIdRef.current;
    if (!id) return;

    setSaveStatus('saving');
    try {
      await galleryApi.saveDraft(id, buildSavePayload());
      setSaveStatus('saved');
    } catch {
      // 自动保存失败时不打断用户，还原为 dirty 以便下次重试
      setSaveStatus('dirty');
    }
  }, [buildSavePayload]);

  // saveStatus 变为 dirty 后 1500ms 触发自动保存
  useEffect(() => {
    const id = effectiveIdRef.current;
    if (!id || saveStatus !== 'dirty') return;
    const timer = window.setTimeout(() => void saveDraft(), 1500);
    return () => window.clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveStatus, postId, title, prose, photos, tags, coverPhotoFileName]);

  // ─── 文本更新（标记 dirty，触发 debounce） ───

  const updateTitle = useCallback((value: string) => {
    setTitle(value);
    setSaveStatus('dirty');
  }, []);

  const updateProse = useCallback((value: string) => {
    setProse(value);
    setSaveStatus('dirty');
  }, []);

  // ─── 照片操作（只改本地状态 + 标记 dirty，不调 API） ───

  const reorderPhotos = useCallback((fromIndex: number, toIndex: number) => {
    setPhotos((prev) =>
      arrayMove(prev, fromIndex, toIndex).map((p, i) => ({ ...p, order: i })),
    );
    setSaveStatus('dirty');
  }, []);

  const updateCaption = useCallback((photoId: string, caption: string) => {
    setPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, caption } : p)),
    );
    setSaveStatus('dirty');
  }, []);

  /** 设置封面：以文件名为标识符记录，标记 dirty */
  const setCover = useCallback((photoId: string) => {
    setPhotos((prev) => {
      const photo = prev.find((p) => p.id === photoId);
      if (!photo) return prev;
      setCoverPhotoFileName(photo.fileName);
      return prev;
    });
    setSaveStatus('dirty');
  }, []);

  /** 更新帖子级 location 标签，标记 dirty */
  const updateLocation = useCallback((location: string | undefined) => {
    setTags((prev) => {
      const next = { ...prev };
      if (location) {
        next['location'] = location;
      } else {
        delete next['location'];
      }
      return next;
    });
    setSaveStatus('dirty');
  }, []);

  // ─── 照片上传（调 API → 直接用返回的 MinIO draft URL 构建本地 photos → 标记 dirty） ───

  const uploadPhotos = useCallback(async (files: File[]) => {
    const id = effectiveIdRef.current;
    if (!id) return;
    try {
      const results = await Promise.all(
        files.map((file) => galleryApi.uploadPhoto(id, file)),
      );
      setPhotos((prev) => {
        const appended: GalleryPhoto[] = results.map((r, i) => ({
          id: r.fileName,
          url: r.url,
          fileName: r.fileName,
          size: r.size,
          order: prev.length + i,
          caption: '',
          tags: {},
        }));
        return [...prev, ...appended];
      });
      setSaveStatus('dirty');
      toast.success(`已上传 ${files.length} 张照片`);
    } catch {
      toast.error('照片上传失败');
    }
  }, []);

  /** 删除照片：纯本地操作，从 photos 数组移除 + 标记 dirty。MinIO 清理在 commit/discard 时统一处理。 */
  const deletePhoto = useCallback((photoId: string) => {
    setPhotos((prev) => {
      const deleted = prev.find((p) => p.id === photoId);
      const next = prev.filter((p) => p.id !== photoId).map((p, i) => ({ ...p, order: i }));
      if (deleted && coverRef.current === deleted.fileName) {
        setCoverPhotoFileName(null);
      }
      return next;
    });
    setSaveStatus('dirty');
  }, []);

  // ─── 手动保存草稿 ───

  const save = useCallback(async () => {
    const id = effectiveIdRef.current;
    if (!id) return;
    setSaveStatus('saving');
    try {
      await galleryApi.saveDraft(id, buildSavePayload());
      setSaveStatus('saved');
      toast.success('草稿已保存');
    } catch {
      setSaveStatus('dirty');
      toast.error('保存失败');
    }
  }, [buildSavePayload]);

  // ─── 提交（Git commit + 删除草稿） ───

  const commit = useCallback(async () => {
    const id = effectiveIdRef.current;
    if (!id) return;
    setSaveStatus('saving');
    try {
      await galleryApi.update(id, { ...buildSavePayload(), changeNote: '提交' });
      await galleryApi.deleteDraft(id).catch(() => {});
      setSaveStatus('saved');
      toast.success('已提交');
    } catch {
      setSaveStatus('dirty');
      toast.error('提交失败');
    }
  }, [buildSavePayload]);

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
    commit,
  };
}
