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
import { banner } from '@/components/ui/banner-api';
import {
  galleryApi,
  type UpdateGalleryPostDto,
} from '@/services/workspace';
import { useLocalDraftBuffer } from '../../lib/use-local-draft-buffer';

// ─── 状态类型 ───

type SaveStatus = 'saved' | 'dirty' | 'saving';

/** 编辑器本地照片状态（比 GalleryPhoto 多 size，用于 UI 展示文件大小） */
export interface LocalEditorPhoto {
  id: string;
  url: string;
  fileName: string;
  /** 上传中标记，网格显示加载遮罩 */
  uploading?: boolean;
  size: number;
  caption: string;
  tags: Record<string, string>;
}

export interface UploadProgress {
  uploaded: number;
  total: number;
}

/**
 * 本地草稿快照(local-first):画廊的完整可恢复编辑态,即时镜像到 localStorage。
 * 与笔记/文集统一走 useLocalDraftBuffer——崩溃/刷新/关页不丢改动。
 */
interface LocalGalleryDraft {
  title: string;
  prose: string;
  date: string | null;
  location: string | null;
  cover: string | null;
  photos: LocalEditorPhoto[];
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
  lastSavedAt: string;
  /** 照片上传进度，null 表示无上传中 */
  uploadProgress: UploadProgress | null;
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
  /** 清本地草稿缓存(丢弃草稿后调,防失效内容被当未同步草稿恢复) */
  clearLocalDraft: () => void;
}

// ─── Hook ───

export function useGalleryEditor(postId: string | undefined): GalleryEditorState & GalleryEditorActions {
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [prose, setProse] = useState('');
  const [photos, setPhotos] = useState<LocalEditorPhoto[]>([]);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  /** 帖子拍摄/发生日期 */
  const [date, setDate] = useState<string | null>(null);
  /** 帖子地点 */
  const [location, setLocation] = useState<string | null>(null);
  /** 封面文件名 */
  const [coverPhotoFileName, setCoverPhotoFileName] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [lastSavedAt, setLastSavedAt] = useState('');

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

  // local-first 本地缓冲:与笔记/文集统一,每次改动即时镜像 localStorage,崩溃/刷新/关页不丢。
  // 解构出各方法(均 useCallback by storageKey,引用稳定),避免依赖整个 buffer 对象致 effect 抖动。
  const {
    loadPending: loadLocalPending,
    onChange: writeLocalDraft,
    beginSync: beginLocalSync,
    endSync: endLocalSync,
    clear: clearLocalDraft,
  } = useLocalDraftBuffer<LocalGalleryDraft>(
    postId ? `gallery:${postId}` : null,
  );

  // 有未保存改动时,任一字段变化即时写本地(零延迟);服务器草稿仍走下面 1.5s 防抖。
  useEffect(() => {
    if (loading || saveStatus === 'saved') return;
    writeLocalDraft({
      title,
      prose,
      date,
      location,
      cover: coverPhotoFileName,
      photos,
    });
  }, [
    saveStatus,
    title,
    prose,
    photos,
    date,
    location,
    coverPhotoFileName,
    loading,
    writeLocalDraft,
  ]);

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

        // local-first reconcile:本地缓存"存在即未同步"(成功同步会清空)。
        // 上次没存完就崩了/刷新了 → 用本地未同步内容覆盖服务器版并标脏重传。
        const localPending = loadLocalPending();
        if (localPending) {
          setTitle(localPending.title);
          setProse(localPending.prose);
          setDate(localPending.date);
          setLocation(localPending.location);
          setCoverPhotoFileName(localPending.cover);
          setPhotos(localPending.photos);
          setSaveStatus('dirty');
        }
      } catch {
        banner.error('加载画廊动态失败');
      } finally {
        setLoading(false);
      }
    })();
    // loadLocalPending 引用稳定(随 storageKey 变),纳入依赖
  }, [postId, loadLocalPending]);

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
    const startedAt = Date.now();
    // local-first:抓同步快照,成功后仅当期间无新改动时清本地(防竞态)
    const syncToken = beginLocalSync();
    try {
      await galleryApi.saveDraft(id, buildSavePayload());
      setLastSavedAt(new Date().toISOString());
      endLocalSync(syncToken);
      // 与笔记/文集编辑器一致:"保存中"至少停留 ~800ms,否则呼吸点一闪而过
      const remain = 800 - (Date.now() - startedAt);
      if (remain > 0) await new Promise((resolve) => setTimeout(resolve, remain));
      setSaveStatus('saved');
    } catch (err) {
      console.error('[useGalleryEditor] 自动保存失败:', err);
      // 自动保存失败时不打断用户，还原为 dirty 以便下次重试(本地缓存保留,内容不丢)
      setSaveStatus('dirty');
    }
  }, [buildSavePayload, beginLocalSync, endLocalSync]);

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

    // 立即用本地预览插入占位卡片（uploading=true），用户马上看到缩略图+加载态
    const placeholders: LocalEditorPhoto[] = files.map((file) => ({
      id: `pending-${file.name}-${Date.now()}`,
      url: URL.createObjectURL(file),
      fileName: file.name,
      size: file.size,
      caption: '',
      tags: {},
      uploading: true,
    }));
    setPhotos((prev) => [...prev, ...placeholders]);

    // 逐张上传，完成后用真实数据替换对应占位
    let failed = 0;
    setUploadProgress({ uploaded: 0, total: files.length });
    for (let i = 0; i < files.length; i++) {
      try {
        const r = await galleryApi.uploadPhoto(id, files[i]);
        setPhotos((prev) =>
          prev.map((p) =>
            p.id === placeholders[i].id
              ? { id: r.fileName, url: r.url, fileName: r.fileName, size: r.size, caption: '', tags: r.exif }
              : p,
          ),
        );
      } catch {
        setPhotos((prev) => prev.filter((p) => p.id !== placeholders[i].id));
        failed++;
      }
      URL.revokeObjectURL(placeholders[i].url);
      setUploadProgress({ uploaded: i + 1, total: files.length });
    }
    setUploadProgress(null);
    setSaveStatus('dirty');
    if (failed > 0) banner.error(`${failed} 张照片上传失败`);
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
    const syncToken = beginLocalSync();
    try {
      await galleryApi.saveDraft(id, buildSavePayload());
      endLocalSync(syncToken);
      setSaveStatus('saved');
      // SaveStatus badge 已提供 inline 反馈，无需弹窗
    } catch {
      setSaveStatus('dirty');
      banner.error('保存失败');
    }
  }, [buildSavePayload, beginLocalSync, endLocalSync]);

  // ─── 提交（Git commit + 删除草稿） ───

  const commit = useCallback(async (changeNote?: string) => {
    const id = effectiveIdRef.current;
    if (!id) return;
    setSaveStatus('saving');
    try {
      await galleryApi.update(id, { ...buildSavePayload(), changeNote: changeNote || '提交' });
      await galleryApi.deleteDraft(id).catch(() => {});
      clearLocalDraft(); // 已提交,本地草稿失效,清掉防下次打开被当未同步草稿恢复
      setSaveStatus('saved');
      // 提交成功，页面跳转即为反馈，无需弹窗
    } catch (err) {
      console.error('[useGalleryEditor] 提交失败:', err);
      // 提交失败时还原为 dirty，用户可重试
      setSaveStatus('dirty');
      banner.error('提交失败');
    }
  }, [buildSavePayload, clearLocalDraft]);

  return {
    loading,
    title,
    prose,
    photos,
    date,
    location,
    coverPhotoFileName,
    saveStatus,
    lastSavedAt,
    uploadProgress,
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
    clearLocalDraft: clearLocalDraft,
  };
}
