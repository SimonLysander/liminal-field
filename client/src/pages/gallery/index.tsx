// src/pages/gallery/index.tsx

/*
 * GalleryPage — 沉浸式相册展示页
 *
 * 交互模型：
 *   ← → 键  → 同一相册内切换照片（PhotoCarousel 处理）
 *   ↑ ↓ 键  → 在相册之间切换（ArcTimeline 处理）
 *
 * 数据流：
 *   1. 首次加载只拉相册列表（轻量 GalleryPost[]）
 *   2. 选中相册后按需加载详情（GalleryPostDetail）
 *   3. useRef<Map> 缓存已加载详情，避免重复请求
 *
 * 组件结构（后续 Task 分别实现）：
 *   GalleryPage
 *   ├── BlurBackground     — 全屏高斯模糊背景（当前照片放大虚化）
 *   ├── PhotoCarousel      — 中央宝丽来照片展示（占位）
 *   ├── ArcTimeline        — 右侧弧形时间轴（占位）
 *   └── BottomBar          — 底部相册信息条（占位）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { galleryApi } from '@/services/workspace';
import type { GalleryPhoto, GalleryPublicListItem, GalleryPublicDetail } from '@/services/workspace';
import { LoadingState } from '@/components/LoadingState';
import { appleEase } from '@/lib/motion';

// ─── 常量：五个卡片槽位的静态布局参数 ────────────────────────────────────────────
// offset -2 到 +2 分别映射到 farLeft / left / center / right / farRight
// tx 是相对自身宽度的百分比偏移（基础居中由 translateX(-50%) 完成后叠加）
const CARD_POSITIONS = {
  left:   { tx: '-30%', rotate: -2, scale: 0.88, opacity: 0.5, z: 8  },
  center: { tx: '0',    rotate: 0,  scale: 1,    opacity: 1,   z: 10 },
  right:  { tx: '30%',  rotate: 2,  scale: 0.88, opacity: 0.5, z: 8  },
} as const;

type CardSlot = keyof typeof CARD_POSITIONS;


// ─── PhotoFrameBar ─────────────────────────────────────────────────────────────

/*
 * 相框底部参数行（宝丽来白边下方）。
 * 左侧：设备型号 + EXIF 分组（光圈·快门·ISO、焦距、分辨率、白平衡、格式）
 * 右侧：拍摄时间 + 照片名
 * 从 photo.tags 中取对应键，缺失的键直接跳过。
 */
function PhotoFrameBar({ photo }: { photo: GalleryPhoto }) {
  const t = photo.tags;

  // 光圈·快门·ISO 三个参数合并为一组，用 · 连接
  const exposureGroup = [t.aperture, t.shutter, t.iso].filter(Boolean).join(' · ');

  // 其余独立参数按顺序排列
  const extraParams = [
    t.focalLength,
    t.resolution,
    t.wb,
    t.format,
  ].filter(Boolean);

  // 所有 EXIF 分段（非空才显示）：曝光组、其余参数各自为一段
  const exifSegments = [exposureGroup, ...extraParams].filter(Boolean);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 2px',
        fontSize: 9,
        color: 'rgba(255,255,255,0.6)',
        lineHeight: 1.4,
        gap: 4,
      }}
    >
      {/* 左侧：设备名 + EXIF 参数，用空格分隔各段 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
        {t.device && (
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{t.device}</span>
        )}
        {exifSegments.map((seg, i) => (
          <span key={i} style={{ whiteSpace: 'nowrap', opacity: 0.75 }}>{seg}</span>
        ))}
      </div>

      {/* 右侧：拍摄时间 + 照片名（从 tags.title 取，不是 caption） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {t.shotAt && (
          <span style={{ whiteSpace: 'nowrap', opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>
            {t.shotAt}
          </span>
        )}
        {t.title && (
          <span
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 120,
            }}
          >
            {t.title}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── PhotoCarousel ─────────────────────────────────────────────────────────────

/*
 * 三张（含远端共五张）宝丽来照片叠叠乐 carousel。
 * 渲染时始终保持五个卡片 DOM 节点，通过 animate 做位移/旋转/缩放/透明度过渡。
 * 居中策略：absolute 定位 + left/top 50% + translateX/Y(-50%) 作为"零点"，
 * 再通过 animate.x 叠加 tx 偏移，避免 left 值参与动画造成跳帧。
 */
function PhotoCarousel({
  photos,
  photoIdx,
  direction,
  onNavigate,
}: {
  photos: GalleryPhoto[];
  photoIdx: number;
  direction: number;
  onNavigate: (dir: number) => void;
}) {
  if (photos.length === 0) return null;

  const total = photos.length;
  const wrap = (i: number) => ((i % total) + total) % total;

  const slots: Array<{ slot: CardSlot; idx: number }> = [
    { slot: 'left', idx: wrap(photoIdx - 1) },
    { slot: 'center', idx: photoIdx },
    { slot: 'right', idx: wrap(photoIdx + 1) },
  ];

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    translate: '-50% -50%',
    border: '2px solid rgba(255,255,255,0.1)',
    borderRadius: 8,
    overflow: 'hidden',
    background: '#0a0a0a',
    width: '92%',
    height: '94%',
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {slots.map(({ slot, idx }) => {
        const pos = CARD_POSITIONS[slot];
        const photo = photos[idx];
        const isCenter = slot === 'center';

        return (
          <motion.div
            key={slot}
            style={{
              ...baseStyle,
              zIndex: pos.z,
              cursor: isCenter ? 'default' : slot === 'left' ? 'w-resize' : 'e-resize',
            }}
            animate={{
              x: pos.tx,
              rotate: pos.rotate,
              scale: pos.scale,
              opacity: pos.opacity,
            }}
            transition={{ duration: 0.4, ease: appleEase }}
            onClick={isCenter ? undefined : () => onNavigate(slot === 'left' ? -1 : 1)}
          >
            {/* 滑动 + 交叉淡入：新图从移动方向滑入，旧图反向滑出 */}
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.img
                key={photo.id}
                src={photo.url}
                alt={photo.caption || photo.fileName}
                initial={{
                  opacity: 0,
                  x: direction === 0 ? 0 : direction > 0 ? 80 : -80,
                }}
                animate={{ opacity: 1, x: 0 }}
                exit={{
                  opacity: 0,
                  x: direction === 0 ? 0 : direction > 0 ? -80 : 80,
                }}
                transition={{ duration: 0.5, ease: appleEase }}
                style={{
                  position: 'absolute', inset: 0,
                  width: '100%', height: '100%',
                  objectFit: 'contain', display: 'block',
                }}
              />
            </AnimatePresence>
            {isCenter && (
              <div style={{
                position: 'absolute',
                bottom: 0, left: 0, right: 0,
                padding: '20px 8px 6px',
                background: 'linear-gradient(transparent, rgba(0,0,0,0.45))',
              }}>
                <PhotoFrameBar photo={photo} />
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── BottomBar ────────────────────────────────────────────────────────────────

/** 底部：照片 caption（italic）+ 圆点指示器。相册标题已在右侧时间线展示。 */
function BottomBar({
  caption,
  photoCount,
  photoIdx,
}: {
  caption: string;
  photoCount: number;
  photoIdx: number;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 6,
      flexShrink: 0, padding: '10px 40px 18px', paddingRight: 150,
      /* 底部局部 scrim：从下往上渐变暗色 */
      background: 'linear-gradient(transparent, rgba(0,0,0,0.3))',
    }}>
      {caption && (
        <span style={{
          fontSize: 13, color: 'rgba(255,255,255,0.65)',
          textAlign: 'center', maxWidth: 500,
          lineHeight: 1.6, fontStyle: 'italic',
        }}>
          {caption}
        </span>
      )}
      {photoCount > 1 && (
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          {Array.from({ length: photoCount }, (_, i) => (
            <div
              key={i}
              style={{
                width: i === photoIdx ? 16 : 5,
                height: 5,
                borderRadius: i === photoIdx ? 3 : '50%',
                background: i === photoIdx ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)',
                transition: 'all 0.25s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ArcTimeline ──────────────────────────────────────────────────────────────

/*
 * 右侧浮动相册时间线，选中项永远垂直居中，其他条目弧形向右推开。
 *
 * 布局策略：
 *   - 外层容器 fixed 覆盖右侧区域，overflow: hidden，pointerEvents: none（不拦截底层交互）
 *   - 内层列表 pointerEvents: auto 恢复点击；用 motion.div 的 animate.y 做整体滑动动画
 *   - 选中项居中计算：列表 top:50% + translateY(-(currentIdx * 48 + 24))
 *     即把第 currentIdx 格的中心点（index*48 + 半格24）对齐到容器 50% 处
 *
 * 弧形偏移公式（每个条目的 CSS transform）：
 *   dist = |i - currentIdx|
 *   translateX = dist² × 1.2px（越远越向右缩进）
 *   opacity = max(0.12, 1 - dist × 0.2)
 *
 * 每条目内部 transform/opacity 走 CSS transition，不用 motion，减少节点开销。
 */
interface ArcTimelineProps {
  albums: GalleryPublicListItem[];
  currentIdx: number;
  onSelect: (idx: number) => void;
}

/** 固定 6+1+6 = 13 个槽位，不够的用空心圆点补齐 */
const SLOTS_ABOVE = 6;
const SLOTS_BELOW = 6;
const SLOT_H = 48;
const ARC_K = 1.2;

function ArcTimeline({ albums, currentIdx, onSelect }: ArcTimelineProps) {
  // 上方补齐占位点：让第一个相册上面也有 6 个点
  const paddingAbove = Math.max(0, SLOTS_ABOVE - currentIdx);
  // 下方补齐占位点：让最后一个相册下面也有 6 个点
  const paddingBelow = Math.max(0, SLOTS_BELOW - (albums.length - 1 - currentIdx));

  // 整个列表通过 translateY 滑动，让选中项居中
  const totalPaddingTop = paddingAbove * SLOT_H;
  const selectedY = totalPaddingTop + currentIdx * SLOT_H + SLOT_H / 2;
  const listY = -selectedY;

  /** 渲染单个占位圆点 */
  const renderPlaceholder = (key: string, distFromCenter: number) => {
    const arcX = distFromCenter * distFromCenter * ARC_K;
    const opacity = Math.max(0.08, 0.3 - distFromCenter * 0.04);
    return (
      <div key={key} style={{
        height: SLOT_H, display: 'flex', alignItems: 'center', paddingLeft: 16,
        transform: `translateX(${arcX}px)`, opacity,
        transition: 'transform 0.4s ease, opacity 0.4s ease',
      }}>
        <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(255,255,255,0.25)' }} />
      </div>
    );
  };

  /** 渲染相册条目 */
  const renderAlbum = (album: GalleryPublicListItem, i: number) => {
    const dist = Math.abs(i - currentIdx);
    const arcX = dist * dist * ARC_K;
    const opacity = Math.max(0.1, 1 - dist * 0.15);
    const isSelected = i === currentIdx;
    const date = new Date(album.createdAt);
    const dateStr = `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
    const location = album.tags?.location ?? '';

    return (
      <div
        key={album.id}
        onClick={() => onSelect(i)}
        style={{
          height: SLOT_H, display: 'flex', alignItems: 'center',
          gap: 8, paddingLeft: 16, cursor: 'pointer',
          transform: `translateX(${arcX}px)`, opacity,
          transition: 'transform 0.4s ease, opacity 0.4s ease',
        }}
      >
        <div style={{
          flexShrink: 0,
          width: isSelected ? 7 : 4, height: isSelected ? 7 : 4,
          borderRadius: '50%',
          backgroundColor: isSelected ? '#fff' : 'rgba(255,255,255,0.3)',
          transition: 'all 0.3s',
        }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{
            fontSize: isSelected ? 12 : 11, fontWeight: isSelected ? 600 : 400,
            color: isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            transition: 'all 0.3s',
          }}>{album.title}</span>
          <span style={{
            fontSize: 9,
            color: isSelected ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.2)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            transition: 'all 0.3s',
          }}>{location ? `${dateStr} · ${location}` : dateStr}</span>
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'absolute',
        right: 0, top: 0, bottom: 0,
        width: 160, zIndex: 20, overflow: 'hidden',
        /* 局部 scrim：只在时间线区域加暗色渐变，不影响整体沉浸 */
        background: 'linear-gradient(to right, transparent, rgba(0,0,0,0.35))',
      }}
    >
      {/* motion.div 驱动整体滑动，选中项永远在垂直中心 */}
      <motion.div
        animate={{ y: listY }}
        transition={{ duration: 0.4, ease: appleEase }}
        style={{ position: 'absolute', top: '50%', left: 0, right: 0 }}
      >
        {/* 上方占位点 */}
        {Array.from({ length: paddingAbove }, (_, i) =>
          renderPlaceholder(`pad-top-${i}`, paddingAbove - i + currentIdx)
        )}
        {/* 全部相册 */}
        {albums.map((album, i) => renderAlbum(album, i))}
        {/* 下方占位点 */}
        {Array.from({ length: paddingBelow }, (_, i) =>
          renderPlaceholder(`pad-bot-${i}`, (albums.length - 1 - currentIdx) + i + 1)
        )}
      </motion.div>
    </div>
  );
}

// ─── BlurBackground ───────────────────────────────────────────────────────────

/*
 * 全屏模糊背景：将当前照片放大 160% 并大幅高斯模糊，营造沉浸式氛围。
 * 亮度由 --blur-brightness CSS 变量控制，日间 0.85、午夜 0.2。
 * key={photoUrl} 驱动 motion.img 的 enter 动画，每次照片切换淡入新背景。
 */
/**
 * 全屏模糊背景 — 参考 Apple Music 多层叠加方案（简化版）
 *
 * 层 1：照片模糊 + brightness(0.55) 压暗 + saturate(1.2) 提色
 * 层 2：暗色蒙版 rgba(0,0,0,0.3) 兜底极端场景（纯白照片）
 *
 * 双保险：filter 压暗解决 90% 场景，蒙版兜底剩余 10%。
 * 即使纯白照片，叠加后也足够暗，白色文字始终可读。
 */
function BlurBackground({ photoUrl }: { photoUrl: string | null }) {
  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      {/* 直接换 backgroundImage，blur 这么重看不出切换过程，不需要淡入动画 */}
      <div
        style={{
          position: 'absolute',
          inset: -80,
          backgroundImage: photoUrl ? `url(${photoUrl})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          filter: 'blur(18px) brightness(0.55) saturate(1.2)',
          transition: 'background-image 0.3s',
        }}
      />
      {/* 层 2：暗色蒙版兜底 */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.3)' }} />
    </div>,
    document.body,
  );
}

// ─── GalleryPage ──────────────────────────────────────────────────────────────

export default function GalleryPage() {
  // gallery 沉浸模式：给 body 和 layout root 加 class，让模糊层透出来
  useEffect(() => {
    document.body.classList.add('gallery-immersive');
    return () => { document.body.classList.remove('gallery-immersive'); };
  }, []);

  const [searchParams, setSearchParams] = useSearchParams();

  // 相册列表（轻量，首次加载）
  const [posts, setPosts] = useState<GalleryPublicListItem[]>([]);
  // 当前展示的相册详情（含照片数组）
  const [currentDetail, setCurrentDetail] = useState<GalleryPublicDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // URL 驱动的选中相册 ID，支持直链分享和刷新保留
  const urlPostId = searchParams.get('post');

  // 从 posts 列表派生当前索引
  const postIdx = useMemo(() => {
    if (!urlPostId || posts.length === 0) return 0;
    const idx = posts.findIndex((p) => p.id === urlPostId);
    return idx >= 0 ? idx : 0;
  }, [urlPostId, posts]);

  // 当前展示的照片索引（控制 PhotoCarousel 和 ← → 键导航）
  const [photoIdx, setPhotoIdx] = useState(0);
  const [photoDir, setPhotoDir] = useState(0);

  // 已加载的详情缓存，避免重复请求（key: post id）
  const detailCache = useRef<Map<string, GalleryPublicDetail>>(new Map());

  /** 切换相册：更新 URL 参数 */
  const selectPost = useCallback((idx: number) => {
    const post = posts[idx];
    if (post) {
      setSearchParams({ post: post.id }, { replace: true });
    }
  }, [posts, setSearchParams]);

  // ── 初始加载相册列表 ─────────────────────────────────────────────────────────
  useEffect(() => {
    galleryApi.listPublished()
      .then((listed) => {
        setPosts(listed);
        // 无 URL 参数时默认选中第一个
        if (!searchParams.get('post') && listed.length > 0) {
          setSearchParams({ post: listed[0].id }, { replace: true });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // ── 选中相册后加载详情 ────────────────────────────────────────────────────────
  useEffect(() => {
    if (posts.length === 0) return;

    const post = posts[postIdx];
    if (!post) return;

    // 命中缓存：直接更新，无需网络请求
    const cached = detailCache.current.get(post.id);
    if (cached) {
      setCurrentDetail(cached);
      return;
    }

    // 未命中：加载并写入缓存（展示端用 getPublicDetail）
    galleryApi.getPublicDetail(post.id)
      .then((detail) => {
        detailCache.current.set(post.id, detail);
        setCurrentDetail(detail);
      })
      .catch(() => {});
  }, [posts, postIdx]);

  // 当前相册切换时，照片索引和方向归零
  useEffect(() => {
    setPhotoIdx(0);
    setPhotoDir(0);
  }, [postIdx]);

  // 派生当前照片（currentDetail 未就绪时为 null）
  const currentPhoto: GalleryPhoto | null = currentDetail?.photos[photoIdx] ?? null;

  // ── 导航：←→ 切换照片 ─────────────────────────────────────────────────────────
  const navigatePhoto = useCallback((dir: number) => {
    if (!currentDetail) return;
    const total = currentDetail.photos.length;
    if (total <= 1) return;
    setPhotoDir(dir);
    setPhotoIdx((prev) => {
      const next = prev + dir;
      if (next < 0) return total - 1;
      if (next >= total) return 0;
      return next;
    });
  }, [currentDetail]);

  // ── 导航：↑↓ 切换相册 ─────────────────────────────────────────────────────────
  const navigatePost = useCallback((dir: number) => {
    if (posts.length <= 1) return;
    const next = postIdx + dir;
    const wrapped = next < 0 ? posts.length - 1 : next >= posts.length ? 0 : next;
    selectPost(wrapped);
  }, [posts.length, postIdx, selectPost]);

  // ── 键盘导航 ────────────────────────────────────────────────────────────────
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

  // ── 渲染 ──────────────────────────────────────────────────────────────────────

  if (loading) {
    return <LoadingState variant="full" />;
  }

  if (posts.length === 0) {
    return (
      <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>暂无画廊内容</span>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* 全屏模糊背景 — zIndex: 0，其他内容叠在上方 */}
      <BlurBackground photoUrl={currentPhoto?.url ?? null} />

      {/* 主内容层 */}
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
        }}
      >
        {/* 照片展示区 — 右侧 padding 给时间线留空间，center 卡片不重叠 */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px 12px 16px 12px',
            paddingRight: 150, /* 时间线 140px + 10px 间距 */
          }}
        >
          <PhotoCarousel
            photos={currentDetail?.photos ?? []}
            photoIdx={photoIdx}
            direction={photoDir}
            onNavigate={navigatePhoto}
          />

          {/* 左右切换按钮 */}
          {(currentDetail?.photos.length ?? 0) > 1 && (
            <>
              <button
                onClick={() => navigatePhoto(-1)}
                style={{
                  position: 'absolute', left: 20, top: '50%', transform: 'translateY(-50%)',
                  width: 44, height: 44, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                  cursor: 'pointer', zIndex: 15,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.6)'; e.currentTarget.style.transform = 'translateY(-50%) scale(1.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; e.currentTarget.style.transform = 'translateY(-50%) scale(1)'; }}
              ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>
              <button
                onClick={() => navigatePhoto(1)}
                style={{
                  position: 'absolute', right: 164, top: '50%', transform: 'translateY(-50%)',
                  width: 44, height: 44, borderRadius: '50%',
                  background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                  cursor: 'pointer', zIndex: 15,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.6)'; e.currentTarget.style.transform = 'translateY(-50%) scale(1.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; e.currentTarget.style.transform = 'translateY(-50%) scale(1)'; }}
              ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>
            </>
          )}
        </div>

        {/* 底部：caption + 照片圆点 */}
        <BottomBar
          caption={currentPhoto?.caption ?? ''}
          photoCount={currentDetail?.photos.length ?? 0}
          photoIdx={photoIdx}
        />
      </div>

      {/* 右侧时间轴 — ArcTimeline，fixed 脱离文档流 */}
      <ArcTimeline
        albums={posts}
        currentIdx={postIdx}
        onSelect={(i) => { selectPost(i); }}
      />
    </div>
  );
}
