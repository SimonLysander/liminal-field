/**
 * 字体样板间 —— 阅读字体已定霞鹜文楷;本页现在比的是「UI 界面体」。
 *
 * 问题:UI 骨架(导航/按钮/标签)配什么字,才跟阅读区的霞鹜文楷和谐?
 * 两个候选并排,各做成一个"迷你 App 同框"(假侧栏 UI + 阅读正文),只差 UI 字体:
 *   A. UI = 系统无衬线(现状,零加载)
 *   B. UI = 霞鹜新晰黑 LXGW Neo XiHei(霞鹜全家桶,同一作者,天生和谐;代价:UI 也吃 webfont)
 * 阅读区两边都用霞鹜文楷,只看 UI 字与正文搭不搭。
 *
 * 字体仅本页按需加载(useEffect 注入 <link>),不污染全站。
 */
import { useEffect, useState } from 'react';

/** 候选 webfont(只在本页注入):霞鹜文楷(读)+ 霞鹜新晰黑(UI 候选) */
const FONT_LINKS = [
  { id: 'lxgw', href: 'https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.1.0/style.css' },
  { id: 'neoxihei', href: 'https://fontsapi.zeoseven.com/19/main/result.css' },
];

const READING = "'LXGW WenKai', 'Songti SC', serif";
const UI_SYSTEM = "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif";
const UI_NEOXIHEI = "'LXGW Neo XiHei', -apple-system, 'PingFang SC', sans-serif";

interface Variant {
  key: string;
  name: string;
  sub: string;
  uiFont: string;
  probe: string | null;
}

const VARIANTS: Variant[] = [
  {
    key: 'system',
    name: 'A · UI 用系统无衬线',
    sub: '现状 · 零加载 · 不同门(系统字 vs 霞鹜)',
    uiFont: UI_SYSTEM,
    probe: null,
  },
  {
    key: 'neoxihei',
    name: 'B · UI 用霞鹜新晰黑',
    sub: '霞鹜全家桶 · 同一作者 · 天生和谐(代价:UI 也吃 webfont)',
    uiFont: UI_NEOXIHEI,
    probe: "16px 'LXGW Neo XiHei'",
  },
];

/** 迷你 App 同框:左假侧栏(UI 字体)+ 右阅读面板(标题/正文=霞鹜文楷,元信息/按钮=UI 字体)。 */
function MockApp({ uiFont }: { uiFont: string }) {
  const navItems = ['首页', '笔记', '文集', '画廊'];
  return (
    <div
      className="flex overflow-hidden rounded-lg border"
      style={{ borderColor: 'var(--separator)' }}
    >
      {/* 假侧栏 —— 全用 UI 字体 */}
      <div
        className="w-[150px] shrink-0 p-3"
        style={{ background: 'var(--sidebar-bg)', fontFamily: uiFont }}
      >
        <div
          className="mb-3 flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
          style={{ background: 'var(--shelf)', color: 'var(--ink-ghost)' }}
        >
          搜索 <span className="ml-auto">⌘K</span>
        </div>
        <div className="flex flex-col gap-0.5">
          {navItems.map((label, i) => (
            <div
              key={label}
              className="rounded-md px-2.5 py-1.5 text-base"
              style={{
                background: i === 1 ? 'var(--shelf)' : undefined,
                color: i === 1 ? 'var(--ink)' : 'var(--ink-faded)',
                fontWeight: i === 1 ? 500 : 400,
              }}
            >
              {label}
            </div>
          ))}
        </div>
        <div className="mt-5 text-2xs uppercase" style={{ color: 'var(--ink-ghost)', letterSpacing: '0.06em' }}>
          文稿
        </div>
        <div className="mt-8 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          夜深了，灵感不睡
        </div>
      </div>

      {/* 阅读面板 —— 标题/正文/Aurora 回答=霞鹜文楷;元信息行+按钮=UI 字体 */}
      <div className="min-w-0 flex-1 p-5" style={{ background: 'var(--paper)' }}>
        <h2 className="text-3xl font-semibold" style={{ fontFamily: READING, color: 'var(--ink)' }}>
          在春天，重新学习等待
        </h2>
        {/* 元信息行 + 按钮 = UI 字体(界面骨架) */}
        <div
          className="mt-2 flex items-center gap-3 text-xs"
          style={{ fontFamily: uiFont, color: 'var(--ink-faded)' }}
        >
          <span>2026-05-24</span>
          <span>1,204 字</span>
          <span>已自动保存 03:14</span>
          <span
            className="ml-auto rounded-md border px-2 py-0.5"
            style={{ borderColor: 'var(--separator)', color: 'var(--ink)' }}
          >
            编辑
          </span>
        </div>

        <p className="mt-4 text-lg leading-relaxed" style={{ fontFamily: READING, color: 'var(--ink)' }}>
          让纸墨见证我斑驳而卑微的期许，如何像云雾升腾一般，生长为生机勃勃、斩钉截铁的现实。
        </p>
        <p className="mt-3 text-lg leading-relaxed" style={{ fontFamily: READING, color: 'var(--ink)' }}>
          凌晨 3 点，咖啡见底。我盯着 Figma 里那行 placeholder——「How can I help you today?」——忽然想起，所谓灵感，不过是把白天攒下的 47 个碎念缝合成一句话。
        </p>

        {/* Aurora 回答(阅读字体) */}
        <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--separator)' }}>
          <div className="mb-2 text-xs" style={{ fontFamily: uiFont, color: 'var(--accent)' }}>
            Aurora
          </div>
          <p className="text-md leading-relaxed" style={{ fontFamily: READING, color: 'var(--ink-faded)' }}>
            开头铺垫略长，读者到第 3 句还没等到你的核心主张；「等待」这个意象出现了 5 次，删到 2 次会更有力。
          </p>
        </div>
      </div>
    </div>
  );
}

export default function FontSampleRoom() {
  const [dark, setDark] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});

  // 主题切换:翻转 <html data-theme="midnight">(全站同款机制)
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', dark ? 'midnight' : 'daylight');
    return () => {
      if (prev) root.setAttribute('data-theme', prev);
      else root.removeAttribute('data-theme');
    };
  }, [dark]);

  // 注入候选 webfont(仅本页),并探测是否加载成功
  useEffect(() => {
    const links = FONT_LINKS.map(({ href }) => {
      const el = document.createElement('link');
      el.rel = 'stylesheet';
      el.href = href;
      document.head.appendChild(el);
      return el;
    });

    const check = () => {
      const next: Record<string, boolean> = { lxgw: document.fonts.check("16px 'LXGW WenKai'") };
      for (const v of VARIANTS) {
        if (v.probe) next[v.key] = document.fonts.check(v.probe);
      }
      setLoaded(next);
    };
    void document.fonts.ready.then(check);
    const timers = [1000, 2500, 5000].map((ms) => setTimeout(check, ms));

    return () => {
      links.forEach((el) => el.remove());
      timers.forEach(clearTimeout);
    };
  }, []);

  return (
    <div className="min-h-screen" style={{ background: 'var(--paper)' }}>
      {/* 顶栏 */}
      <header
        className="sticky top-0 z-10 flex items-center justify-between border-b px-8 py-4"
        style={{ background: 'var(--paper)', borderColor: 'var(--separator)' }}
      >
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--ink)' }}>
            字体样板间 · UI 配阅读
          </h1>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-faded)' }}>
            阅读区已定霞鹜文楷;现在比 UI 界面字 —— 看哪个跟正文更像一家人
            {' · '}
            <span style={{ color: loaded.lxgw ? 'var(--success)' : 'var(--ink-ghost)' }}>
              文楷{loaded.lxgw ? '●' : '○'}
            </span>
          </p>
        </div>
        <button
          onClick={() => setDark((d) => !d)}
          className="rounded-md border px-3 py-1.5 text-sm transition-colors"
          style={{ borderColor: 'var(--separator)', color: 'var(--ink)' }}
        >
          {dark ? '☀ 切到日间' : '☾ 切到夜间'}
        </button>
      </header>

      {/* 两个迷你 App 同框对照 */}
      <div className="flex flex-col gap-8 px-8 py-7">
        {VARIANTS.map((v) => (
          <section key={v.key}>
            <div className="mb-3 flex items-baseline gap-2">
              <span className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>
                {v.name}
              </span>
              {v.probe && (
                <span
                  className="text-2xs"
                  style={{ color: loaded[v.key] ? 'var(--success)' : 'var(--ink-ghost)' }}
                >
                  {loaded[v.key] ? '● 已加载' : '○ 加载中/未达'}
                </span>
              )}
              <span className="text-xs" style={{ color: 'var(--ink-faded)' }}>
                {v.sub}
              </span>
            </div>
            <MockApp uiFont={v.uiFont} />
          </section>
        ))}
      </div>
    </div>
  );
}
