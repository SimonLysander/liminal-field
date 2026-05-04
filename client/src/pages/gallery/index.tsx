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

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { galleryApi } from '@/services/workspace';
import type { GalleryPhoto, GalleryPost, GalleryPostDetail } from '@/services/workspace';
import { LoadingState } from '@/components/LoadingState';
import { appleEase } from '@/lib/motion';

// ─── 常量：五个卡片槽位的静态布局参数 ────────────────────────────────────────────
// offset -2 到 +2 分别映射到 farLeft / left / center / right / farRight
// tx 是相对自身宽度的百分比偏移（基础居中由 translateX(-50%) 完成后叠加）
const CARD_POSITIONS = {
  center: { tx: '0',    rotate: 0,  scale: 1,    opacity: 1,    z: 10 },
  left:   { tx: '-30%', rotate: -3, scale: 0.82, opacity: 0.15, z: 8  },
  right:  { tx: '30%',  rotate: 3,  scale: 0.82, opacity: 0.15, z: 8  },
} as const;

type CardSlot = keyof typeof CARD_POSITIONS;

// offset（-1, 0, +1）→ slot 名称，只渲染 3 张卡片
const OFFSET_TO_SLOT: CardSlot[] = ['left', 'center', 'right'];

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

      {/* 右侧：拍摄时间 + 照片名 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        {t.shotAt && (
          <span style={{ whiteSpace: 'nowrap', opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>
            {t.shotAt}
          </span>
        )}
        {photo.caption && (
          <span
            style={{
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 120,
            }}
          >
            {photo.caption}
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
  onNavigate,
}: {
  photos: GalleryPhoto[];
  photoIdx: number;
  onNavigate: (dir: number) => void;
}) {
  if (photos.length === 0) return null;

  const total = photos.length;

  // offset -2 到 +2 对应五个卡片槽位，当前 photoIdx 为 center（offset 0）
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
      }}
    >
      {OFFSET_TO_SLOT.map((slot, slotIndex) => {
        const offset = slotIndex - 1; // -1, 0, 1
        // 循环取模，保证索引始终合法
        const photoIndex = ((photoIdx + offset) % total + total) % total;
        const photo = photos[photoIndex];
        const pos = CARD_POSITIONS[slot];
        const isCenter = slot === 'center';

        return (
          <motion.div
            key={slot}
            // 基础居中：left/top 50% + translateX/Y(-50%) 锚定到中心，
            // 再叠加 animate.x 做水平偏移（motion 会把 x 合并进 transform）
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              translateX: '-50%',
              translateY: '-50%',
              zIndex: pos.z,
              /* 相框：用 border 做视觉边缘，不用 padding，照片占满全部空间 */
              border: '2px solid var(--frame-border)',
              borderRadius: 8,
              overflow: 'hidden',
              background: '#0a0a0a',
              width: '85%',
              height: '90%',
              maxHeight: 560,
              cursor: isCenter ? 'default' : offset < 0 ? 'w-resize' : 'e-resize',
            }}
            animate={{
              x: pos.tx,
              rotate: pos.rotate,
              scale: pos.scale,
              opacity: pos.opacity,
            }}
            transition={{ duration: 0.45, ease: appleEase }}
            onClick={isCenter ? undefined : () => onNavigate(offset < 0 ? -1 : 1)}
          >
            {/* 照片占满全部卡片空间 */}
            <img
              src={photo.url}
              alt={photo.caption || photo.fileName}
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />

            {/* 参数行叠在照片底部，带渐变遮罩，不占空间 */}
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
      flexShrink: 0, padding: '8px 40px 18px',
    }}>
      {caption && (
        <span style={{
          fontSize: 13, color: 'var(--caption-color)',
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
                background: i === photoIdx ? 'var(--ink)' : 'var(--ink-ghost)',
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
  albums: GalleryPost[];
  currentIdx: number;
  onSelect: (idx: number) => void;
}

/** 固定 6+1+6 = 13 个槽位，不够的用空心圆点补齐 */
const SLOTS_ABOVE = 6;
const SLOTS_BELOW = 6;
const SLOT_H = 48;
const ARC_K = 1.2;

function ArcTimeline({ albums, currentIdx, onSelect }: ArcTimelineProps) {
  // 构建 13 个槽位：slotOffset = -6 到 +6，0 = 选中项
  const slots: Array<{ offset: number; albumIdx: number | null }> = [];
  for (let offset = -SLOTS_ABOVE; offset <= SLOTS_BELOW; offset++) {
    const albumIdx = currentIdx + offset;
    slots.push({
      offset,
      albumIdx: albumIdx >= 0 && albumIdx < albums.length ? albumIdx : null,
    });
  }

  return (
    <div
      style={{
        position: 'absolute',
        right: 0, top: 0, bottom: 0,
        width: 140, zIndex: 20, overflow: 'hidden',
        pointerEvents: 'none',
        display: 'flex', alignItems: 'center',
      }}
    >
      {/* 固定高度列表，选中项永远在正中间 */}
      <div style={{ pointerEvents: 'auto', width: '100%' }}>
        {slots.map(({ offset, albumIdx }) => {
          const dist = Math.abs(offset);
          const arcX = dist * dist * ARC_K;
          const opacity = Math.max(0.1, 1 - dist * 0.15);
          const isSelected = offset === 0;
          const album = albumIdx !== null ? albums[albumIdx] : null;

          // 空槽位：只显示小圆点占位
          if (!album) {
            return (
              <div
                key={`placeholder-${offset}`}
                style={{
                  height: SLOT_H,
                  display: 'flex', alignItems: 'center',
                  paddingLeft: 16,
                  transform: `translateX(${arcX}px)`,
                  opacity: opacity * 0.3,
                  transition: 'transform 0.4s ease, opacity 0.4s ease',
                }}
              >
                <div style={{
                  width: 4, height: 4, borderRadius: '50%',
                  background: 'var(--ink-ghost)',
                }} />
              </div>
            );
          }

          const date = new Date(album.createdAt);
          const dateStr = `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
          const location = album.tags?.location ?? '';

          return (
            <div
              key={album.id}
              onClick={() => onSelect(albumIdx!)}
              style={{
                height: SLOT_H,
                display: 'flex', alignItems: 'center',
                gap: 8, paddingLeft: 16,
                cursor: 'pointer',
                transform: `translateX(${arcX}px)`,
                opacity,
                transition: 'transform 0.4s ease, opacity 0.4s ease',
              }}
            >
              <div style={{
                flexShrink: 0,
                width: isSelected ? 7 : 4,
                height: isSelected ? 7 : 4,
                borderRadius: '50%',
                backgroundColor: isSelected ? 'var(--ink)' : 'var(--ink-ghost)',
                transition: 'all 0.3s',
              }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{
                  fontSize: isSelected ? 12 : 11,
                  fontWeight: isSelected ? 600 : 400,
                  color: isSelected ? 'var(--ink)' : 'var(--ink-ghost)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  transition: 'all 0.3s',
                }}>
                  {album.title}
                </span>
                <span style={{
                  fontSize: 9,
                  color: isSelected ? 'var(--ink-faded)' : 'var(--ink-ghost)',
                  opacity: isSelected ? 1 : 0.5,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  transition: 'all 0.3s',
                }}>
                  {location ? `${dateStr} · ${location}` : dateStr}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── BlurBackground ───────────────────────────────────────────────────────────

/*
 * 全屏模糊背景：将当前照片放大 160% 并大幅高斯模糊，营造沉浸式氛围。
 * 亮度由 --blur-brightness CSS 变量控制，日间 0.85、午夜 0.2。
 * key={photoUrl} 驱动 motion.img 的 enter 动画，每次照片切换淡入新背景。
 */
function BlurBackground({ photoUrl }: { photoUrl: string | null }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
      {photoUrl && (
        <motion.div
          key={photoUrl}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: appleEase }}
          style={{
            position: 'absolute',
            /* 比视口大一圈，确保模糊边缘不露底色 */
            inset: -80,
            backgroundImage: `url(${photoUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(30px) saturate(1.3) brightness(var(--blur-brightness, 0.55))',
          }}
        />
      )}
    </div>
  );
}

// ─── GalleryPage ──────────────────────────────────────────────────────────────

export default function GalleryPage() {
  // 相册列表（轻量，首次加载）
  const [posts, setPosts] = useState<GalleryPost[]>([]);
  // 当前展示的相册详情（含照片数组）
  const [currentDetail, setCurrentDetail] = useState<GalleryPostDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // 当前选中的相册索引（控制 ArcTimeline 高亮和 ↑↓ 键导航）
  const [postIdx, setPostIdx] = useState(0);
  // 当前展示的照片索引（控制 PhotoCarousel 和 ← → 键导航）
  const [photoIdx, setPhotoIdx] = useState(0);
  // 详情加载状态（PhotoCarousel、BottomBar 等子组件实现后消费）
  const [_detailLoading, setDetailLoading] = useState(false);

  // 已加载的详情缓存，避免重复请求（key: post id）
  const detailCache = useRef<Map<string, GalleryPostDetail>>(new Map());

  // ── 初始加载相册列表 ─────────────────────────────────────────────────────────
  useEffect(() => {
    galleryApi.list('published')
      .then((listed) => {
        setPosts(listed);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // ── 选中相册后加载详情 ────────────────────────────────────────────────────────
  // posts 列表加载完成后触发首次详情加载；postIdx 变化时也触发
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

    // 未命中：加载并写入缓存
    setDetailLoading(true);
    galleryApi.getById(post.id)
      .then((detail) => {
        detailCache.current.set(post.id, detail);
        setCurrentDetail(detail);
        setDetailLoading(false);
      })
      .catch(() => setDetailLoading(false));
  }, [posts, postIdx]);

  // 当前相册切换时，照片索引归零
  useEffect(() => {
    setPhotoIdx(0);
  }, [postIdx]);

  // 派生当前照片（currentDetail 未就绪时为 null）
  const currentPhoto: GalleryPhoto | null = currentDetail?.photos[photoIdx] ?? null;

  // ── 导航：←→ 切换照片 ─────────────────────────────────────────────────────────
  const navigatePhoto = useCallback((dir: number) => {
    if (!currentDetail) return;
    const total = currentDetail.photos.length;
    if (total <= 1) return;
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
    setPostIdx((prev) => {
      const next = prev + dir;
      if (next < 0) return posts.length - 1;
      if (next >= posts.length) return 0;
      return next;
    });
  }, [posts.length]);

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
        <span style={{ color: 'var(--ink-ghost)', fontSize: 'var(--text-base)' }}>暂无画廊内容</span>
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
            onNavigate={navigatePhoto}
          />
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
        onSelect={(i) => { setPostIdx(i); setPhotoIdx(0); }}
      />
    </div>
  );
}
