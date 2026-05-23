/*
 * BottomTabBar — 展示端移动端底部导航
 *
 * 仅移动端显示（md:hidden），作为 MainLayout 的 flex 子项，不使用 fixed 定位。
 * 与 Sidebar 共用 nav-spaces 的数据定义，防止数据漂移。
 */

import { useLocation, useNavigate } from 'react-router-dom';
import { spaces, labels, NavIcons, spaceToPath, pathToSpace } from './nav-spaces';

export default function BottomTabBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const active = pathToSpace(location.pathname);

  return (
    <nav
      className="md:hidden flex shrink-0 items-stretch h-14"
      style={{
        background: 'var(--paper)',
        borderTop: '0.5px solid var(--separator)',
      }}
    >
      {spaces.map((space) => {
        const Icon = NavIcons[space];
        const isActive = space === active;
        const color = isActive ? 'var(--accent)' : 'var(--ink-faded)';

        return (
          <button
            key={space}
            className="flex flex-1 flex-col items-center justify-center gap-0.5 cursor-pointer"
            style={{ color, background: 'transparent', border: 'none' }}
            onClick={() => navigate(spaceToPath(space))}
          >
            <Icon size={22} strokeWidth={1.5} />
            <span className="text-2xs" style={{ color }}>
              {labels[space]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
