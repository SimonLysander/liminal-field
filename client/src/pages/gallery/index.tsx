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

// ─── PhotoFrameBar ─────────────────────────────────────────────────────────────

/*
 * 宝丽来白条 — 照片底部的奶白色 EXIF 参数条。
 * 左侧：设备型号 + 曝光参数（光圈·快门·ISO）+ 焦距
 * 右侧：拍摄时间
 * 等宽字体 (SF Mono / Menlo) 让数字对齐，宝丽来质感。
 */
const FRAME_FONT = '"SF Mono", SFMono-Regular, Menlo, Consolas, monospace';

/**
 * PhotoFrameBar — 宝丽来白条,三栏布局:左 EXIF 元数据 | 中 翻页 dots | 右 拍摄日期。
 * dots 由原底部浮层收编进白条中央,配深色呼应白条墨字;照片得以干净垂直居中。
 */
function PhotoFrameBar({
  photo,
  photoIdx,
  photoCount,
  onNavigate,
}: {
  photo: GalleryPhoto;
  photoIdx: number;
  photoCount: number;
  onNavigate: (dir: number) => void;
}) {
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

  const hasDots = photoCount > 1;
  if (segments.length === 0 && !t.shotAt && !hasDots) return null;

  const atStart = photoIdx === 0;
  const atEnd = photoIdx === photoCount - 1;

  /* 白条内导航箭头:深色,呼应白条墨字 */
  const chevron = (disabled: boolean): React.CSSProperties => ({
    width: 22, height: 22,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: '50%',
    color: disabled ? 'rgba(45,45,45,0.18)' : 'rgba(45,45,45,0.5)',
    cursor: disabled ? 'default' : 'pointer',
    transition: 'color 0.2s',
    flexShrink: 0,
  });

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center',
        width: '100%',
        padding: 'clamp(6px, 0.4vw, 9px) clamp(14px, 0.9vw, 20px)',
        fontFamily: FRAME_FONT,
        fontSize: 'clamp(10.5px, 0.58vw, 13px)',
        letterSpacing: '0.03em',
        color: 'rgba(45,45,45,0.76)',
        lineHeight: 1,
      }}
    >
      {/* 左:大小 + 分辨率 + 曝光参数 + 焦距 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'clamp(10px, 0.75vw, 16px)', overflow: 'hidden', minWidth: 0, justifySelf: 'start' }}>
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

      {/* 中:‹ dots › 翻页导航,屏幕居中 */}
      <div style={{ justifySelf: 'center', display: 'flex', alignItems: 'center', gap: 8 }}>
        {hasDots && (
          <>
            <button
              onClick={atStart ? undefined : () => onNavigate(-1)}
              style={chevron(atStart)}
              onMouseEnter={atStart ? undefined : (e) => { e.currentTarget.style.color = 'rgba(45,45,45,0.85)'; }}
              onMouseLeave={atStart ? undefined : (e) => { e.currentTarget.style.color = 'rgba(45,45,45,0.5)'; }}
              aria-label="上一张"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
              {Array.from({ length: photoCount }, (_, i) => (
                <div
                  key={i}
                  style={{
                    width: i === photoIdx ? 16 : 5,
                    height: 5,
                    borderRadius: i === photoIdx ? 3 : '50%',
                    background: i === photoIdx ? 'rgba(45,45,45,0.7)' : 'rgba(45,45,45,0.22)',
                    transition: 'all 0.25s',
                  }}
                />
              ))}
            </div>
            <button
              onClick={atEnd ? undefined : () => onNavigate(1)}
              style={chevron(atEnd)}
              onMouseEnter={atEnd ? undefined : (e) => { e.currentTarget.style.color = 'rgba(45,45,45,0.85)'; }}
              onMouseLeave={atEnd ? undefined : (e) => { e.currentTarget.style.color = 'rgba(45,45,45,0.5)'; }}
              aria-label="下一张"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </>
        )}
      </div>

      {/* 右:拍摄日期 */}
      <div style={{ justifySelf: 'end' }}>
        {t.shotAt && (
          <span style={{ whiteSpace: 'nowrap', flexShrink: 0, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.08em' }}>
            {t.shotAt}
          </span>
        )}
      </div>
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
 * 单图相框 carousel — 自然 flow 布局，父级 flex 居中，无绝对定位 coverflow。
 * motion layout 驱动不同尺寸照片间相框尺寸的平滑过渡；
 * 宝丽来白条作为自然 flow 子元素紧贴图片下方，不再绝对定位叠压。
 */
/**
 * 单图相框尺寸:用 EXIF 比例算 CSS min(),不依赖图片加载 → 加载时也不塌陷、贴合照片。
 * 预留白条约 44px 高;无比例信息时给稳健方形上限兜底。
 */
function getCenterFrameSize(photo: GalleryPhoto): { width: string; height: string } {
  const w = Number.parseFloat(photo.tags.width ?? '');
  const h = Number.parseFloat(photo.tags.height ?? '');
  const ratio = Number.isFinite(w) && Number.isFinite(h) && h > 0 ? w / h : null;
  // Sidebar 180 + ArcTimeline 120 = 300,扣掉的可用区按 94% 算最大宽
  if (!ratio) {
    return {
      width: 'min(calc(80vw - 300px), calc(96vh - 44px))',
      height: 'min(calc(80vw - 300px), calc(96vh - 44px))',
    };
  }
  return {
    width: `min(calc(94vw - 300px), 1880px, calc((96vh - 44px) * ${ratio}))`,
    height: `min(calc(96vh - 44px), calc((94vw - 300px) / ${ratio}), calc(1880px / ${ratio}))`,
  };
}

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
  const photo = photos[photoIdx];
  const frameSize = getCenterFrameSize(photo);
  // 预加载相邻 ±2 张的预览图:单图视图没有了 coverflow 邻图预载,显式预热缓存,
  // 切换即时显示、避免老图淡出后新图未就绪露出的黑屏。
  const neighbors = [photoIdx - 2, photoIdx - 1, photoIdx + 1, photoIdx + 2].filter(
    (i) => i >= 0 && i < photos.length,
  );

  return (
    <>
      {neighbors.map((i) => (
        <img key={photos[i].id} src={photos[i].url} alt="" aria-hidden="true" style={{ display: 'none' }} />
      ))}
      {/* 单图相框:外层 width 锁定为图片 width,否则 inline-flex 跟随最大子元素,
          白条 EXIF 内容 minimum 比图片宽就会撑外层 → 白条伸出图片外。 */}
      <div
        className="rounded-md"
      style={{
        position: 'relative',
        width: frameSize.width,
        display: 'inline-flex',
        flexDirection: 'column',
        boxShadow: '0 22px 80px rgba(0,0,0,0.28)',
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.06)',
      }}
    >
      {/* 图片区:明确尺寸(比例×视口),图片 contain 铺满,不塌陷 */}
      <div style={{ position: 'relative', width: frameSize.width, height: frameSize.height, overflow: 'hidden' }}>
        {/* crossfade:老图保留淡出、新图淡入叠上(避免切换瞬间全黑);
            ProgressiveImage 内部再做 预览→原图 的变清晰 */}
        <AnimatePresence initial={false}>
          <ProgressiveImage
            key={photo.id}
            previewSrc={photo.url}
            originalSrc={photo.originalUrl}
            alt={photo.caption || photo.fileName}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: appleEase }}
            style={{
              position: 'absolute', inset: 0,
              width: '100%', height: '100%',
              objectFit: 'contain', display: 'block',
            }}
          />
        </AnimatePresence>
      </div>

      {/* 宝丽来白条 — 自然 flow 在图下方;三栏 EXIF | dots | 日期 */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', minHeight: 40,
          background: 'linear-gradient(to bottom, rgba(255,255,250,0.96), rgba(255,255,250,0.88))',
          borderTop: '1px solid rgba(45,45,45,0.08)',
        }}
      >
        <PhotoFrameBar photo={photo} photoIdx={photoIdx} photoCount={photos.length} onNavigate={onNavigate} />
      </div>

      {/*
        字幕浮在白条上方(图片下沿之上),不是另一条白条——只有几个米白小字
        飘在白条顶,有轻墨晕保证可读。极致克制:无背景、无边框、不抢图。
        absolute 定位相对外层相框(已 position:relative),bottom=白条高度让它正好压顶。
      */}
      {photo.caption && (
        <div
          style={{
            position: 'absolute',
            left: 0, right: 0,
            bottom: 40,
            padding: '4px 18px',
            textAlign: 'center',
            color: 'rgba(255,250,242,0.86)',
            fontFamily: 'var(--font-serif, "Source Han Serif SC", "Songti SC", serif)',
            fontStyle: 'italic',
            fontSize: 12, letterSpacing: '0.02em', lineHeight: 1.4,
            textShadow: '0 1px 6px rgba(0,0,0,0.6), 0 0 2px rgba(0,0,0,0.45)',
            pointerEvents: 'none',
          }}
        >
          {photo.caption}
        </div>
      )}
      </div>
    </>
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
          <span
            className={isSelected ? 'text-sm' : 'text-xs'}
            style={{
            fontWeight: isSelected ? 600 : 400,
            color: isSelected ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.4)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            transition: 'all 0.3s',
          }}>{album.title}</span>
          <span
            className="text-3xs"
            style={{
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
        width: 120, zIndex: 20, overflow: 'hidden',
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
      {/*
        层 3:径向 vignette。
        主图按 aspect ratio 算尺寸,几乎不可能正好填满可见区,左右总有 gap。
        这层让边缘永远渐黑——任意 viewport / 任意比例下,Sidebar / ArcTimeline
        之间露出的 BlurBackground 都被压暗,亮场景下也看不到"灰条"。
        中心 50% 区透明保留沉浸感,外圈渐进到 65% 黑。
      */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(ellipse 60% 70% at center, transparent 0%, rgba(0,0,0,0.45) 65%, rgba(0,0,0,0.75) 100%)',
        }}
      />
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
        console.error('[Gallery] 加载动态列表失败:', err);
        // 列表加载失败时停止 loading 状态，页面展示空状态
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
        console.error('[Gallery] 加载动态详情失败:', err);
        // 详情加载失败时静默忽略（依赖缓存/重试）
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
          <span className="text-base" style={{ color: 'rgba(255,255,255,0.3)' }}>暂无画廊内容</span>
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
        {/*
          照片展示区:左右 padding 都扣浮层宽度,让主图按"真实可见区"居中。
          - 左:Sidebar 浮层 ~180px
          - 右:ArcTimeline 浮层 ~132px
          浮层用 absolute 不占 flex 流,如果不扣 padding,主图按 viewport 全
          宽算居中 → 实际偏左 60px → 右侧 BlurBackground 大块露出。
          加上 BlurBackground 的 vignette 双保险:亮场景下边缘永远黑,
          剩下的几十像素 gap 看不出灰色。
        */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px 12px',
            paddingLeft: 180,
            paddingRight: 132,
          }}
        >
          {/* dots/caption 已收编进白条与照片下沿,无需独立浮层 */}
          <PhotoCarousel
            photos={currentDetail?.photos ?? []}
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
