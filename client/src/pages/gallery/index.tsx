// src/pages/gallery/index.tsx

/*
 * GalleryPage — Photo gallery with polaroid display
 *
 * 交互模型：
 *   - 左右滑 → 同一条动态内的多张照片
 *   - 上下切 → 不同动态之间切换
 *
 * 数据从 galleryApi 获取已发布动态列表，不再使用 mock 数据。
 * 保留宝丽来卡片展示风格和方向感知滑动动画。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import MarkdownBody from '@/components/shared/MarkdownBody';
import { smoothBounce } from '@/lib/motion';
import { galleryApi } from '@/services/workspace';
import type { GalleryPostDetail } from '@/services/workspace';
import { LoadingState } from '@/components/LoadingState';

const slideVariantsY = {
  enter: (dir: number) => ({ y: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { y: 0, opacity: 1 },
  exit: (dir: number) => ({ y: dir > 0 ? -40 : 40, opacity: 0 }),
};

const slideVariantsX = {
  enter: (dir: number) => ({ x: dir > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? -40 : 40, opacity: 0 }),
};

export default function GalleryPage() {
  const [posts, setPosts] = useState<GalleryPostDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [postIdx, setPostIdx] = useState(0);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [postDir, setPostDir] = useState(0);
  const [photoDir, setPhotoDir] = useState(0);

  useEffect(() => {
    galleryApi.list('published').then(async (listed) => {
      const details = await Promise.all(listed.map((p) => galleryApi.getById(p.id)));
      setPosts(details);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const post = posts[postIdx];
  const photo = post?.photos[photoIdx];

  /* 上下：切换动态 */
  const navigatePost = useCallback((dir: number) => {
    setPostDir(dir);
    setPostIdx((prev) => {
      const next = prev + dir;
      if (next < 0) return posts.length - 1;
      if (next >= posts.length) return 0;
      return next;
    });
    setPhotoIdx(0);
  }, [posts.length]);

  /* 左右：切换照片 */
  const navigatePhoto = useCallback((dir: number) => {
    if (!post) return;
    setPhotoDir(dir);
    setPhotoIdx((prev) => {
      const next = prev + dir;
      if (next < 0) return post.photos.length - 1;
      if (next >= post.photos.length) return 0;
      return next;
    });
  }, [post]);

  const tickRefs = useRef<(HTMLButtonElement | null)[]>([]);
  useEffect(() => {
    tickRefs.current[postIdx]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [postIdx]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowLeft':  navigatePhoto(-1); break;
        case 'ArrowRight': navigatePhoto(1);  break;
        case 'ArrowUp':    e.preventDefault(); navigatePost(-1); break;
        case 'ArrowDown':  e.preventDefault(); navigatePost(1);  break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [navigatePhoto, navigatePost]);

  if (loading) {
    return <LoadingState variant="full" />;
  }

  if (posts.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-base)' }}>暂无画廊内容</span>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-stretch overflow-hidden">
      {/* Center — polaroid display */}
      <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-10 py-8">
        <AnimatePresence mode="wait" custom={postDir}>
          <motion.div
            key={postIdx}
            custom={postDir}
            variants={slideVariantsY}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: smoothBounce }}
            className="flex flex-col items-center"
          >
            {/* Polaroid frame */}
            <div
              className="polaroid-frame relative transition-all duration-400"
              style={{
                background: 'var(--paper-white)',
                padding: '8px 8px 32px',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-md)',
              }}
            >
              <div
                className="relative flex w-full items-center justify-center overflow-hidden"
                style={{
                  borderRadius: 'var(--radius-md)',
                  height: '62vh',
                  aspectRatio: '4/3',
                  background: 'var(--paper-dark)',
                }}
              >
                {photo ? (
                  <AnimatePresence mode="wait" custom={photoDir}>
                    <motion.img
                      key={`${postIdx}-${photoIdx}`}
                      src={photo.url}
                      alt={photo.fileName}
                      className="h-full w-full object-cover"
                      custom={photoDir}
                      variants={slideVariantsX}
                      initial="enter"
                      animate="center"
                      exit="exit"
                      transition={{ duration: 0.25, ease: smoothBounce }}
                    />
                  </AnimatePresence>
                ) : (
                  <span style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-sm)' }}>
                    暂无照片
                  </span>
                )}

                {/* Left/right arrows (photo navigation) */}
                {post.photos.length > 1 && (
                  <>
                    <div
                      className="absolute left-3 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-2xs opacity-40 transition-all duration-250 hover:opacity-100"
                      style={{ background: 'rgba(0,0,0,0.3)', color: '#fff' }}
                      onClick={() => navigatePhoto(-1)}
                    >
                      ‹
                    </div>
                    <div
                      className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-2xs opacity-40 transition-all duration-250 hover:opacity-100"
                      style={{ background: 'rgba(0,0,0,0.3)', color: '#fff' }}
                      onClick={() => navigatePhoto(1)}
                    >
                      ›
                    </div>
                  </>
                )}

                {/* Photo indicator */}
                {post.photos.length > 1 && (
                  <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
                    {post.photos.map((_, i) => (
                      <span
                        key={i}
                        className="rounded-full transition-all duration-200"
                        style={{
                          width: i === photoIdx ? 12 : 4,
                          height: 4,
                          background: i === photoIdx ? '#fff' : 'rgba(255,255,255,0.4)',
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Caption */}
              <div className="px-1 pt-2.5 text-center" style={{ color: 'var(--ink-faded)', fontSize: 'var(--text-md)' }}>
                {post.title}
              </div>
            </div>

            {/* Description */}
            {post.description && (
              <motion.div
                className="mt-6 text-center leading-relaxed"
                style={{ color: 'var(--ink-light)', fontSize: 'var(--text-md)', letterSpacing: '-0.01em' }}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
              >
                <MarkdownBody markdown={post.description} />
              </motion.div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Up/down arrows (post navigation) */}
        {posts.length > 1 && (
          <>
            <div
              className="absolute left-1/2 top-3 flex h-6 w-6 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full text-4xs opacity-0 transition-all duration-250 hover:opacity-60"
              style={{ color: 'var(--ink-ghost)' }}
              onClick={() => navigatePost(-1)}
            >
              &#x25B3;
            </div>
            <div
              className="absolute bottom-3 left-1/2 flex h-6 w-6 -translate-x-1/2 cursor-pointer items-center justify-center rounded-full text-4xs opacity-0 transition-all duration-250 hover:opacity-60"
              style={{ color: 'var(--ink-ghost)' }}
              onClick={() => navigatePost(1)}
            >
              &#x25BD;
            </div>
          </>
        )}
      </div>

      {/* Right — timeline axis */}
      <div
        className="relative flex w-[72px] shrink-0 flex-col"
        style={{ borderLeft: '0.5px solid var(--separator)' }}
      >
        {/* Axis line */}
        <div
          className="absolute left-[20px]"
          style={{ top: 0, bottom: 0, width: 1, background: 'var(--separator)' }}
        />

        {/* Scrollable tick area — selected tick auto-centers */}
        <div className="flex flex-1 flex-col items-start overflow-y-auto py-6">
          {/* Top spacer so first item can center */}
          <div className="shrink-0" style={{ minHeight: '40vh' }} />

          {posts.map((p, i) => {
            const active = i === postIdx;
            const date = new Date(p.createdAt);
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return (
              <button
                key={p.id}
                ref={(el) => { tickRefs.current[i] = el; }}
                className="relative flex shrink-0 items-center"
                style={{ height: 28, paddingLeft: 16 }}
                onClick={() => { setPostDir(i > postIdx ? 1 : -1); setPostIdx(i); setPhotoIdx(0); }}
              >
                {/* Dot */}
                <div
                  className="rounded-full transition-all duration-200"
                  style={{
                    width: active ? 9 : 5,
                    height: active ? 9 : 5,
                    background: active ? 'var(--ink)' : 'var(--ink-ghost)',
                  }}
                />
                {/* Date label */}
                <span
                  className="ml-2 whitespace-nowrap transition-all duration-150"
                  style={{
                    fontSize: 'var(--text-2xs)',
                    color: active ? 'var(--ink)' : 'var(--ink-ghost)',
                    fontWeight: active ? 600 : 400,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {month}.{day}
                </span>
              </button>
            );
          })}

          {/* Bottom spacer so last item can center */}
          <div className="shrink-0" style={{ minHeight: '40vh' }} />
        </div>
      </div>
    </div>
  );
}
