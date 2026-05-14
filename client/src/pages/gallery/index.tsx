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

type PhotoOrientation = 'landscape' | 'portrait' | 'square' | 'unknown';

function getPhotoRatio(photo: GalleryPhoto, measuredRatio?: number): number | null {
  if (measuredRatio && Number.isFinite(measuredRatio)) return measuredRatio;

  const width = Number.parseFloat(photo.tags.width ?? '');
  const height = Number.parseFloat(photo.tags.height ?? '');
  if (!Number.isFinite(width) || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return width / height;
}

function getPhotoOrientation(
  photo: GalleryPhoto,
  measuredRatio?: number,
): PhotoOrientation {
  const ratio = getPhotoRatio(photo, measuredRatio);
  if (!ratio) return 'unknown';
  if (ratio > 1.25) return 'landscape';
  if (ratio < 0.8) return 'portrait';
  return 'square';
}

function getFrameStyle(
  photo: GalleryPhoto,
  isCenter: boolean,
  measuredRatio?: number,
): React.CSSProperties {
  const orientation = getPhotoOrientation(photo, measuredRatio);
  const ratio = getPhotoRatio(photo, measuredRatio);

  if (isCenter) {
    if (ratio) {
      if (orientation === 'portrait') {
        return {
          width: `min(52vw, calc(90vh * ${ratio}))`,
          height: `min(90vh, calc(52vw / ${ratio}))`,
        };
      }
      if (orientation === 'square') {
        return {
          width: 'min(76vw, 88vh)',
          height: 'min(76vw, 88vh)',
        };
      }
      return {
        width: `min(94vw, 1880px, calc(92vh * ${ratio}))`,
        height: `min(92vh, calc(94vw / ${ratio}), calc(1880px / ${ratio}))`,
      };
    }
    if (orientation === 'portrait') {
      return { width: 'min(52vw, 60vh)', height: '90vh' };
    }
    if (orientation === 'square') {
      return { width: 'min(76vw, 88vh)', height: 'min(76vw, 88vh)' };
    }
    if (orientation === 'unknown') {
      return { width: 'min(76vw, 88vh)', height: 'min(76vw, 88vh)' };
    }
    return { width: 'min(94vw, 1880px)', height: '92vh' };
  }

  if (ratio) {
    if (orientation === 'portrait') {
      return {
        width: `min(28vw, calc(76vh * ${ratio}))`,
        height: `min(76vh, calc(28vw / ${ratio}))`,
      };
    }
    if (orientation === 'square') {
      return { width: 'min(44vw, 62vh)', height: 'min(44vw, 62vh)' };
    }
    return {
      width: `min(52vw, calc(70vh * ${ratio}))`,
      height: `min(70vh, calc(52vw / ${ratio}))`,
    };
  }

  if (orientation === 'portrait') {
    return { width: 'min(28vw, 42vh)', height: '76vh' };
  }
  if (orientation === 'square') {
    return { width: 'min(44vw, 62vh)', height: 'min(44vw, 62vh)' };
  }
  if (orientation === 'unknown') {
    return { width: 'min(44vw, 62vh)', height: 'min(44vw, 62vh)' };
  }
  return { width: '62%', height: '78%' };
}


// ─── PhotoFrameBar ─────────────────────────────────────────────────────────────

/*
 * 宝丽来白条 — 照片底部的奶白色 EXIF 参数条。
 * 左侧：设备型号 + 曝光参数（光圈·快门·ISO）+ 焦距
 * 右侧：拍摄时间
 * 等宽字体 (SF Mono / Menlo) 让数字对齐，宝丽来质感。
 */
const FRAME_FONT = '"SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

function PhotoFrameBar({ photo }: { photo: GalleryPhoto }) {
  const t = photo.tags;

  /* 格式化文件大小（旧数据可能无 size） */
  const sizeStr = photo.size
    ? (photo.size < 1024 * 1024
        ? `${(photo.size / 1024).toFixed(1)}KB`
        : `${(photo.size / (1024 * 1024)).toFixed(1)}MB`)
    : null;

  /* 分辨率：后端 EXIF 提取存入 tags */
  const resolution = t.width && t.height ? `${t.width}×${t.height}` : null;

  const segments = [
    sizeStr,
    resolution,
    [t.aperture, t.shutter, t.iso].filter(Boolean).join(' · ') || null,
    t.focalLength || null,
  ].filter(Boolean) as string[];

  if (segments.length === 0 && !t.shotAt) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        padding: 'clamp(7px, 0.45vw, 10px) clamp(14px, 0.9vw, 20px)',
        fontFamily: FRAME_FONT,
        fontSize: 'clamp(10.5px, 0.58vw, 13px)',
        letterSpacing: '0.03em',
        color: 'rgba(45,45,45,0.76)',
        lineHeight: 1,
      }}
    >
      {/* 左侧：大小 + 分辨率 + 曝光参数 + 焦距 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(10px, 0.75vw, 16px)', overflow: 'hidden' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexShrink: 0, color: 'rgba(45,45,45,0.34)', letterSpacing: '0.12em' }}>
          <span style={{ width: 16, height: 1, background: 'rgba(45,45,45,0.24)' }} />
          <span>FRAME</span>
        </span>
        {segments.map((seg, i) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 'clamp(8px, 0.65vw, 14px)', whiteSpace: 'nowrap' }}>
            {i > 0 && <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'rgba(45,45,45,0.28)', flexShrink: 0 }} />}
            <span>{seg}</span>
          </span>
        ))}
      </div>

      {/* 右侧：拍摄日期，贴白条最右边 */}
      {t.shotAt && (
        <span style={{ whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.08em' }}>
          {t.shotAt}
        </span>
      )}
    </div>
  );
}

// ─── ProgressiveImage ─────────────────────────────────────────────────────────
// 先显示缩放版（previewSrc），后台加载原图（originalSrc），就绪后无缝替换。

function ProgressiveImage({
  previewSrc,
  originalSrc,
  alt,
  onNaturalSize,
  ...motionProps
}: {
  previewSrc: string;
  originalSrc?: string;
  alt: string;
  onNaturalSize?: (width: number, height: number) => void;
} & React.ComponentProps<typeof motion.img>) {
  // 仅追踪原图是否已加载完成，display src 由 props 派生，避免 effect 内同步 setState
  const [loadedOriginal, setLoadedOriginal] = useState<string | null>(null);
  const src = (loadedOriginal && loadedOriginal === originalSrc) ? loadedOriginal : previewSrc;

  useEffect(() => {
    if (!originalSrc || originalSrc === previewSrc) return;
    const img = new Image();
    img.onload = () => setLoadedOriginal(originalSrc);
    img.src = originalSrc;
    return () => { img.onload = null; };
  }, [previewSrc, originalSrc]);

  return (
    <motion.img
      {...motionProps}
      src={src}
      alt={alt}
      onLoad={(event) => {
        motionProps.onLoad?.(event);
        const image = event.currentTarget;
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          onNaturalSize?.(image.naturalWidth, image.naturalHeight);
        }
      }}
    />
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
  const [measuredRatios, setMeasuredRatios] = useState<Record<string, number>>({});
  const [hoveredEdge, setHoveredEdge] = useState<'prev' | 'next' | null>(null);
  const handleNaturalSize = useCallback((photoId: string, width: number, height: number) => {
    if (height <= 0) return;
    const ratio = width / height;
    setMeasuredRatios((prev) => {
      if (Math.abs((prev[photoId] ?? 0) - ratio) < 0.001) return prev;
      return { ...prev, [photoId]: ratio };
    });
  }, []);
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
    top: 'calc(50% - 28px)',
    translate: '-50% -50%',
    borderRadius: 8,
    overflow: 'visible',
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {slots.map(({ slot, idx }) => {
        const pos = CARD_POSITIONS[slot];
        const photo = photos[idx];
        const isCenter = slot === 'center';
        const frameStyle = getFrameStyle(photo, isCenter, measuredRatios[photo.id]);

        return (
          <motion.div
            key={slot}
            initial={false}
            style={{
              ...baseStyle,
              ...frameStyle,
              zIndex: pos.z,
              cursor: isCenter ? 'default' : 'pointer',
              boxShadow: isCenter
                ? '0 22px 80px rgba(0,0,0,0.28)'
                : '0 16px 48px rgba(0,0,0,0.18)',
            }}
            animate={{
              x: pos.tx,
              rotate: pos.rotate,
              scale: pos.scale,
              opacity: pos.opacity,
            }}
            transition={{ duration: 0.8, ease: appleEase }}
            onClick={isCenter ? undefined : () => onNavigate(slot === 'left' ? -1 : 1)}
          >
            {/* 滑动 + 交叉淡入：新图从移动方向滑入，旧图反向滑出 */}
            <div style={{
              position: 'absolute',
              inset: 0,
              overflow: 'hidden',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.06)',
            }}>
            <AnimatePresence initial={false}>
              <ProgressiveImage
                key={photo.id}
                previewSrc={photo.url}
                originalSrc={isCenter ? photo.originalUrl : undefined}
                alt={photo.caption || photo.fileName}
                onNaturalSize={(width, height) => handleNaturalSize(photo.id, width, height)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8, ease: appleEase }}
                style={{
                  position: 'absolute', inset: 0,
                  width: '100%', height: '100%',
                  objectFit: 'contain',
                  display: 'block',
                }}
              />
            </AnimatePresence>
            </div>
            {isCenter && (
              <>
                {/* 宝丽来白条——叠在照片底部 5%，奶白色 overlay */}
                <div style={{
                  position: 'absolute',
                  bottom: 0, left: 0, right: 0,
                  height: '5%', minHeight: 32,
                  display: 'flex', alignItems: 'center',
                  background: 'linear-gradient(to bottom, rgba(255,255,250,0.96), rgba(255,255,250,0.88))',
                  borderTop: '1px solid rgba(45,45,45,0.08)',
                  borderBottomLeftRadius: 8,
                  borderBottomRightRadius: 8,
                }}>
                  <PhotoFrameBar photo={photo} />
                </div>
                {/* 边缘悬停箭头——到头不渲染 */}
                {hasPrev && (
                  <div
                    className="gallery-edge-zone"
                    onClick={(e) => { e.stopPropagation(); onNavigate(-1); }}
                    onMouseEnter={() => setHoveredEdge('prev')}
                    onMouseLeave={() => setHoveredEdge(null)}
                    style={{
                      position: 'absolute', left: -44, top: '50%', width: 32, height: 64,
                      transform: 'translateY(-50%)',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <span style={{
                      width: 34, height: 34, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: hoveredEdge === 'prev' ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.07)',
                      border: hoveredEdge === 'prev' ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(255,255,255,0.06)',
                      transition: 'background 0.18s ease, border-color 0.18s ease',
                    }}>
                      <svg className="gallery-edge-arrow" width="28" height="28" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{
                        opacity: hoveredEdge === 'prev' ? 1 : 0.32,
                        filter: 'drop-shadow(0 2px 7px rgba(0,0,0,0.65))',
                        transition: 'opacity 0.18s ease',
                      }}>
                        <polyline points="15 18 9 12 15 6" stroke="rgba(0,0,0,0.58)" strokeWidth="5" />
                        <polyline points="15 18 9 12 15 6" stroke="rgba(255,255,255,0.96)" strokeWidth="2.4" />
                      </svg>
                    </span>
                  </div>
                )}
                {hasNext && (
                  <div
                    className="gallery-edge-zone"
                    onClick={(e) => { e.stopPropagation(); onNavigate(1); }}
                    onMouseEnter={() => setHoveredEdge('next')}
                    onMouseLeave={() => setHoveredEdge(null)}
                    style={{
                      position: 'absolute', right: -44, top: '50%', width: 32, height: 64,
                      transform: 'translateY(-50%)',
                      cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    <span style={{
                      width: 34, height: 34, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: hoveredEdge === 'next' ? 'rgba(0,0,0,0.16)' : 'rgba(0,0,0,0.07)',
                      border: hoveredEdge === 'next' ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(255,255,255,0.06)',
                      transition: 'background 0.18s ease, border-color 0.18s ease',
                    }}>
                      <svg className="gallery-edge-arrow" width="28" height="28" viewBox="0 0 24 24" fill="none" strokeLinecap="round" strokeLinejoin="round" style={{
                        opacity: hoveredEdge === 'next' ? 1 : 0.32,
                        filter: 'drop-shadow(0 2px 7px rgba(0,0,0,0.65))',
                        transition: 'opacity 0.18s ease',
                      }}>
                        <polyline points="9 18 15 12 9 6" stroke="rgba(0,0,0,0.58)" strokeWidth="5" />
                        <polyline points="9 18 15 12 9 6" stroke="rgba(255,255,255,0.96)" strokeWidth="2.4" />
                      </svg>
                    </span>
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
    return (
      <div key={key} style={{
        height: SLOT_H, display: 'flex', alignItems: 'center', paddingLeft: 16,
        transform: `translateX(${arcX}px)`,
        transition: 'transform 0.4s ease',
      }}>
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,255,255,0.25)' }} />
      </div>
    );
  };

  /** 渲染相册条目 */
  const renderAlbum = (album: GalleryPublicListItem, i: number) => {
    const dist = Math.abs(i - currentIdx);
    const arcX = dist * dist * ARC_K;
    const opacity = 1;
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
          width: 5, height: 5,
          borderRadius: '50%',
          backgroundColor: isSelected ? '#fff' : 'rgba(255,255,255,0.35)',
          transition: 'background-color 0.3s',
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
        initial={false}
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
      .catch((err) => {
        // 列表加载失败时停止 loading 状态，页面展示空状态
        console.error('[Gallery] 加载动态列表失败:', err);
        setLoading(false);
      });
     
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载拉列表；searchParams 入 deps 会与 setSearchParams 互相触发
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
      .catch((err) => {
        // 详情加载失败时静默忽略（依赖缓存/重试），记录错误供调试
        console.error('[Gallery] 加载动态详情失败:', err);
      });
  }, [posts, postIdx]);

  // 当前相册切换时，照片索引和方向归零
  useEffect(() => {
    void Promise.resolve().then(() => setPhotoIdx(0));
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

      {/* 右侧时间轴 */}
      <ArcTimeline
        albums={posts}
        currentIdx={postIdx}
        onSelect={(i) => { selectPost(i); }}
      />
    </div>
  );
}
