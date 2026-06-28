/*
 * IrisAuroraButton —— Aurora 唤出入口(折叠态图标按钮)。
 *
 * 静止显示鸢尾「种子」帧(与编辑草稿页同款入口、与「凝思中」生长动画起点同帧);
 * hover 当场播放一次生长帧 seed→bud→half→bloom(草木纸艺 §3.3 的 hover 版),停在盛放;
 * 移开后柔和淡回种子。语义闭环:种子=Aurora 入定,绽放=唤醒。
 *
 * 动画与降级全在 index.css 的 .iris-aurora-* 规则里(crossfade + prefers-reduced-motion 关动效),
 * 这里只摆四帧叠图 + 透传 button props(onClick 等)。
 */
import type { ComponentProps } from 'react';

export function IrisAuroraButton({ className = '', ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      aria-label="打开 Aurora"
      title="打开 Aurora"
      className={`iris-aurora-btn flex h-7 w-7 items-center justify-center rounded-md outline-none transition-colors hover:bg-[var(--shelf)] focus-visible:outline-none ${className}`}
      {...props}
    >
      <span className="iris-aurora-frames">
        <img className="iris-f f-seed" src="/garden/iris-seed.webp" alt="" draggable={false} />
        <img className="iris-f f-bud" src="/garden/iris-bud.webp" alt="" draggable={false} />
        <img className="iris-f f-half" src="/garden/iris-half.webp" alt="" draggable={false} />
        <img className="iris-f f-bloom" src="/garden/iris-bloom.webp" alt="" draggable={false} />
      </span>
    </button>
  );
}
