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
  type UpdateGalleryPostDto,
} from '@/services/workspace';

// ─── 状态类型 ───

type SaveStatus = 'saved' | 'dirty' | 'saving';

/** 编辑器本地照片状态（比 GalleryPhoto 多 size，用于 UI 展示文件大小） */
interface LocalEditorPhoto {
  id: string;
  url: string;
  fileName: string;
  size: number;
  caption: string;
  tags: Record<string, string>;
}

export interface GalleryEditorState {
  loading: boolean;
  title: string;
  prose: string;
  /** 照片列表（含 size 供 UI 展示，来源 /editor 端点） */
  photos: LocalEditorPhoto[];
  /** 帖子拍摄/发生日期（ISO 8601），null 表示未设置 */
  date: string | null;
  /** 帖子地点，null 表示未设置 */
  location: string | null;
  /** 封面照片文件名，null 表示未设置 */
  coverPhotoFileName: string | null;
  saveStatus: SaveStatus;
}


export interface GalleryEditorActions {
  updateTitle: (value: string) => void;
  updateProse: (value: string) => void;
  reorderPhotos: (fromIndex: number, toIndex: number) => void;
  updateCaption: (photoId: string, caption: string) => void;
  updatePhotoTags: (photoId: string, tags: Record<string, string>) => void;
  uploadPhotos: (files: File[]) => Promise<void>;
  deletePhoto: (photoId: string) => void;
  setCover: (photoId: string) => void;
  updateDate: (date: string | null) => void;
  updateLocation: (location: string | null) => void;
  save: () => Promise<void>;
  commit: (changeNote?: string) => Promise<void>;
}

// ─── Hook ───

export function useGalleryEditor(postId: string | undefined): GalleryEditorState & GalleryEditorActions {
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [prose, setProse] = useState('');
  const [photos, setPhotos] = useState<LocalEditorPhoto[]>([]);
  /** 帖子拍摄/发生日期 */
  const [date, setDate] = useState<string | null>(null);
  /** 帖子地点 */
  const [location, setLocation] = useState<string | null>(null);
  /** 封面文件名 */
  const [coverPhotoFileName, setCoverPhotoFileName] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');

  // effectiveId：新建时 undefined，创建后更新为真实 ID
  const effectiveIdRef = useRef<string | undefined>(postId);
  // 始终指向最新值，供 debounce callback 读取（避免闭包陈旧引用）
  const titleRef = useRef(title);
  const proseRef = useRef(prose);
  const photosRef = useRef(photos);
  const dateRef = useRef(date);
  const locationRef = useRef(location);
  const coverRef = useRef(coverPhotoFileName);

  useEffect(() => { titleRef.current = title; }, [title]);
  useEffect(() => { proseRef.current = prose; }, [prose]);
  useEffect(() => { photosRef.current = photos; }, [photos]);
  useEffect(() => { dateRef.current = date; }, [date]);
  useEffect(() => { locationRef.current = location; }, [location]);
  useEffect(() => { coverRef.current = coverPhotoFileName; }, [coverPhotoFileName]);

  // ─── 初始化加载 ───
  // 使用 /editor 端点：后端已合并草稿+正式版，前端直接消费，无需手动 photoMap 合并

  useEffect(() => {
    void (async () => {
      await Promise.resolve();
      if (!postId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const editorState = await galleryApi.getEditorState(postId);

        setTitle(editorState.title);
        setProse(editorState.prose);
        // date 默认今天（新建帖子或未设置日期时）
        setDate(editorState.date ?? new Date().toISOString().slice(0, 10));
        setLocation(editorState.location);
        setCoverPhotoFileName(editorState.cover);
        // id 用 file（文件名）作为本地唯一键，与 buildSavePayload 中的 p.fileName 对齐
        setPhotos(editorState.photos.map((p) => ({
          id: p.file,
          url: p.url,
          fileName: p.file,
          size: p.size,
          caption: p.caption,
          tags: p.tags,
        })));
        setSaveStatus('saved');
      } catch {
        toast.error('加载画廊动态失败');
      } finally {
        setLoading(false);
      }
    })();
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
    date: dateRef.current,
    location: locationRef.current,
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
  }, [saveStatus, postId, title, prose, photos, date, location, coverPhotoFileName]);

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

  const updatePhotoTags = useCallback((photoId: string, tags: Record<string, string>) => {
    setPhotos((prev) =>
      prev.map((p) => (p.id === photoId ? { ...p, tags } : p)),
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

  /** 更新帖子拍摄/发生日期，标记 dirty */
  const updateDate = useCallback((newDate: string | null) => {
    setDate(newDate);
    setSaveStatus('dirty');
  }, []);

  /** 更新帖子地点，标记 dirty */
  const updateLocation = useCallback((newLocation: string | null) => {
    setLocation(newLocation);
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
        // id 用 fileName 作为本地唯一键，与 buildSavePayload 保持一致
        // 后端返回的 exif 自动作为初始 tags，让用户上传后立即看到拍摄参数
        const appended: LocalEditorPhoto[] = results.map((r) => ({
          id: r.fileName,
          url: r.url,
          fileName: r.fileName,
          size: r.size,
          caption: '',
          tags: r.exif,
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

  const commit = useCallback(async (changeNote?: string) => {
    const id = effectiveIdRef.current;
    if (!id) return;
    setSaveStatus('saving');
    try {
      await galleryApi.update(id, { ...buildSavePayload(), changeNote: changeNote || '提交' });
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
    date,
    location,
    coverPhotoFileName,
    saveStatus,
    updateTitle,
    updateProse,
    reorderPhotos,
    updateCaption,
    updatePhotoTags,
    uploadPhotos,
    deletePhoto,
    setCover,
    updateDate,
    updateLocation,
    save,
    commit,
  };
}
