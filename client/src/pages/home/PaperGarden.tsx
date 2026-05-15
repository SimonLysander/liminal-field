/*
 * PaperGarden — 纸艺花圃 Hero 动画
 *
 * 用 AI 生成的纸艺单元素图片 + 代码排列组合 + framer-motion 动画。
 * 替换原 SVG HeroGarden，风格对齐纸纹/花体设计语言。
 *
 * 架构：
 *   <PaperGarden>
 *     <SoilLayer />         ← 1 张土壤图
 *     <GrassField />        ← 4 种草叶 × 随机排列
 *     <PaperFlower />×5     ← 每朵花：茎 + 叶 + 花头（花苞→全开 crossfade）
 *
 * 素材目录：/garden/*.png
 * 素材清单：docs/paper-garden-plan.md
 */

import { useMemo } from 'react';
import { motion } from 'motion/react';
import { smoothBounce } from '@/lib/motion';

/* ═══════════ 确定性随机（同 HeroGarden） ═══════════ */

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

/* ═══════════ 配置 ═══════════ */

const GARDEN_WIDTH = 400;
const GARDEN_HEIGHT = 240;
const SOIL_Y = 180; // 土壤顶部 y 坐标

/** 草叶素材（有素材时替换为真实路径） */
const GRASS_ASSETS = [
  '/garden/grass-short.png',
  '/garden/grass-mid.png',
  '/garden/grass-tall.png',
  '/garden/grass-bent.png',
];

/** 花朵配置 */
interface FlowerConfig {
  species: string;
  x: number; // 百分比位置
  delay: number; // 入场延迟(s)
  stem: string; // 茎素材路径
  leaf: string; // 叶素材路径
  stages: string[]; // 花头阶段素材 [花苞, 半开?, 全开]
}

const FLOWERS: FlowerConfig[] = [
  {
    species: 'rose',
    x: 25,
    delay: 2.0,
    stem: '/garden/stem-curved.png',
    leaf: '/garden/leaf-medium.png',
    stages: ['/garden/rose-bud.png', '/garden/rose-half.png', '/garden/rose-full.png'],
  },
  {
    species: 'lavender',
    x: 40,
    delay: 3.0,
    stem: '/garden/stem-straight.png',
    leaf: '/garden/leaf-small.png',
    stages: ['/garden/lavender-bud.png', '/garden/lavender-full.png'],
  },
  {
    species: 'bell',
    x: 15,
    delay: 3.8,
    stem: '/garden/stem-curved.png',
    leaf: '/garden/leaf-medium.png',
    stages: ['/garden/bell-bud.png', '/garden/bell-full.png'],
  },
  {
    species: 'daisy',
    x: 60,
    delay: 4.5,
    stem: '/garden/stem-straight.png',
    leaf: '/garden/leaf-small.png',
    stages: ['/garden/daisy-bud.png', '/garden/daisy-full.png'],
  },
  {
    species: 'dandelion',
    x: 75,
    delay: 5.2,
    stem: '/garden/stem-straight.png',
    leaf: '/garden/leaf-small.png',
    stages: ['/garden/dandelion-bud.png', '/garden/dandelion-full.png'],
  },
];

const GRASS_COUNT = 35;

/* ═══════════ 占位符（素材到位前的临时色块） ═══════════ */

/** 素材图片 — 有文件时显示图片，没有时显示占位色块 */
function Asset({
  src,
  width,
  height,
  fallbackColor = '#ccc',
  style,
  className,
}: {
  src: string;
  width: number;
  height: number;
  fallbackColor?: string;
  style?: React.CSSProperties;
  className?: string;
}) {
  return (
    <img
      src={src}
      alt=""
      width={width}
      height={height}
      className={className}
      style={{
        objectFit: 'contain',
        ...style,
      }}
      draggable={false}
      onError={(e) => {
        /* 素材不存在时显示占位色块 */
        const el = e.currentTarget;
        el.style.display = 'none';
        const placeholder = document.createElement('div');
        placeholder.style.cssText = `width:${width}px;height:${height}px;background:${fallbackColor};border-radius:2px;opacity:0.3;`;
        el.parentNode?.insertBefore(placeholder, el);
      }}
    />
  );
}

/* ═══════════ 土壤层 ═══════════ */

function SoilLayer() {
  return (
    <motion.div
      style={{
        position: 'absolute',
        bottom: 0,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '80%',
        height: GARDEN_HEIGHT - SOIL_Y + 60,
      }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: smoothBounce }}
    >
      <Asset
        src="/garden/soil.png"
        width={320}
        height={80}
        fallbackColor="#8B7355"
        style={{ width: '100%', height: '100%' }}
      />
    </motion.div>
  );
}

/* ═══════════ 草地层 ═══════════ */

interface GrassBlade {
  assetIndex: number;
  x: number;
  scale: number;
  rotate: number;
  flipX: boolean;
  delay: number;
}

function GrassField() {
  const blades = useMemo<GrassBlade[]>(() => {
    const rng = seededRng(42);
    const rand = (a: number, b: number) => a + rng() * (b - a);
    return Array.from({ length: GRASS_COUNT }, (_, i) => ({
      assetIndex: Math.floor(rng() * GRASS_ASSETS.length),
      x: rand(10, 90), // 百分比
      scale: rand(0.7, 1.3),
      rotate: rand(-12, 12),
      flipX: rng() > 0.5,
      delay: 0.5 + i * 0.03,
    }));
  }, []);

  return (
    <>
      {blades.map((blade, i) => (
        <motion.div
          key={i}
          style={{
            position: 'absolute',
            left: `${blade.x}%`,
            bottom: GARDEN_HEIGHT - SOIL_Y + 10,
            transformOrigin: 'bottom center',
            zIndex: Math.floor(blade.scale * 10),
          }}
          initial={{ scale: 0, opacity: 0, filter: 'blur(2px)' }}
          animate={{
            scale: blade.scale,
            opacity: 1,
            filter: 'blur(0px)',
            rotate: blade.rotate,
            scaleX: blade.flipX ? -blade.scale : blade.scale,
          }}
          transition={{
            duration: 0.4,
            delay: blade.delay,
            ease: smoothBounce,
          }}
        >
          <Asset
            src={GRASS_ASSETS[blade.assetIndex]}
            width={12}
            height={40}
            fallbackColor="#6B8E60"
          />
        </motion.div>
      ))}
    </>
  );
}

/* ═══════════ 单朵花 ═══════════ */

function PaperFlower({ config }: { config: FlowerConfig }) {
  const stemHeight = 70;
  const leafSize = 20;
  const flowerSize = 35;

  return (
    <div
      style={{
        position: 'absolute',
        left: `${config.x}%`,
        bottom: GARDEN_HEIGHT - SOIL_Y + 10,
        width: flowerSize,
        marginLeft: -flowerSize / 2,
      }}
    >
      {/* 花茎 — 从底部向上生长 */}
      <motion.div
        style={{
          position: 'absolute',
          bottom: 0,
          left: '50%',
          marginLeft: -4,
          width: 8,
          height: stemHeight,
          transformOrigin: 'bottom center',
        }}
        initial={{ scaleY: 0, opacity: 0 }}
        animate={{ scaleY: 1, opacity: 1 }}
        transition={{ duration: 0.5, delay: config.delay, ease: smoothBounce }}
      >
        <Asset
          src={config.stem}
          width={8}
          height={stemHeight}
          fallbackColor="#5A7A50"
          style={{ width: '100%', height: '100%' }}
        />
      </motion.div>

      {/* 左叶 */}
      <motion.div
        style={{
          position: 'absolute',
          bottom: stemHeight * 0.35,
          right: '55%',
          transformOrigin: 'right center',
        }}
        initial={{ scale: 0, rotate: -30, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ duration: 0.3, delay: config.delay + 0.3, ease: smoothBounce }}
      >
        <Asset
          src={config.leaf}
          width={leafSize}
          height={leafSize * 0.6}
          fallbackColor="#7A9E70"
          style={{ transform: 'scaleX(-1)' }}
        />
      </motion.div>

      {/* 右叶 */}
      <motion.div
        style={{
          position: 'absolute',
          bottom: stemHeight * 0.5,
          left: '55%',
          transformOrigin: 'left center',
        }}
        initial={{ scale: 0, rotate: 30, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ duration: 0.3, delay: config.delay + 0.4, ease: smoothBounce }}
      >
        <Asset
          src={config.leaf}
          width={leafSize}
          height={leafSize * 0.6}
          fallbackColor="#7A9E70"
        />
      </motion.div>

      {/* 花头 — 花苞 crossfade 到全开 */}
      <div
        style={{
          position: 'absolute',
          bottom: stemHeight - 5,
          left: '50%',
          marginLeft: -flowerSize / 2,
          width: flowerSize,
          height: flowerSize,
        }}
      >
        {config.stages.map((stageSrc, stageIdx) => {
          const isLast = stageIdx === config.stages.length - 1;
          const stageDelay = config.delay + 0.5 + stageIdx * 0.4;
          return (
            <motion.div
              key={stageIdx}
              style={{
                position: 'absolute',
                inset: 0,
              }}
              initial={{ opacity: 0, scale: 0.8, filter: 'blur(3px)' }}
              animate={{
                opacity: isLast ? 1 : [0, 1, 1, 0],
                scale: 1,
                filter: 'blur(0px)',
              }}
              transition={{
                opacity: isLast
                  ? { duration: 0.4, delay: stageDelay }
                  : { duration: 0.8, delay: stageDelay, times: [0, 0.2, 0.7, 1] },
                scale: { duration: 0.4, delay: stageDelay, ease: smoothBounce },
                filter: { duration: 0.3, delay: stageDelay },
              }}
            >
              <Asset
                src={stageSrc}
                width={flowerSize}
                height={flowerSize}
                fallbackColor={
                  config.species === 'rose' ? '#D88090' :
                  config.species === 'lavender' ? '#9080B0' :
                  config.species === 'bell' ? '#7888B0' :
                  config.species === 'daisy' ? '#E8E0C0' :
                  '#D0C890'
                }
              />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════ 主组件 ═══════════ */

export function PaperGarden() {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: GARDEN_WIDTH,
        height: GARDEN_HEIGHT,
        margin: '0 auto',
        overflow: 'visible',
      }}
    >
      <SoilLayer />
      <GrassField />
      {FLOWERS.map((config) => (
        <PaperFlower key={config.species} config={config} />
      ))}
    </div>
  );
}
