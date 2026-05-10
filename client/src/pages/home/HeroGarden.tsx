/**
 * HeroGarden — 首页定格动画野地
 *
 * 结构：草地（密集草叶铺底） + 土壤截面 + 零星花朵点缀
 * 动画：空白 → 啪·土壤 → 啪·草地 → 花逐株生长
 */

import { useEffect, useMemo, useState, useCallback, createContext, useContext } from 'react';

/* ═══════════ 工具 ═══════════ */

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

const TickCtx = createContext<{ tick: number; getP: (delay: number) => number }>({
  tick: 0, getP: () => 0,
});

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

/* ═══════════ 常量 ═══════════ */

const GRASS_COLOR = '#3a6a2e';
const SOIL_COLOR = '#96806a';

/* ═══════════ 草地（JS 生成 SVG 元素） ═══════════ */

function GrassLayer({ w, groundY }: { w: number; groundY: number }) {
  const paths = useMemo(() => {
    const r = seededRng(300);
    const rand = (a: number, b: number) => a + r() * (b - a);

    const layers = [
      { count: 160, minH: 8, maxH: 16, opacity: 0.95, widthMul: 2.5, minW: 6 },
      { count: 110, minH: 16, maxH: 34, opacity: 0.7, widthMul: 1.8, minW: 4 },
      { count: 90, minH: 28, maxH: 52, opacity: 0.85, widthMul: 1.6, minW: 4 },
    ];

    const result: Array<{ d: string; opacity: number }> = [];

    layers.forEach(layer => {
      for (let i = 0; i < layer.count; i++) {
        const x = rand(-5, w + 5);
        const h = rand(layer.minH, layer.maxH);
        const bw = (layer.minW + rand(0, 4)) * layer.widthMul;
        const lean = rand(-10, 10);
        const curve = rand(-8, 8);
        const tipX = x + lean;
        const tipY = groundY - h;

        result.push({
          d: [
            `M ${x - bw / 2},${groundY}`,
            `C ${x - bw / 2 + curve * 0.3},${groundY - h * 0.4} ${tipX - bw * 0.15 + curve},${groundY - h * 0.8} ${tipX},${tipY}`,
            `C ${tipX + bw * 0.15 + curve},${groundY - h * 0.8} ${x + bw / 2 + curve * 0.3},${groundY - h * 0.4} ${x + bw / 2},${groundY}`,
            'Z',
          ].join(' '),
          opacity: layer.opacity,
        });
      }
    });
    return result;
  }, [w, groundY]);

  return (
    <g>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={GRASS_COLOR} opacity={p.opacity} />
      ))}
    </g>
  );
}

/* ═══════════ 土壤截面 ═══════════ */

function SoilLayer({ w, groundY, svgH }: { w: number; groundY: number; svgH: number }) {
  const d = useMemo(() => {
    const r = seededRng(500);
    const rand = (a: number, b: number) => a + r() * (b - a);
    const topY = groundY + 4;

    const pts: Array<{ x: number; y: number }> = [];
    for (let x = 0; x <= w; x += 30) {
      pts.push({ x, y: topY + rand(-3, 3) });
    }

    let path = `M 0,${svgH} L ${pts[0].x},${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const cpx = (prev.x + cur.x) / 2;
      const cpy = (prev.y + cur.y) / 2 + rand(-1.5, 1.5);
      path += ` Q ${cpx},${cpy} ${cur.x},${cur.y}`;
    }
    path += ` L ${w},${svgH} Z`;
    return path;
  }, [w, groundY, svgH]);

  return <path d={d} fill={SOIL_COLOR} opacity="0.6" />;
}

/* ═══════════ 花瓣渐变 defs ═══════════ */

function GardenDefs() {
  return (
    <defs>
      <radialGradient id="gRose" cx="30%" cy="25%">
        <stop offset="0%" stopColor="#f8dce4" /><stop offset="40%" stopColor="#f0b8c8" /><stop offset="100%" stopColor="#d8849c" />
      </radialGradient>
      <radialGradient id="gRoseIn" cx="50%" cy="40%">
        <stop offset="0%" stopColor="#fdeef0" /><stop offset="100%" stopColor="#f0c8d4" />
      </radialGradient>
      <radialGradient id="gDaisy" cx="50%" cy="50%">
        <stop offset="0%" stopColor="#f4f0ea" /><stop offset="100%" stopColor="#e8e0d4" />
      </radialGradient>
      <linearGradient id="gLeaf" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#3a6a2e" /><stop offset="100%" stopColor="#2a5420" />
      </linearGradient>
      <linearGradient id="gStem" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#2a5020" /><stop offset="50%" stopColor="#3a6a2e" /><stop offset="100%" stopColor="#2a5020" />
      </linearGradient>
    </defs>
  );
}

/* ═══════════ 花组件 ═══════════ */

function SmallRose({ progress }: { progress: number }) {
  const stemP = progress < 0.08 ? 0 : Math.min((progress - 0.08) / 0.45, 1);
  const flowerP = Math.max(0, (progress - 0.55) / 0.45);
  const h = 35 * stemP;
  return (
    <g>
      {h > 0 && <path d={`M 0,0 C -3,${-h * 0.3} 4,${-h * 0.6} 2,${-h}`} fill="none" stroke="url(#gStem)" strokeWidth="2.5" strokeLinecap="round" />}
      {stemP > 0.4 && (
        <g transform={`translate(-1,${-h * 0.4}) rotate(-25)`}>
          <path d="M 0,0 C -3,-5 -8,-8 -12,-6 C -10,-2 -5,0 0,0 Z" fill="url(#gLeaf)" opacity="0.7" />
        </g>
      )}
      {flowerP > 0 && h > 0 && (
        <g transform={`translate(2,${-h})`}>
          <g opacity="0.85">
            {[0, 72, 144, 216, 288].map((a) => (
              <path key={a} d={`M 0,-1 C -4,${-8 * flowerP} -10,${-12 * flowerP} -11,${-7 * flowerP} C -10,${-2 * flowerP} -5,1 0,-1 Z`}
                fill="url(#gRose)" transform={`rotate(${a})`} />
            ))}
          </g>
          <g opacity="0.9">
            {[36, 108, 180, 252, 324].map((a) => (
              <path key={a} d={`M 0,0 C -3,${-5 * flowerP} -7,${-7 * flowerP} -7,${-4 * flowerP} C -6,${-1 * flowerP} -3,0 0,0 Z`}
                fill="url(#gRoseIn)" transform={`rotate(${a})`} />
            ))}
          </g>
          <circle cx="0" cy="0" r={1.5 + flowerP} fill="#ecc850" opacity="0.5" />
        </g>
      )}
    </g>
  );
}

function Daisy({ progress }: { progress: number }) {
  const stemP = progress < 0.08 ? 0 : Math.min((progress - 0.08) / 0.45, 1);
  const flowerP = Math.max(0, (progress - 0.55) / 0.45);
  const h = 28 * stemP;
  return (
    <g>
      {h > 0 && <path d={`M 0,0 C 1,${-h * 0.4} -2,${-h * 0.7} 0,${-h}`} fill="none" stroke="#3a5a28" strokeWidth="1.8" strokeLinecap="round" />}
      {flowerP > 0 && h > 0 && (
        <g transform={`translate(0,${-h})`}>
          <g opacity="0.88">
            {Array.from({ length: 10 }).map((_, i) => (
              <ellipse key={i} cx="0" cy={-6 * flowerP} rx={1.8 * flowerP} ry={5 * flowerP}
                fill="url(#gDaisy)" transform={`rotate(${i * 36})`} />
            ))}
          </g>
          <circle cx="0" cy="0" r={2.5 * flowerP} fill="#d8a830" />
        </g>
      )}
    </g>
  );
}

function Lavender({ progress }: { progress: number }) {
  const stemP = progress < 0.08 ? 0 : Math.min((progress - 0.08) / 0.45, 1);
  const flowerP = Math.max(0, (progress - 0.5) / 0.5);
  const h = 40 * stemP;
  return (
    <g>
      {h > 0 && <path d={`M 0,0 C -1,${-h * 0.4} 1,${-h * 0.7} 0,${-h}`} fill="none" stroke="#3a4a2a" strokeWidth="1.5" strokeLinecap="round" />}
      {flowerP > 0 && h > 0 && (
        <g transform={`translate(0,${-h})`}>
          {[0, -3.5, -7, -10, -13, -15.5].map((y, i) => (
            <ellipse key={i} cx={i % 2 === 0 ? -0.5 : 0.5} cy={y * flowerP}
              rx={2.5 - i * 0.2} ry={1.6 - i * 0.1}
              fill="#8070a0" opacity={0.7 * flowerP} />
          ))}
        </g>
      )}
    </g>
  );
}

function Bellflower({ progress }: { progress: number }) {
  const stemP = progress < 0.08 ? 0 : Math.min((progress - 0.08) / 0.45, 1);
  const flowerP = Math.max(0, (progress - 0.55) / 0.45);
  const h = 32 * stemP;
  return (
    <g>
      {h > 0 && <path d={`M 0,0 C 2,${-h * 0.3} -3,${-h * 0.6} 0,${-h}`} fill="none" stroke="#2a4420" strokeWidth="1.8" strokeLinecap="round" />}
      {flowerP > 0 && h > 0 && (
        <g transform={`translate(0,${-h})`}>
          <g opacity="0.8">
            {[0, 72, 144, 216, 288].map((a) => (
              <path key={a} d={`M 0,-1 C -3,${-6 * flowerP} -7,${-10 * flowerP} -8,${-6 * flowerP} C -8,${-2 * flowerP} -4,0 0,-1 Z`}
                fill="#7080b8" transform={`rotate(${a})`} />
            ))}
          </g>
          <circle cx="0" cy="0" r={1.8 * flowerP} fill="#e8d880" opacity="0.55" />
        </g>
      )}
    </g>
  );
}

function Fern({ progress }: { progress: number }) {
  const p = progress < 0.05 ? 0 : Math.min((progress - 0.05) / 0.7, 1);
  const h = 45 * p;
  const leafCount = Math.floor(p * 8);
  return (
    <g>
      {h > 0 && <path d={`M 0,0 C -1,${-h * 0.3} 2,${-h * 0.6} 1,${-h}`} fill="none" stroke="#2a4420" strokeWidth="1.8" strokeLinecap="round" />}
      {Array.from({ length: leafCount }).map((_, i) => {
        const t = 0.2 + i * 0.1;
        const y = -h * t;
        return (
          <g key={i}>
            <path d={`M 1,${y} C ${-5 - i * 0.5},${y - 3} ${-8 - i * 0.3},${y + 1} ${-6},${y + 2} C ${-4},${y + 1} 0,${y} 1,${y} Z`} fill="#3a5a2a" opacity="0.6" />
            <path d={`M 1,${y} C ${5 + i * 0.5},${y - 3} ${8 + i * 0.3},${y + 1} 6,${y + 2} C 4,${y + 1} 2,${y} 1,${y} Z`} fill="#3a5a2a" opacity="0.55" />
          </g>
        );
      })}
      {p > 0.5 && <path d={`M 1,${-h} C 2,${-h - 3} 4,${-h - 4} 4,${-h - 2}`} fill="none" stroke="#2a4420" strokeWidth="1.2" strokeLinecap="round" />}
    </g>
  );
}

function Dandelion({ progress }: { progress: number }) {
  const stemP = progress < 0.08 ? 0 : Math.min((progress - 0.08) / 0.4, 1);
  const puffP = Math.max(0, (progress - 0.5) / 0.5);
  const h = 30 * stemP;
  return (
    <g>
      {h > 0 && <path d={`M 0,0 C -0.5,${-h * 0.4} 0.5,${-h * 0.7} 0,${-h}`} fill="none" stroke="#5a6a3a" strokeWidth="1.2" strokeLinecap="round" />}
      {puffP > 0 && h > 0 && (
        <g transform={`translate(0,${-h})`}>
          <circle cx="0" cy="0" r={2.5 * puffP} fill="#e8e0d0" opacity="0.5" />
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i * 30) * Math.PI / 180;
            const len = 8 * puffP;
            return (
              <g key={i}>
                <line x1="0" y1="0" x2={Math.cos(a) * len} y2={Math.sin(a) * len} stroke="#c8c0a8" strokeWidth="0.25" opacity="0.45" />
                <circle cx={Math.cos(a) * len} cy={Math.sin(a) * len} r={0.7 * puffP} fill="#d8d0c0" opacity="0.4" />
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
}

/* ═══════════ 花圃主组件 ═══════════ */

const PLANT_TYPES = [SmallRose, Daisy, Lavender, Bellflower, Fern, Dandelion] as const;

export function HeroGarden() {
  const { tick, getP } = useContext(TickCtx);

  const plants = useMemo(() => {
    const r = seededRng(77);
    return Array.from({ length: 10 }).map(() => ({
      type: Math.floor(r() * PLANT_TYPES.length),
      x: 0.05 + r() * 0.9,
      delay: Math.floor(r() * 10),
      scale: 0.6 + r() * 0.5,
    })).sort((a, b) => a.x - b.x);
  }, []);

  const vw = 1000;
  const groundY = 70;
  const svgH = 100;

  return (
    <div style={{ userSelect: 'none' }}>
      <svg viewBox={`0 0 ${vw} ${svgH}`} style={{ width: '100%', display: 'block' }}>
        <GardenDefs />

        {/* 帧 1：土壤 + 草色背景 */}
        {tick >= 1 && (
          <g>
            <rect x="0" y={groundY} width={vw} height={svgH - groundY} fill={GRASS_COLOR} />
            <SoilLayer w={vw} groundY={groundY} svgH={svgH} />
          </g>
        )}

        {/* 帧 2：草地铺上 */}
        {tick >= 2 && <GrassLayer w={vw} groundY={groundY} />}

        {/* 帧 3+：花逐株生长 */}
        {tick >= 3 && plants.map((p, i) => {
          const PlantComp = PLANT_TYPES[p.type];
          return (
            <g key={i} transform={`translate(${p.x * vw},${groundY}) scale(${p.scale})`}>
              <PlantComp progress={getP(p.delay + 3)} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ═══════════ 藤蔓占位 ═══════════ */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function GardenVines(_props: { height: number }) {
  return null; // TODO: 藤蔓相框
}
