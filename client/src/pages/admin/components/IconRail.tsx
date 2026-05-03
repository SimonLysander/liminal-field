// src/pages/admin/components/IconRail.tsx

import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileText, Image, RefreshCw, LogOut } from 'lucide-react';
import { authApi } from '@/services/auth';
import { resetAuth } from '@/App';
import { SyncDialog } from './SyncDialog';

/*
 * IconRail — 48px 窄图标导航栏
 *
 * 全高齐平布局，与右侧 TreePanel/PostList 共享 sidebar-bg 背景色。
 * 右侧 separator 边线将其与相邻面板分隔。
 * 选中态：shelf 背景 + ink 图标色。未选中：ink-ghost 图标色。
 */

const NAV_ITEMS = [
  { path: '/admin/notes', icon: FileText, label: '笔记管理' },
  { path: '/admin/gallery', icon: Image, label: '画廊管理' },
] as const;

export function IconRail() {
  const location = useLocation();
  const navigate = useNavigate();
  const [syncOpen, setSyncOpen] = useState(false);

  /* 匹配当前路径到导航项（前缀匹配） */
  const activePath = NAV_ITEMS.find((item) =>
    location.pathname.startsWith(item.path),
  )?.path ?? NAV_ITEMS[0].path;

  /* 登出：先请求服务端，再清本地状态，跳转登录页 */
  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch {
      // 即使请求失败也执行本地清理
    }
    resetAuth();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <div
        className="flex shrink-0 flex-col items-center py-3 gap-1"
        style={{
          width: 48,
          background: 'var(--sidebar-bg)',
          borderRight: '0.5px solid var(--separator)',
        }}
      >
        {/* Logo */}
        <div
          className="mb-4 flex items-center justify-center rounded-lg"
          style={{
            width: 28,
            height: 28,
            background: 'var(--ink)',
            color: 'var(--accent-contrast)',
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
          }}
        >
          L
        </div>

        {/* Nav icons */}
        {NAV_ITEMS.map((item) => {
          const isActive = activePath === item.path;
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              className="flex items-center justify-center rounded-lg transition-colors duration-150"
              style={{
                width: 36,
                height: 36,
                background: isActive ? 'var(--shelf)' : 'transparent',
                color: isActive ? 'var(--ink)' : 'var(--ink-ghost)',
              }}
              title={item.label}
              onClick={() => navigate(item.path)}
            >
              <Icon size={18} strokeWidth={1.5} />
            </button>
          );
        })}

        {/* 底部操作区：sync + logout，push to bottom via mt-auto */}
        <div className="mt-auto flex flex-col items-center gap-1">
          <button
            onClick={() => setSyncOpen(true)}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--shelf)]"
            style={{ color: 'var(--ink-ghost)' }}
            title="同步到远程"
          >
            <RefreshCw size={15} strokeWidth={1.8} />
          </button>
          <button
            onClick={handleLogout}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-[var(--shelf)]"
            style={{ color: 'var(--ink-ghost)' }}
            title="退出登录"
          >
            <LogOut size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>

      {syncOpen && <SyncDialog onClose={() => setSyncOpen(false)} />}
    </>
  );
}
