/**
 * HeroGarden — 首页定格动画野地
 *
 * 视觉结构（从上到下）：
 *   花朵（从草丛里长出来）
 *   草叶（密集宽叶覆盖）
 *   土壤（等腰梯形截面：上窄下宽，两侧弧形）
 *
 * 动画帧序：空白 → 啪·土壤+草 → 花逐株生长
 */

import { useEffect, useMemo, useState, useCallback, createContext, useContext } from 'react';

/* ═══════════ 确定性随机 ═══════════ */

function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ═══════════ 动画时钟 ═══════════ */

const STEP_MS = 400;
const GROW_STEPS = 12;

const TickCtx = createContext<{ tick: number; getP: (d: number) => number }>({ tick: 0, getP: () => 0 });

export function GardenTickProvider({ children }: { children: React.ReactNode }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (tick >= GROW_STEPS + 20) return;
    const t = setTimeout(() => setTick((v) => v + 1), STEP_MS);
    return () => clearTimeout(t);
  }, [tick]);
  const getP = useCallback((d: number) => Math.min(Math.max(0, tick - d) / GROW_STEPS, 1), [tick]);
  return <TickCtx.Provider value={{ tick, getP }}>{children}</TickCtx.Provider>;
}

/* ═══════════ 配色方案 —— 替换整个 PALETTE 即可切换主题 ═══════════ */

const PALETTE = {
  // ── 土壤 — 深沃土 ──
  soil: '#6a5040',

  // ── 草地 / 茎 — 极深绿，高饱和 ──
  grass: '#0f5518',
  stemDark: '#082e0a',
  leafLight: '#1e7a20',

  // ── 藤蔓 — 与草同色系 ──
  vine: '#0f5518',
  vineLeaf: '#0f5518',
  vineVein: '#082e0a',

  // ── 玫瑰 — 鲜粉，绿底下更跳 ──
  roseLight: '#f8d8e0',
  roseMid: '#f0a0b8',
  roseDeep: '#d86888',
  roseInnerLight: '#fce8f0',
  roseInner: '#f0bcd0',
  roseCenter: '#e8c040',

  // ── 雏菊 — 暖白 ──
  daisyLight: '#f5f0e4',
  daisyShadow: '#e8e0cc',
  daisyCenter: '#d8a828',

  // ── 薰衣草 — 浓紫 ──
  lavender: '#7860a0',

  // ── 风铃花 — 矢车菊蓝 ──
  bellPetal: '#5868b0',
  bellCenter: '#e8d060',

  // ── 蕨类 — 深林绿 ──
  fernLeaf: '#0e4c14',

  // ── 蒲公英 — 暖调 ──
  dandelionStem: '#1a4c18',
  puffCore: '#e0d8b8',
  puffRay: '#b8a878',
  puffTip: '#d0c890',
};

/* ═══════════ 可调参数 ═══════════ */

const GRASS = PALETTE.grass;
const SOIL = PALETTE.soil;
const SOIL_INSET = 30;
const STEM_WIDTH = 3;
const STEM_COLOR = PALETTE.grass;
const PLANT_SCALE = 1.5;
const PLANT_COUNT = 24;
const FLOWER_GROW_FRAMES = 5;
const LEAN_RANGE = 12;

/* ═══════════ 渐变 defs ═══════════ */

function Defs() {
  return (
    <defs>
      <radialGradient id="gRose" cx="30%" cy="25%">
        <stop offset="0%" stopColor={PALETTE.roseLight} /><stop offset="40%" stopColor={PALETTE.roseMid} /><stop offset="100%" stopColor={PALETTE.roseDeep} />
      </radialGradient>
      <radialGradient id="gRoseIn" cx="50%" cy="40%">
        <stop offset="0%" stopColor={PALETTE.roseInnerLight} /><stop offset="100%" stopColor={PALETTE.roseInner} />
      </radialGradient>
      <radialGradient id="gDaisy" cx="50%" cy="50%">
        <stop offset="0%" stopColor={PALETTE.daisyLight} /><stop offset="100%" stopColor={PALETTE.daisyShadow} />
      </radialGradient>
      <linearGradient id="gLeaf" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={PALETTE.grass} /><stop offset="100%" stopColor={PALETTE.leafLight} />
      </linearGradient>
      <linearGradient id="gStem" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor={PALETTE.stemDark} /><stop offset="50%" stopColor={PALETTE.grass} /><stop offset="100%" stopColor={PALETTE.stemDark} />
      </linearGradient>
    </defs>
  );
}

/* ═══════════ 草叶生成 ═══════════ */

function GrassBlades({ w, groundY }: { w: number; groundY: number }) {
  const blades = useMemo(() => {
    const r = seededRng(300);
    const rand = (a: number, b: number) => a + r() * (b - a);
    const layers = [
      { count: 160, minH: 8, maxH: 16, opacity: 0.95, widthMul: 2.5, minW: 6 },
      { count: 110, minH: 16, maxH: 34, opacity: 0.7, widthMul: 1.8, minW: 4 },
      { count: 90, minH: 28, maxH: 52, opacity: 0.85, widthMul: 1.6, minW: 4 },
    ];
    const result: Array<{ d: string; opacity: number }> = [];
    layers.forEach((layer) => {
      for (let i = 0; i < layer.count; i++) {
        const x = rand(20, w - 20);
        const h = rand(layer.minH, layer.maxH);
        const bw = (layer.minW + rand(0, 4)) * layer.widthMul;
        const lean = rand(-10, 10);
        const curve = rand(-8, 8);
        const tipX = x + lean;
        const tipY = groundY - h;
        result.push({
          d: `M ${x - bw / 2},${groundY} C ${x - bw / 2 + curve * 0.3},${groundY - h * 0.4} ${tipX - bw * 0.15 + curve},${groundY - h * 0.8} ${tipX},${tipY} C ${tipX + bw * 0.15 + curve},${groundY - h * 0.8} ${x + bw / 2 + curve * 0.3},${groundY - h * 0.4} ${x + bw / 2},${groundY} Z`,
          opacity: layer.opacity,
        });
      }
    });
    return result;
  }, [w, groundY]);

  return <g>{blades.map((b, i) => <path key={i} d={b.d} fill={GRASS} opacity={b.opacity} />)}</g>;
}

/* ═══════════ 土壤截面（等腰梯形：上窄下宽，弧形侧边） ═══════════ */

function SoilTrapezoid({ w, topY, bottomY, opacity = 1 }: { w: number; topY: number; bottomY: number; opacity?: number }) {
  const inset = SOIL_INSET;

  // 顶边不规则（比底边窄）
  const topPath = useMemo(() => {
    const r = seededRng(500);
    const pts: string[] = [];
    for (let x = inset; x <= w - inset; x += 25) {
      pts.push(`${x},${topY + (r() - 0.5) * 2}`);
    }
    return pts.join(' L ');
  }, [w, topY]);

  // 等腰梯形：顶边窄（inset ~ w-inset），底边宽（0 ~ w），弧形侧边
  const d = `
    M ${inset},${topY} L ${topPath} L ${w - inset},${topY}
    Q ${w},${topY} ${w},${bottomY}
    L 0,${bottomY}
    Q 0,${topY} ${inset},${topY}
    Z
  `;

  return <path d={d} fill={SOIL} opacity={opacity} />;
}

/* ═══════════ 通用茎路径 ═══════════ */

/** 生成弯曲填充茎的 path d，w=茎宽，h=高度，lean=弯曲量 */
function stemPath(h: number, lean: number, w = STEM_WIDTH): string {
  const hw = w / 2;
  return `M ${-hw},0 C ${-hw + lean},${-h * 0.3} ${hw - lean * 0.5},${-h * 0.6} ${lean * 0.6},${-h} L ${w + lean * 0.6},${-h} C ${w + hw - lean * 0.5},${-h * 0.6} ${hw + lean},${-h * 0.3} ${hw},0 Z`;
}

/* ═══════════ 花组件（填充茎，无 stroke） ═══════════ */

function Rose({ progress: p, lean = 0 }: { progress: number; lean?: number }) {
  const sp = p < 0.08 ? 0 : Math.min((p - 0.08) / 0.45, 1);
  const fp = Math.max(0, (p - 0.55) / 0.45);
  const h = 35 * sp;
  const b = lean; // 弯曲量
  if (h <= 0) return null;
  return (
    <g>
      <path d={stemPath(h, b)} fill={STEM_COLOR} />
      {sp > 0.4 && <g transform={`translate(${-1 + b * 0.3},${-h * 0.4}) rotate(-25)`}><path d="M 0,0 C -3,-5 -8,-8 -12,-6 C -10,-2 -5,0 0,0 Z" fill="url(#gLeaf)" opacity="0.7" /></g>}
      {fp > 0 && (
        <g transform={`translate(${2 + b * 0.5},${-h}) rotate(${b * 1.2})`}>
          <g opacity="0.85">{[0, 72, 144, 216, 288].map((a) => <path key={a} d={`M 0,-1 C -4,${-8 * fp} -10,${-12 * fp} -11,${-7 * fp} C -10,${-2 * fp} -5,1 0,-1 Z`} fill="url(#gRose)" transform={`rotate(${a})`} />)}</g>
          <g opacity="0.9">{[36, 108, 180, 252, 324].map((a) => <path key={a} d={`M 0,0 C -3,${-5 * fp} -7,${-7 * fp} -7,${-4 * fp} C -6,${-1 * fp} -3,0 0,0 Z`} fill="url(#gRoseIn)" transform={`rotate(${a})`} />)}</g>
          <circle cx="0" cy="0" r={1.5 + fp} fill={PALETTE.roseCenter} opacity="0.5" />
        </g>
      )}
    </g>
  );
}

function Daisy({ progress: p, lean = 0 }: { progress: number; lean?: number }) {
  const sp = p < 0.08 ? 0 : Math.min((p - 0.08) / 0.45, 1);
  const fp = Math.max(0, (p - 0.55) / 0.45);
  const h = 32 * sp;
  const b = lean;
  if (h <= 0) return null;
  return (
    <g>
      <path d={stemPath(h, b)} fill={STEM_COLOR} />
      {fp > 0 && (
        <g transform={`translate(${b * 0.6},${-h}) rotate(${b * 1.2})`}>
          <g opacity="0.88">{Array.from({ length: 10 }).map((_, i) => <ellipse key={i} cx="0" cy={-6 * fp} rx={1.8 * fp} ry={5 * fp} fill="url(#gDaisy)" transform={`rotate(${i * 36})`} />)}</g>
          <circle cx="0" cy="0" r={2.5 * fp} fill={PALETTE.daisyCenter} />
        </g>
      )}
    </g>
  );
}

function Lavender({ progress: p, lean = 0 }: { progress: number; lean?: number }) {
  const sp = p < 0.08 ? 0 : Math.min((p - 0.08) / 0.45, 1);
  const fp = Math.max(0, (p - 0.5) / 0.5);
  const h = 45 * sp;
  const b = lean;
  if (h <= 0) return null;
  return (
    <g>
      <path d={stemPath(h, b)} fill={STEM_COLOR} />
      {fp > 0 && <g transform={`translate(${b * 0.6},${-h}) rotate(${b * 1.5})`}>{[0, -4.5, -9, -13, -16.5, -19.5].map((y, i) => <ellipse key={i} cx={i % 2 === 0 ? -0.5 : 0.5} cy={y * fp} rx={3.5 - i * 0.3} ry={2.2 - i * 0.15} fill={PALETTE.lavender} opacity={0.7 * fp} />)}</g>}
    </g>
  );
}

function Bellflower({ progress: p, lean = 0 }: { progress: number; lean?: number }) {
  const sp = p < 0.08 ? 0 : Math.min((p - 0.08) / 0.45, 1);
  const fp = Math.max(0, (p - 0.55) / 0.45);
  const h = 36 * sp;
  const b = lean;
  if (h <= 0) return null;
  return (
    <g>
      <path d={stemPath(h, b)} fill={STEM_COLOR} />
      {fp > 0 && (
        <g transform={`translate(${b * 0.6},${-h}) rotate(${b * 1.2})`}>
          <g opacity="0.8">{[0, 72, 144, 216, 288].map((a) => <path key={a} d={`M 0,-1 C -3,${-6 * fp} -7,${-10 * fp} -8,${-6 * fp} C -8,${-2 * fp} -4,0 0,-1 Z`} fill={PALETTE.bellPetal} transform={`rotate(${a})`} />)}</g>
          <circle cx="0" cy="0" r={2.2 * fp} fill={PALETTE.bellCenter} opacity="0.55" />
        </g>
      )}
    </g>
  );
}

function Fern({ progress: p, lean = 0 }: { progress: number; lean?: number }) {
  const gp = p < 0.05 ? 0 : Math.min((p - 0.05) / 0.7, 1);
  const h = 55 * gp;
  const lc = Math.floor(gp * 8);
  if (h <= 0) return null;
  return (
    <g>
      <path d={stemPath(h, lean)} fill={STEM_COLOR} />
      {Array.from({ length: lc }).map((_, i) => { const y = -h * (0.2 + i * 0.1); return (<g key={i}><path d={`M 1,${y} C ${-7 - i * 0.7},${y - 4} ${-11 - i * 0.4},${y + 1.5} -8,${y + 3} C -5,${y + 1.5} 0,${y} 1,${y} Z`} fill={PALETTE.fernLeaf} opacity="0.6" /><path d={`M 1,${y} C ${7 + i * 0.7},${y - 4} ${11 + i * 0.4},${y + 1.5} 8,${y + 3} C 5,${y + 1.5} 2,${y} 1,${y} Z`} fill={PALETTE.fernLeaf} opacity="0.55" /></g>); })}
    </g>
  );
}

function Dandelion({ progress: p, lean = 0 }: { progress: number; lean?: number }) {
  const sp = p < 0.08 ? 0 : Math.min((p - 0.08) / 0.4, 1);
  const pp = Math.max(0, (p - 0.5) / 0.5);
  const h = 38 * sp;
  if (h <= 0) return null;
  return (
    <g>
      <path d={stemPath(h, lean)} fill={PALETTE.dandelionStem} />
      {pp > 0 && (
        <g transform={`translate(${lean * 0.6},${-h}) rotate(${lean * 1.2})`}>
          <circle cx="0" cy="0" r={3 * pp} fill={PALETTE.puffCore} opacity="0.8" />
          {Array.from({ length: 12 }).map((_, i) => { const a = i * 30 * Math.PI / 180; const len = 10 * pp; return (<g key={i}><line x1="0" y1="0" x2={Math.cos(a) * len} y2={Math.sin(a) * len} stroke={PALETTE.puffRay} strokeWidth="0.4" opacity="0.7" /><circle cx={Math.cos(a) * len} cy={Math.sin(a) * len} r={1 * pp} fill={PALETTE.puffTip} opacity="0.7" /></g>); })}
        </g>
      )}
    </g>
  );
}

/* ═══════════ 花圃主组件 ═══════════ */

const PLANTS = [Rose, Daisy, Lavender, Bellflower, Fern, Dandelion] as const;

export function HeroGarden() {
  const { tick } = useContext(TickCtx);

  const plants = useMemo(() => {
    const r = seededRng(Math.floor(Math.random() * 100000));
    const count = PLANT_COUNT;
    // 均匀分布：先等分 24 个槽位，每个槽位内加小随机偏移
    return Array.from({ length: count }).map((_, i) => ({
      type: Math.floor(r() * PLANTS.length),
      x: 0.06 + (i / (count - 1)) * 0.88 + (r() - 0.5) * (0.88 / count * 0.6),
      delay: r() * 4,
      scale: 0.6 + r() * 0.5,
      lean: (r() - 0.5) * LEAN_RANGE,
    }));
  }, []);

  // 布局：grassY 是地面，花往上长，土壤往下
  const vw = 1000;
  const maxPlantH = 55 * 1.65 + 20;    // 最高花（蕨 55 × 最大 scale 1.65）+ 花头余量
  const grassY = maxPlantH;            // 地面 y = 花的最大高度（给花留足上方空间）
  const soilH = 12;                    // 土壤高度（固定）
  const soilTopY = grassY + 3;
  const soilBotY = grassY + 3 + soilH;
  const svgH = soilBotY;              // SVG 底 = 土壤底

  return (
    <div style={{ userSelect: 'none' }}>
      <svg viewBox={`0 0 ${vw} ${svgH}`} style={{ width: '100%', display: 'block' }}>
        <Defs />
        <clipPath id="grassClip">
          <rect x={SOIL_INSET} y={0} width={vw - SOIL_INSET * 2} height={svgH} />
        </clipPath>

        {/* ═══ 帧 1-3：土壤从草地线往下沉淀出厚度 ═══ */}
        {tick >= 1 && (() => {
          const soilP = Math.min((tick - 1) / 2, 1);
          const currentBotY = soilTopY + soilH * soilP;
          return <SoilTrapezoid w={vw} topY={soilTopY} bottomY={currentBotY} />;
        })()}

        {/* ═══ 帧 5+：花（画在草下面，根被草盖住） ═══ */}
        {tick >= 5 && plants.map((p, i) => {
          const Comp = PLANTS[p.type];
          const flowerProgress = Math.min(Math.max(0, tick - 5 - p.delay * 0.4) / FLOWER_GROW_FRAMES, 1);
          return (
            <g key={i} transform={`translate(${p.x * vw},${grassY}) scale(${p.scale * PLANT_SCALE})`}>
              <Comp progress={flowerProgress} lean={p.lean} />
            </g>
          );
        })}

        {/* ═══ 帧 3-5：草叶从地面往上冒 ═══ */}
        {tick >= 3 && (() => {
          const grassP = Math.min((tick - 3) / 2, 1);
          return (
            <g clipPath="url(#grassClip)">
              {/* 绿色基底 — 地表变绿 */}
              <rect x={0} y={grassY - 2} width={vw} height={soilTopY - grassY + 4} fill={GRASS} />
              {/* 草叶 — 从 groundY 向上缩放生长 */}
              <g transform={`translate(0 ${grassY}) scale(1 ${grassP}) translate(0 ${-grassY})`}>
                <GrassBlades w={vw} groundY={grassY} />
              </g>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

/* ═══════════ 藤蔓占位 ═══════════ */

/* ═══════════ 藤蔓相框 ═══════════ */

const VINE_WIDTH = 24;       // 藤蔓容器宽度（窄，装饰用）
const VINE_AMPLITUDE = 14;   // S 形曲线幅度
const VINE_PERIOD = 120;     // 每个 S 弯的高度间距
const VINE_STROKE = 3.5;     // 藤蔓粗细
const LEAF_SIZE = 24;        // 叶子大小

export function GardenVines({ side }: { side: 'left' | 'right' }) {
  const { tick } = useContext(TickCtx);

  // 帧 4 开始（跟花完全同步），每帧多长一个 S 弯
  const elapsed = Math.max(0, tick - 4);
  const visibleBends = Math.min(elapsed, 4); // 最多 4 个弯

  const isRight = side === 'right';
  const cx = isRight ? VINE_WIDTH - 8 : 8;
  const dir = isRight ? -1 : 1;

  const bends = visibleBends;
  let d = `M ${cx},0`;
  const leafPositions: Array<{ x: number; y: number; side: number }> = [];

  for (let i = 0; i < bends; i++) {
    const y0 = i * VINE_PERIOD;
    const y1 = (i + 1) * VINE_PERIOD;
    const yMid = (y0 + y1) / 2;
    const s = (i % 2 === 0 ? 1 : -1) * dir;
    const peakX = cx + s * VINE_AMPLITUDE;

    d += ` C ${cx},${y0 + (y1 - y0) * 0.25} ${peakX},${yMid - 15} ${peakX},${yMid}`;
    d += ` C ${peakX},${yMid + 15} ${cx},${y1 - (y1 - y0) * 0.25} ${cx},${y1}`;

    leafPositions.push({ x: peakX, y: yMid, side: s });
  }

  // 容器始终占位，内容根据 progress 显示
  return (
    <div className="shrink-0" style={{ width: VINE_WIDTH, overflow: 'visible' }}>
      <svg width={VINE_WIDTH} style={{ height: '100%', overflow: 'visible' }} className="pointer-events-none">
        {visibleBends > 0 && (
          <g>
            <path d={d} fill="none" stroke={PALETTE.vine} strokeWidth={VINE_STROKE} strokeLinecap="round" opacity="0.55" />
            {leafPositions.map((lp, i) => {
              const s = lp.side;
              const sz = LEAF_SIZE;
              return (
                <g key={i} transform={`translate(${lp.x},${lp.y})`}>
                  {/* 叶身 */}
                  <path
                    d={`M 0,0 C ${s * -3},${-sz * 0.5} ${s * -sz},${-sz * 0.7} ${s * -sz},${-sz * 0.3} C ${s * -sz},0 ${s * -5},${sz * 0.2} 0,0 Z`}
                    fill={PALETTE.vineLeaf} opacity="0.55"
                  />
                  {/* 主脉 */}
                  <path
                    d={`M 0,0 Q ${s * -sz * 0.4},${-sz * 0.28} ${s * -sz * 0.85},${-sz * 0.3}`}
                    fill="none" stroke={PALETTE.vineVein} strokeWidth="0.9" opacity="0.45"
                  />
                  {/* 侧脉 ×3 — 从主脉分叉向叶缘 */}
                  <path
                    d={`M ${s * -sz * 0.18},${-sz * 0.1} Q ${s * -sz * 0.35},${-sz * 0.36} ${s * -sz * 0.5},${-sz * 0.46}`}
                    fill="none" stroke={PALETTE.vineVein} strokeWidth="0.5" opacity="0.3"
                  />
                  <path
                    d={`M ${s * -sz * 0.38},${-sz * 0.18} Q ${s * -sz * 0.56},${-sz * 0.4} ${s * -sz * 0.72},${-sz * 0.46}`}
                    fill="none" stroke={PALETTE.vineVein} strokeWidth="0.5" opacity="0.25"
                  />
                  <path
                    d={`M ${s * -sz * 0.55},${-sz * 0.24} Q ${s * -sz * 0.68},${-sz * 0.36} ${s * -sz * 0.82},${-sz * 0.38}`}
                    fill="none" stroke={PALETTE.vineVein} strokeWidth="0.4" opacity="0.2"
                  />
                  {/* 卷须 — 隔一片叶子出一根，叶片对侧 */}
                  {i % 2 === 0 && (
                    <path
                      d={`M 0,6 C ${-s * 5},3 ${-s * 10},9 ${-s * 7},15 C ${-s * 4},19 ${-s * 8},21 ${-s * 6},17`}
                      fill="none" stroke={PALETTE.vine} strokeWidth="0.7" opacity="0.3" strokeLinecap="round"
                    />
                  )}
                </g>
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
}
