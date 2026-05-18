/*
 * PaperGarden — 纸艺花圃 Hero 定格动画
 *
 * 横截面视图：土壤 + 草（从土壤顶部往上长）+ 百花齐放。
 * 定格动画：每帧"啪"一下变化，带轻微淡入柔化视觉冲击。
 *
 * 草的生长逻辑：
 *   - 每根草有"出生帧"，出生时是短草
 *   - 随时间推移，同一根草从短→中→长，图片替换
 *   - 每帧有新的短草冒出来填补空隙
 *
 * 花的生长逻辑：
 *   - 每种花有独立的起始帧和 4 个生长阶段
 *   - 花依次冒出，每帧一朵新花开始生长
 *   - 所有花都是主角，百花齐放
 */

import { useEffect, useMemo, useRef, useState } from 'react';

/* ═══════════ 确定性随机 ═══════════ */

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═══════════ 配置（设计像素，基于 DESIGN_WIDTH 等比缩放） ═══════════ */

/** 设计基准宽度，运行时按容器实际宽度算 scale = containerWidth / DESIGN_WIDTH */
const DESIGN_WIDTH = 680;
/** 容器总高度（设计像素）：SOIL_H + 最高花盛放高度 + 顶部留白 */
const GARDEN_H = 200;
/** 土壤层高度（设计像素） */
const SOIL_H = 50;

const STEP_MS = 900;
const FADE_MS = 200;

/* 草叶按生长阶段：age 0=短, 1=中, 2=长/弯 */
const GRASS_BY_AGE = [
  { asset: '/garden/grass-short.webp', minH: 28, maxH: 36 },
  { asset: '/garden/grass-mid.webp',   minH: 42, maxH: 52 },
  { asset: '/garden/grass-tall.webp',  minH: 55, maxH: 68 },
];
const GRASS_BENT = { asset: '/garden/grass-bent.webp', minH: 50, maxH: 62 };

const GRASS_BATCHES = [
  { count: 200, birthFrame: 1 },
  { count: 80,  birthFrame: 2 },
  { count: 50,  birthFrame: 3 },
];

/* ═══════════ 花卉配置 ═══════════ */

interface FlowerStage {
  asset: string;
  height: number;
}

interface FlowerConfig {
  id: string;
  /** 水平位置百分比 */
  x: number;
  /** 开始生长的帧 */
  startFrame: number;
  /** 4 个生长阶段 */
  stages: FlowerStage[];
  /** z-index，低于草（28-78）则被草遮挡 */
  zIndex: number;
  /** 水平翻转，增加视觉多样性 */
  flipX?: boolean;
  /** 缩放系数，默认 1 */
  scale?: number;
}

/*
 * 百花齐放：所有花同帧同步生长，每种花 2-5 个实例散布。
 * 帧 1: 土壤 + 第一批草
 * 帧 2: 更多草 + 所有花 stage 1（冒芽）
 * 帧 3: 草到顶 + 所有花 stage 2
 * 帧 4: 所有花 stage 3
 * 帧 5: 所有花 stage 4（盛放）
 */

/* 各花种共享的阶段定义 */
/* stage 2 与高草齐平（~65px），stage 1 矮于草，stage 3-4 高出草丛 */
/*
 * 花高度设计：草最高 ~78px，花 × 最小 scale(0.85) 的盛放高度必须 > 78
 * 即 stage 4 基础高度 ≥ 92。stage 1-2 矮于草（藏着），stage 3-4 露出花头。
 */
const BELLFLOWER_STAGES: FlowerStage[] = [
  { asset: '/garden/bellflower-1.webp', height: 45 },
  { asset: '/garden/bellflower-2.webp', height: 68 },
  { asset: '/garden/bellflower-3.webp', height: 88 },
  { asset: '/garden/bellflower-4.webp', height: 105 },
];
const ROSE_STAGES: FlowerStage[] = [
  { asset: '/garden/rose-1.webp', height: 48 },
  { asset: '/garden/rose-2.webp', height: 72 },
  { asset: '/garden/rose-3.webp', height: 92 },
  { asset: '/garden/rose-4.webp', height: 110 },
];
const LAVENDER_STAGES: FlowerStage[] = [
  { asset: '/garden/lavender-1.webp', height: 42 },
  { asset: '/garden/lavender-2.webp', height: 66 },
  { asset: '/garden/lavender-3.webp', height: 85 },
  { asset: '/garden/lavender-4.webp', height: 100 },
];
const DAISY_STAGES: FlowerStage[] = [
  { asset: '/garden/daisy-1.webp', height: 42 },
  { asset: '/garden/daisy-2.webp', height: 66 },
  { asset: '/garden/daisy-3.webp', height: 85 },
  { asset: '/garden/daisy-4.webp', height: 100 },
];
const DANDELION_STAGES: FlowerStage[] = [
  { asset: '/garden/dandelion-1.webp', height: 40 },
  { asset: '/garden/dandelion-2.webp', height: 64 },
  { asset: '/garden/dandelion-3.webp', height: 82 },
  { asset: '/garden/dandelion-4.webp', height: 95 },
];

/*
 * 每种花 2-5 个实例，所有花同帧开始（startFrame=2）。
 *
 * 【z-index 设计意图】花的 z-index（12-16）低于草（24-78），
 * 花从草丛中穿过，茎被草遮挡只露出花头——这是自然的效果，不要改！
 * 花要露出来靠的是"比草高"，不是"在草前面"。
 */
const FLOWERS: FlowerConfig[] = [
  /* 薰衣草 × 4 — 纤细，适合多撒 */
  { id: 'lavender-a', x: 3,  startFrame: 2, zIndex: 13, stages: LAVENDER_STAGES, scale: 0.85 },
  { id: 'lavender-b', x: 37, startFrame: 2, zIndex: 13, stages: LAVENDER_STAGES, flipX: true, scale: 0.95 },
  { id: 'lavender-c', x: 63, startFrame: 2, zIndex: 12, stages: LAVENDER_STAGES, scale: 0.9 },
  { id: 'lavender-d', x: 90, startFrame: 2, zIndex: 13, stages: LAVENDER_STAGES, flipX: true },

  /* 蒲公英 × 3 */
  { id: 'dandelion-a', x: 10, startFrame: 2, zIndex: 14, stages: DANDELION_STAGES, flipX: true, scale: 0.9 },
  { id: 'dandelion-b', x: 50, startFrame: 2, zIndex: 14, stages: DANDELION_STAGES },
  { id: 'dandelion-c', x: 95, startFrame: 2, zIndex: 13, stages: DANDELION_STAGES, scale: 0.85 },

  /* 风铃草 × 3 */
  { id: 'bellflower-a', x: 16, startFrame: 2, zIndex: 14, stages: BELLFLOWER_STAGES, scale: 0.9 },
  { id: 'bellflower-b', x: 44, startFrame: 2, zIndex: 15, stages: BELLFLOWER_STAGES, flipX: true },
  { id: 'bellflower-c', x: 83, startFrame: 2, zIndex: 14, stages: BELLFLOWER_STAGES, scale: 0.88 },

  /* 雏菊 × 3 */
  { id: 'daisy-a', x: 22, startFrame: 2, zIndex: 16, stages: DAISY_STAGES },
  { id: 'daisy-b', x: 57, startFrame: 2, zIndex: 15, stages: DAISY_STAGES, flipX: true, scale: 0.9 },
  { id: 'daisy-c', x: 77, startFrame: 2, zIndex: 16, stages: DAISY_STAGES, scale: 0.85 },

  /* 玫瑰 × 2 — 花头大，少放 */
  { id: 'rose-a', x: 30, startFrame: 2, zIndex: 15, stages: ROSE_STAGES },
  { id: 'rose-b', x: 70, startFrame: 2, zIndex: 15, stages: ROSE_STAGES, flipX: true, scale: 0.92 },
];

/** 最后一朵花盛放的帧 = 最大 startFrame + 3（4阶段） */
const MAX_FRAME = Math.max(...FLOWERS.map((f) => f.startFrame + f.stages.length - 1));

/** 收集所有图片路径，用于预加载 */
const ALL_ASSETS = [
  '/garden/soil.webp',
  ...GRASS_BY_AGE.map((g) => g.asset),
  GRASS_BENT.asset,
  ...FLOWERS.flatMap((f) => f.stages.map((s) => s.asset)),
];

/* ═══════════ 草叶数据 ═══════════ */

interface Blade {
  x: number;
  birthFrame: number;
  heightScale: number;
  rotate: number;
  flipX: boolean;
  useBent: boolean;
}

function generateBlades(): Blade[] {
  const rng = seededRng(42);
  const rand = (a: number, b: number) => a + rng() * (b - a);
  const blades: Blade[] = [];

  GRASS_BATCHES.forEach((batch) => {
    for (let i = 0; i < batch.count; i++) {
      const baseX = (i / batch.count) * 100;
      blades.push({
        x: Math.max(0, Math.min(100, baseX + rand(-1.5, 1.5))),
        birthFrame: batch.birthFrame,
        heightScale: rand(0.85, 1.15),
        rotate: rand(-8, 8),
        flipX: rng() > 0.5,
        useBent: rng() > 0.7,
      });
    }
  });

  return blades;
}

/* ═══════════ 动画状态 ═══════════ */

/** 模块级：刷新重置，路由切换保持。播过一次后不再重播。 */
let hasAnimated = false;

/* ═══════════ 主组件 ═══════════ */

export function PaperGarden() {
  const [frame, setFrame] = useState(hasAnimated ? MAX_FRAME : 0);
  const blades = useMemo(() => generateBlades(), []);

  /* 容器宽度 → 缩放比例，所有设计像素 × scale */
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(() =>
    Math.min(window.innerWidth, DESIGN_WIDTH) / DESIGN_WIDTH,
  );
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / DESIGN_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* 预加载所有图片，避免帧切换时闪白 */
  useEffect(() => {
    ALL_ASSETS.forEach((src) => {
      const img = new Image();
      img.src = src;
    });
  }, []);

  useEffect(() => {
    if (frame >= MAX_FRAME) {
      hasAnimated = true;
      return;
    }
    const t = setTimeout(() => setFrame((f) => f + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [frame]);

  const fadeAnim = `gardenFadeIn ${FADE_MS}ms ease-out`;

  return (
    <div
      ref={containerRef}
      className="mx-auto w-full max-w-[var(--layout-reading-max)]"
      style={{
        position: 'relative',
        height: GARDEN_H * scale,
        overflow: 'visible',
        marginBottom: 8 * scale,
      }}
    >
      <style>{`@keyframes gardenFadeIn{from{opacity:0}to{opacity:1}}`}</style>


      {/* 土壤 */}
      {frame >= 1 && (
        <img
          src="/garden/soil.webp"
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: SOIL_H * scale,
            objectFit: 'fill',
            animation: fadeAnim,
          }}
        />
      )}

      {/* 草叶 */}
      {blades.map((b, i) => {
        if (frame < b.birthFrame) return null;
        const age = Math.min(frame - b.birthFrame, 2);
        const stage = age === 2 && b.useBent ? GRASS_BENT : GRASS_BY_AGE[age];
        const h = (stage.minH + (stage.maxH - stage.minH) * 0.5) * b.heightScale * scale;

        return (
          <img
            key={`g-${i}-${age}`}
            src={stage.asset}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: `${b.x}%`,
              bottom: SOIL_H * scale,
              height: h,
              width: 'auto',
              transformOrigin: 'bottom center',
              transform: `translateX(-50%) rotate(${b.rotate}deg) scaleX(${b.flipX ? -1 : 1})`,
              zIndex: Math.round(h),
              pointerEvents: 'none',
              animation: fadeAnim,
            }}
          />
        );
      })}

      {/* 花卉 — 统一渲染，支持 flipX/scale 增加多样性 */}
      {FLOWERS.map((flower) => {
        if (frame < flower.startFrame) return null;
        const stageIdx = Math.min(frame - flower.startFrame, flower.stages.length - 1);
        const stage = flower.stages[stageIdx];
        const s = flower.scale ?? 1;

        return (
          <img
            key={`${flower.id}-${stageIdx}`}
            src={stage.asset}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: `${flower.x}%`,
              bottom: SOIL_H * scale,
              height: stage.height * s * scale,
              width: 'auto',
              transformOrigin: 'bottom center',
              transform: `translateX(-50%)${flower.flipX ? ' scaleX(-1)' : ''}`,
              zIndex: flower.zIndex,
              pointerEvents: 'none',
              animation: fadeAnim,
            }}
          />
        );
      })}
    </div>
  );
}
