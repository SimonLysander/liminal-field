/*
 * useGalleryEditor — 画廊编辑页核心状态 hook
 *
 * 职责：
 *   1. 加载帖子详情 + 草稿（优先草稿，否则回退到正式版本）
 *   2. 标题 / 随笔内容的 1500ms debounce 自动保存到草稿
 *   3. 所有元数据（照片排序、caption、cover、photo-level tags、post-level tags）
 *      只维护在本地 frontmatter 状态，不即时调 updateMeta API
 *   4. 保存草稿：序列化 frontmatter + prose 为完整 main.md → saveDraft
 *   5. 提交：序列化 → update({ description: fullMainMd }) → deleteDraft
 *   6. 照片上传 / 删除仍调 API，操作后同步更新本地 photos 数组 + 标记 dirty
 *   7. 新建帖子
 *
 * 数据流：
 *   后端 bodyMarkdown（含 frontmatter YAML + prose）
 *     → parseGalleryMainMd 解析
 *     → 本地状态 (photos: GalleryPhoto[], cover, tags, prose)
 *     → 用户操作 → 标记 dirty
 *     → serializeGalleryMainMd 序列化
 *     → 保存 / 提交
 *
 * 字段映射：frontmatter 中 `file` 对应 GalleryPhoto.fileName（API 字段名）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import matter from 'gray-matter';
import { toast } from 'sonner';
import {
  galleryApi,
  type GalleryPhoto,
  type GalleryPostDetail,
  type SaveDraftDto,
} from '@/services/workspace';

// ─── frontmatter 内部条目类型（序列化时使用，字段名与 main.md 协议对齐） ───

interface FrontmatterPhotoEntry {
  /** Git assets 目录中的文件名（= GalleryPhoto.fileName） */
  file: string;
  caption: string;
  tags: Record<string, string>;
}

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
  createPost: () => Promise<string>;
}

// ─── frontmatter 解析 / 序列化工具 ───

/**
 * 解析后端返回的 main.md（bodyMarkdown 字段）为本地可用的结构。
 * 容错：bodyMarkdown 可能为零宽空格占位符或空，统一处理为空状态。
 */
function parseGalleryMainMd(raw: string | undefined | null): {
  photos: FrontmatterPhotoEntry[];
  cover: string | null;
  tags: Record<string, string>;
  prose: string;
} {
  if (!raw || raw === '\u200B') {
    return { photos: [], cover: null, tags: {}, prose: '' };
  }
  const { data, content } = matter(raw);
  return {
    photos: ((data.photos ?? []) as Array<Record<string, unknown>>)
      .map((p) => ({
        file: (p.file as string) ?? '',
        caption: (p.caption as string) ?? '',
        tags: (p.tags as Record<string, string>) ?? {},
      }))
      .filter((p) => p.file),
    cover: (data.cover as string) ?? null,
    tags: (data.tags as Record<string, string>) ?? {},
    prose: content.trim(),
  };
}

/**
 * 将本地状态序列化回完整 main.md（frontmatter YAML + prose）。
 * 规则：无任何 frontmatter 数据时直接返回 prose，避免多余的 --- 分隔符。
 */
function serializeGalleryMainMd(data: {
  photos: FrontmatterPhotoEntry[];
  cover: string | null;
  tags: Record<string, string>;
  prose: string;
}): string {
  const fm: Record<string, unknown> = {};
  if (data.cover) fm.cover = data.cover;
  if (Object.keys(data.tags).length > 0) fm.tags = data.tags;
  if (data.photos.length > 0) {
    fm.photos = data.photos.map((p) => ({
      file: p.file,
      caption: p.caption,
      tags: p.tags,
    }));
  }
  if (Object.keys(fm).length === 0) return data.prose;
  return matter.stringify(data.prose, fm);
}

// ─── Hook ───

export function useGalleryEditor(postId: string | undefined): GalleryEditorState & GalleryEditorActions {
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [prose, setProse] = useState('');
  const [photos, setPhotos] = useState<GalleryPhoto[]>([]);
  /** 帖子级标签（frontmatter data.tags） */
  const [tags, setTags] = useState<Record<string, string>>({});
  /** 封面文件名（frontmatter data.cover） */
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
        // 并行请求：草稿（可能不存在）+ 正式详情
        const [draft, detail] = await Promise.all([
          galleryApi.getDraft(postId).catch(() => null),
          galleryApi.getById(postId),
        ]) as [Awaited<ReturnType<typeof galleryApi.getDraft>> | null, GalleryPostDetail];

        // 草稿的 bodyMarkdown 包含完整 frontmatter，优先使用草稿还原内容
        const sourceBody = draft?.bodyMarkdown ?? detail.description;
        const { photos: fmPhotos, cover, tags: fmTags, prose: fmProse } = parseGalleryMainMd(sourceBody);

        setTitle(draft ? draft.title : detail.title);
        setProse(fmProse);
        setTags(fmTags);
        setCoverPhotoFileName(cover);

        // 将 frontmatter photos（有序、有元数据）与 detail.photos（有 URL/id/size）合并：
        // frontmatter 决定排序和元数据，detail.photos 提供运行时展示字段。
        const photoMap = new Map(
          (detail.photos ?? []).map((p) => [p.fileName, p]),
        );
        const merged: GalleryPhoto[] = fmPhotos.map((fp, i) => {
          const asset = photoMap.get(fp.file);
          return {
            // 运行时字段来自 API
            id: asset?.id ?? fp.file,
            url: asset?.url ?? '',
            size: asset?.size ?? 0,
            // 元数据字段以 frontmatter 为准
            fileName: fp.file,
            order: i,
            caption: fp.caption,
            tags: fp.tags,
          };
        });

        // 追加 frontmatter 中没有记录的照片（刚上传但还未写入 frontmatter 的情况）
        const fmFileSet = new Set(fmPhotos.map((p) => p.file));
        for (const asset of detail.photos ?? []) {
          if (!fmFileSet.has(asset.fileName)) {
            merged.push({
              ...asset,
              tags: asset.tags ?? {},
              order: merged.length,
            });
          }
        }
        setPhotos(merged);
        setSaveStatus('saved');
      } catch {
        toast.error('加载画廊动态失败');
      } finally {
        setLoading(false);
      }
    };

    void init();
  }, [postId]);

  // ─── 将当前状态序列化为完整 main.md ───

  const buildMainMd = useCallback((): string => {
    const photoEntries: FrontmatterPhotoEntry[] = photosRef.current.map((p) => ({
      file: p.fileName,
      caption: p.caption,
      tags: p.tags,
    }));
    return serializeGalleryMainMd({
      photos: photoEntries,
      cover: coverRef.current,
      tags: tagsRef.current,
      prose: proseRef.current,
    });
  }, []);

  // ─── 自动保存草稿（1500ms debounce）───

  const saveDraft = useCallback(async () => {
    const id = effectiveIdRef.current;
    if (!id) return;

    setSaveStatus('saving');
    const payload: SaveDraftDto = {
      title: titleRef.current,
      summary: titleRef.current,
      bodyMarkdown: buildMainMd() || '\u200B',
      changeNote: '自动保存',
    };
    try {
      await galleryApi.saveDraft(id, payload);
      setSaveStatus('saved');
    } catch {
      // 自动保存失败时不打断用户，还原为 dirty 以便下次重试
      setSaveStatus('dirty');
    }
  }, [buildMainMd]);

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

  // ─── 照片上传（调 API → 重新拉取列表 → 追加到本地 photos → 标记 dirty） ───

  const uploadPhotos = useCallback(async (files: File[]) => {
    const id = effectiveIdRef.current;
    if (!id) return;
    try {
      await Promise.all(files.map((file) => galleryApi.uploadPhoto(id, file)));
      // 上传后重新拉取 detail 以获得最新 URL / ID
      const detail = await galleryApi.getById(id);
      setPhotos((prev) => {
        const existingFileNames = new Set(prev.map((p) => p.fileName));
        const newAssets = (detail.photos ?? []).filter((a) => !existingFileNames.has(a.fileName));
        const appended: GalleryPhoto[] = newAssets.map((a, i) => ({
          ...a,
          tags: a.tags ?? {},
          order: prev.length + i,
        }));
        return [...prev, ...appended];
      });
      setSaveStatus('dirty');
      toast.success(`已上传 ${files.length} 张照片`);
    } catch {
      toast.error('照片上传失败');
    }
  }, []);

  // ─── 照片删除（调 API → 从本地 photos 移除 → 同步封面引用 → 标记 dirty） ───

  const deletePhoto = useCallback((photoId: string) => {
    const id = effectiveIdRef.current;
    if (!id) return;
    void (async () => {
      try {
        await galleryApi.deletePhoto(id, photoId);
        setPhotos((prev) => {
          const deleted = prev.find((p) => p.id === photoId);
          const next = prev.filter((p) => p.id !== photoId).map((p, i) => ({ ...p, order: i }));
          // 若删的是封面，清除封面引用
          if (deleted && coverRef.current === deleted.fileName) {
            setCoverPhotoFileName(null);
          }
          return next;
        });
        setSaveStatus('dirty');
      } catch {
        toast.error('删除照片失败');
      }
    })();
  }, []);

  // ─── 手动保存草稿 ───

  const save = useCallback(async () => {
    const id = effectiveIdRef.current;
    if (!id) return;
    setSaveStatus('saving');
    try {
      await galleryApi.saveDraft(id, {
        title: titleRef.current,
        summary: titleRef.current,
        bodyMarkdown: buildMainMd() || '\u200B',
        changeNote: '保存草稿',
      });
      setSaveStatus('saved');
      toast.success('草稿已保存');
    } catch {
      setSaveStatus('dirty');
      toast.error('保存失败');
    }
  }, [buildMainMd]);

  // ─── 提交（Git commit + 删除草稿） ───

  const commit = useCallback(async () => {
    const id = effectiveIdRef.current;
    if (!id) return;
    setSaveStatus('saving');
    try {
      const fullMainMd = buildMainMd();
      await galleryApi.update(id, {
        title: titleRef.current,
        description: fullMainMd || '\u200B',
      });
      await galleryApi.deleteDraft(id).catch(() => {});
      setSaveStatus('saved');
      toast.success('已提交');
    } catch {
      setSaveStatus('dirty');
      toast.error('提交失败');
    }
  }, [buildMainMd]);

  // ─── 新建帖子 ───

  const createPost = useCallback(async (): Promise<string> => {
    const post = await galleryApi.create({
      title: title || '无标题',
      description: buildMainMd() || '\u200B',
    });
    effectiveIdRef.current = post.id;
    setSaveStatus('saved');
    return post.id;
  }, [title, buildMainMd]);

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
    createPost,
  };
}
