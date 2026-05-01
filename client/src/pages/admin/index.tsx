/*
 * AdminShell — 管理后台壳子
 *
 * 布局：IconRail (48px) + 子路由全高展开。
 * IconRail 和子页面的 TreePanel/PostList 共享 sidebar-bg 背景色，
 * 通过 separator 边线划分区域。无浮动卡片效果——admin 侧采用齐平
 * 全高面板，保证导航不被 Topbar 遮挡。
 * Topbar 由各子页面自行放置在内容区列顶部。
 */

import { Outlet } from 'react-router-dom';
import { IconRail } from './components/IconRail';

const AdminShell = () => {
  return (
    <div className="flex h-screen" style={{ background: 'var(--paper)' }}>
      {/* Left: IconRail — 全高，sidebar-bg，右侧 separator 与 TreePanel 分隔 */}
      <IconRail />

      {/* Right: 子路由全高展开（TreePanel + Topbar + Content） */}
      <div className="flex flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
};

export default AdminShell;
