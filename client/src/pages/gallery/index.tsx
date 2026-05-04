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
import { appleEase } from '@/lib/motion';

// ─── 常量：五个卡片槽位的静态布局参数 ────────────────────────────────────────────
// offset -2 到 +2 分别映射到 farLeft / left / center / right / farRight
// tx 是相对自身宽度的百分比偏移（基础居中由 translateX(-50%) 完成后叠加）
const CARD_POSITIONS = {
  farLeft:  { tx: '-32%', rotate: -3, scale: 0.78, opacity: 0.2, z: 6  },
  left:     { tx: '-17%', rotate: -2, scale: 0.88, opacity: 0.4, z: 8  },
  center:   { tx: '0',    rotate: 0,  scale: 1,    opacity: 1,   z: 10 },
  right:    { tx: '17%',  rotate: 2,  scale: 0.88, opacity: 0.4, z: 8  },
  farRight: { tx: '32%',  rotate: 3,  scale: 0.78, opacity: 0.2, z: 6  },
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

  /* 不循环：到头就不显示候选卡片，2+1+2 五槽布局 */
  const hasPrev = photoIdx > 0;
  const hasNext = photoIdx < total - 1;
  const slots: Array<{ slot: CardSlot; idx: number }> = [
    ...(photoIdx > 1 ? [{ slot: 'farLeft' as CardSlot, idx: photoIdx - 2 }] : []),
    ...(hasPrev ? [{ slot: 'left' as CardSlot, idx: photoIdx - 1 }] : []),
    { slot: 'center', idx: photoIdx },
    ...(hasNext ? [{ slot: 'right' as CardSlot, idx: photoIdx + 1 }] : []),
    ...(photoIdx < total - 2 ? [{ slot: 'farRight' as CardSlot, idx: photoIdx + 2 }] : []),
  ];

  const baseStyle: React.CSSProperties = {
    position: 'absolute',
    left: '50%',
    top: '50%',
    translate: '-50% -50%',
    borderRadius: 8,
    overflow: 'hidden',
    width: '70%',
    height: '88%',
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
            initial={false}
            style={{
              ...baseStyle,
              zIndex: pos.z,
              cursor: isCenter ? 'default' : 'pointer',
            }}
            animate={{
              x: pos.tx,
              rotate: pos.rotate,
              scale: pos.scale,
              opacity: pos.opacity,
            }}
            transition={{ duration: 0.6, ease: appleEase }}
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
                transition={{ duration: 0.7, ease: appleEase }}
                style={{
                  position: 'absolute', inset: 0,
                  width: '100%', height: '100%',
                  objectFit: 'contain', display: 'block',
                }}
              />
            </AnimatePresence>
            {isCenter && (
              <>
                {/* EXIF 参数行——无渐变，text-shadow 保证可读 */}
                <div style={{
                  position: 'absolute',
                  bottom: 6, left: 8, right: 8,
                  textShadow: '0 1px 4px rgba(0,0,0,0.8)',
                }}>
                  <PhotoFrameBar photo={photo} />
                </div>
                {/* 边缘悬停箭头——到头不渲染 */}
                {hasPrev && (
                  <div
                    className="gallery-edge-zone"
                    onClick={(e) => { e.stopPropagation(); onNavigate(-1); }}
                    style={{
                      position: 'absolute', left: 0, top: 0, bottom: 0, width: '12%',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <svg className="gallery-edge-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
                  </div>
                )}
                {hasNext && (
                  <div
                    className="gallery-edge-zone"
                    onClick={(e) => { e.stopPropagation(); onNavigate(1); }}
                    style={{
                      position: 'absolute', right: 0, top: 0, bottom: 0, width: '12%',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <svg className="gallery-edge-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </div>
                )}
              </>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

// ─── BottomBar ────────────────────────────────────────────────────────────────

/**
 * 照片导航条：‹ dots › + 可选 caption，贴近照片底部居中。
 * absolute 定位在照片区底部，不占文档流。
 */
function PhotoNavBar({
  caption,
  photoCount,
  photoIdx,
  onNavigate,
}: {
  caption: string;
  photoCount: number;
  photoIdx: number;
  onNavigate: (dir: number) => void;
}) {
  if (photoCount <= 1 && !caption) return null;

  const atStart = photoIdx === 0;
  const atEnd = photoIdx === photoCount - 1;

  const chevronStyle = (disabled: boolean): React.CSSProperties => ({
    width: 24, height: 24,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '50%',
    color: disabled ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.5)',
    cursor: disabled ? 'default' : 'pointer',
    transition: 'color 0.2s',
  });

  return (
    <div style={{
      position: 'absolute',
      bottom: 16, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
      zIndex: 15, pointerEvents: 'none',
    }}>
      {/* ‹ dots › */}
      {photoCount > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, pointerEvents: 'auto' }}>
          <button
            onClick={atStart ? undefined : () => onNavigate(-1)}
            style={chevronStyle(atStart)}
            onMouseEnter={atStart ? undefined : e => { e.currentTarget.style.color = 'rgba(255,255,255,0.9)'; }}
            onMouseLeave={atStart ? undefined : e => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
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
          <button
            onClick={atEnd ? undefined : () => onNavigate(1)}
            style={chevronStyle(atEnd)}
            onMouseEnter={atEnd ? undefined : e => { e.currentTarget.style.color = 'rgba(255,255,255,0.9)'; }}
            onMouseLeave={atEnd ? undefined : e => { e.currentTarget.style.color = 'rgba(255,255,255,0.5)'; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      )}
      {/* caption 始终占位，无内容时 invisible 防止 dots 跳动 */}
      <span style={{
        fontSize: 13, color: 'rgba(255,255,255,0.55)',
        textAlign: 'center', maxWidth: 500,
        lineHeight: 1.6, fontStyle: 'italic',
        pointerEvents: 'auto',
        visibility: caption ? 'visible' : 'hidden',
      }}>
        {caption || '\u00A0'}
      </span>
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
    // 优先用 frontmatter date（拍摄/发生日期），没有则退化为内容创建时间
    const date = new Date(album.date ?? album.createdAt);
    const dateStr = `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
    const location = album.location ?? '';

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
        transition={{ duration: 0.6, ease: appleEase }}
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
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none', background: '#0a0a0a' }}>
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
      /* 到头就停，不循环 */
      if (next < 0 || next >= total) return prev;
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

  // BlurBackground 始终渲染（不受 loading 拦截），确保暗底在第一帧就位
  const blurBg = <BlurBackground photoUrl={currentPhoto?.url ?? null} />;

  if (loading) {
    return <>{blurBg}</>;
  }

  if (posts.length === 0) {
    return (
      <>
        {blurBg}
        <div style={{ display: 'flex', flex: 1, alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 1 }}>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>暂无画廊内容</span>
        </div>
      </>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      {/* 全屏模糊背景 — zIndex: 0，其他内容叠在上方 */}
      {blurBg}

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
        {/* 照片展示区 — 去掉右侧硬 padding，时间线是半透明浮层不影响居中 */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px 12px',
          }}
        >
          <PhotoCarousel
            photos={currentDetail?.photos ?? []}
            photoIdx={photoIdx}
            direction={photoDir}
            onNavigate={navigatePhoto}
          />

          {/* ‹ dots › + caption，贴近照片底部居中 */}
          <PhotoNavBar
            caption={currentPhoto?.caption ?? ''}
            photoCount={currentDetail?.photos.length ?? 0}
            photoIdx={photoIdx}
            onNavigate={navigatePhoto}
          />
        </div>
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
