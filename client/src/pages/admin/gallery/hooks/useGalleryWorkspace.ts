// src/pages/admin/gallery/hooks/useGalleryWorkspace.ts

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { galleryApi } from '@/services/workspace';
import type { GalleryPost, GalleryPostDetail } from '@/services/workspace';

type StatusFilter = 'all' | 'draft' | 'published';

export function useGalleryWorkspace() {
  const [posts, setPosts] = useState<GalleryPost[]>([]);
  const [selectedPost, setSelectedPost] = useState<GalleryPostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [editing, setEditing] = useState(false);

  /* 加载动态列表 */
  const loadPosts = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const status = statusFilter === 'all' ? undefined : statusFilter;
      const data = await galleryApi.list(status);
      setPosts(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void loadPosts(); }, [loadPosts]);

  /* 选中一条动态 → 加载详情 */
  const selectPost = useCallback(async (postId: string) => {
    setEditing(false);
    try {
      const detail = await galleryApi.getById(postId);
      setSelectedPost(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载详情失败');
    }
  }, []);

  /* 创建新动态 */
  const createPost = useCallback(async (title: string, description: string) => {
    try {
      const post = await galleryApi.create({ title, description });
      await loadPosts();
      await selectPost(post.id);
      showMessage('已创建');
    } catch (e) {
      showMessage(`创建失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }, [loadPosts, selectPost]);

  /* 更新动态 */
  const updatePost = useCallback(async (title: string, description: string) => {
    if (!selectedPost) return;
    try {
      await galleryApi.update(selectedPost.id, { title, description });
      await galleryApi.getById(selectedPost.id).then(setSelectedPost);
      await loadPosts();
      setEditing(false);
      showMessage('已保存');
    } catch (e) {
      showMessage(`保存失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }, [selectedPost, loadPosts]);

  /* 删除动态 */
  const deletePost = useCallback(async () => {
    if (!selectedPost) return;
    try {
      await galleryApi.remove(selectedPost.id);
      setSelectedPost(null);
      await loadPosts();
      showMessage('已删除');
    } catch (e) {
      showMessage(`删除失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }, [selectedPost, loadPosts]);

  /* 上传照片 */
  const uploadPhoto = useCallback(async (file: File) => {
    if (!selectedPost) return;
    try {
      await galleryApi.uploadPhoto(selectedPost.id, file);
      const updated = await galleryApi.getById(selectedPost.id);
      setSelectedPost(updated);
      await loadPosts();
    } catch (e) {
      showMessage(`上传失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }, [selectedPost, loadPosts]);

  /* 删除照片 */
  const deletePhoto = useCallback(async (photoId: string) => {
    if (!selectedPost) return;
    try {
      await galleryApi.deletePhoto(selectedPost.id, photoId);
      const updated = await galleryApi.getById(selectedPost.id);
      setSelectedPost(updated);
      await loadPosts();
    } catch (e) {
      showMessage(`删除照片失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }, [selectedPost, loadPosts]);

  /* 发布 / 取消发布 */
  const publishPost = useCallback(async () => {
    if (!selectedPost) return;
    try {
      await galleryApi.publish(selectedPost.id);
      const updated = await galleryApi.getById(selectedPost.id);
      setSelectedPost(updated);
      await loadPosts();
      showMessage('已发布');
    } catch (e) {
      showMessage(`发布失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }, [selectedPost, loadPosts]);

  const unpublishPost = useCallback(async () => {
    if (!selectedPost) return;
    try {
      await galleryApi.unpublish(selectedPost.id);
      const updated = await galleryApi.getById(selectedPost.id);
      setSelectedPost(updated);
      await loadPosts();
      showMessage('已取消发布');
    } catch (e) {
      showMessage(`取消发布失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }, [selectedPost, loadPosts]);

  function showMessage(msg: string) {
    if (msg.includes('失败')) {
      toast.error(msg);
    } else {
      toast.success(msg);
    }
  }

  return {
    posts,
    selectedPost,
    loading,
    error,
    statusFilter,
    editing,
    setStatusFilter,
    setEditing,
    selectPost,
    createPost,
    updatePost,
    deletePost,
    uploadPhoto,
    deletePhoto,
    publishPost,
    unpublishPost,
    reload: loadPosts,
  };
}
