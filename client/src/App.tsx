/*
 * App — Root layout & routing
 *
 * Layout architecture (Apple Books inspired):
 *   - LEFT:  Sidebar / TreePanel — floating grey card (sidebar-bg #F2F2F2),
 *            with margin + borderRadius + boxShadow to lift off the background.
 *   - RIGHT: Main content area — flat white surface (paper #FFFFFF), no card
 *            styling (no margin/borderRadius/boxShadow), so the content feels
 *            expansive against the compact navigation card.
 *   - Page background is white (--paper), matching the right side seamlessly.
 *
 * Route split:
 *   - Display pages (home/note/anthology/gallery) share MainLayout with the
 *     display Sidebar component.
 *   - Admin pages (/admin, /admin/edit/:id) are standalone — they have their
 *     own TreePanel sidebar and are code-split via React.lazy.
 */

import { lazy, Suspense, useState, useEffect, useLayoutEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { BannerContainer } from '@/components/ui/banner';
import { LoadingState } from '@/components/LoadingState';
import { smoothBounce } from './lib/motion';
import { authApi } from '@/services/auth';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { DesktopOnlyNotice } from '@/components/shared/DesktopOnlyNotice';

import Sidebar from './components/global/Sidebar';
import BottomTabBar from './components/global/BottomTabBar';
import AnthologyPage from './pages/anthology';
import GalleryPage from './pages/gallery';
import HomePage from './pages/home';
import NotePage from './pages/note';
import NotFoundPage from './pages/not-found';

const AdminShell = lazy(() => import('./pages/admin'));
const ContentAdmin = lazy(() => import('./pages/admin/content'));
const GalleryAdmin = lazy(() => import('./pages/admin/gallery'));
const GalleryEditPage = lazy(() => import('./pages/admin/gallery/edit'));
const AnthologyAdmin = lazy(() => import('./pages/admin/anthology'));
const DraftEditPage = lazy(() => import('./pages/admin/edit'));
const ImportPreviewPage = lazy(() => import('./pages/admin/import-preview'));
const BatchImportPage = lazy(() => import('./pages/admin/batch-import'));
const SettingsPage = lazy(() => import('./pages/admin/settings'));
// 智能采集事项详情页（/admin/digest/:id）
const DigestTopicDetailPage = lazy(
  () => import('./pages/admin/settings/DigestTopicDetail'),
);
const DigestPublicPage = lazy(() => import('./pages/digest'));
const DigestTopicPage = lazy(() => import('./pages/digest/topic'));
const DigestReportPage = lazy(() => import('./pages/digest/report'));
const LoginPage = lazy(() => import('./pages/login'));
// 设计工具:字体样板间(独立、免登录、无布局)
const FontSampleRoom = lazy(() => import('./pages/design/fonts'));

/**
 * 管理端路由守卫——加载前检查登录态。
 * 首次检查结果缓存在模块作用域，避免每次路由切换都请求 /auth/check。
 */
let authChecked = false;
let isAuthenticated = false;

function AuthGuard({ children }: { children: React.ReactNode }) {
  // 管理端 + 编辑器桌面优先:移动端统一拦截到提示页(不再走鉴权/渲染重布局)
  const isMobile = useIsMobile();
  const [status, setStatus] = useState<'checking' | 'ok' | 'redirect'>(
    authChecked ? (isAuthenticated ? 'ok' : 'redirect') : 'checking',
  );

  useEffect(() => {
    if (authChecked) return;
    authApi
      .check()
      .then((res) => {
        authChecked = true;
        isAuthenticated = res.authenticated;
        setStatus(res.authenticated ? 'ok' : 'redirect');
      })
      .catch(() => {
        authChecked = true;
        isAuthenticated = false;
        setStatus('redirect');
      });
  }, []);

  if (isMobile) return <DesktopOnlyNotice />;
  if (status === 'checking') return <LoadingState variant="full" />;
  if (status === 'redirect') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Logout 或 401 时重置鉴权缓存 */
export function resetAuth() {
  authChecked = false;
  isAuthenticated = false;
}

const pageVariants = {
  enter: { opacity: 0, y: 6 },
  center: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
};

function MainLayout() {
  const location = useLocation();

  // gallery 沉浸模式：基于路由同步切换，在 AnimatePresence 过渡前就生效
  const isGallery = location.pathname === '/gallery';
  useLayoutEffect(() => {
    document.body.classList.toggle('gallery-immersive', isGallery);
  }, [isGallery]);

  // overlay 只在过渡瞬间可见：渐入遮住白→透明闪帧，然后消失露出模糊背景
  const [showOverlay, setShowOverlay] = useState(false);
  useEffect(() => {
    if (!isGallery) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      setShowOverlay(true);
      timer = setTimeout(() => setShowOverlay(false), 600);
    });
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [isGallery]);

  return (
    // 移动端竖排([内容][底部 Tab]),桌面端横排([侧栏][内容])
    <div data-layout-root className="relative z-[1] flex h-screen flex-col md:flex-row" style={{ background: 'var(--paper)' }}>
      {/* Gallery 过渡遮罩：渐入盖住闪帧，0.6s 后消失露出高斯模糊 */}
      <motion.div
        animate={{ opacity: showOverlay ? 1 : 0 }}
        transition={{ duration: 0.4 }}
        style={{
          position: 'absolute', inset: 0, zIndex: 0,
          background: '#1c1c1e',
          pointerEvents: 'none',
        }}
      />
      {/* Sidebar — floating grey card; see Sidebar.tsx for styling details */}
      <Sidebar />

      {/* Main content — flat white, no card styling (left card / right flat pattern) */}
      <main
        className="relative z-0 flex flex-1 flex-col overflow-hidden"
      >
        {/* Topbar 删了 — 主题按钮统一到 Sidebar 底部, 全公开端无屏幕右上 fixed 按钮 */}

        <AnimatePresence mode="wait">
          {/* 打开具体文档时 key 变化触发入场动画，浏览目录时稳定 key 不做动画 */}
          <motion.div
            key={(() => {
              // ?node= 指向当前阅读的内容节点 id(叶子文档或主题正文均用同一 query)
              const node = new URLSearchParams(location.search).get('node');
              return node ? `/note/${node}` : '/note';
            })()}
            className="relative z-[1] flex flex-1 overflow-hidden"
            variants={pageVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.4, ease: smoothBounce }}
          >
            <Routes location={location}>
              <Route path="/home" element={<HomePage />} />
              <Route path="/note" element={<NotePage />} />
              <Route path="/anthology" element={<AnthologyPage />} />
              <Route path="/gallery" element={<GalleryPage />} />
              {/* 智能小应用 · 自动信息收集 — 公开端「简报」。
                  路由顺序：/:topicId/:reportId 必须在 /:topicId 之后，React Router 优先最先匹配。 */}
              <Route path="/digest" element={<DigestPublicPage />} />
              <Route path="/digest/:topicId" element={<DigestTopicPage />} />
              <Route path="/digest/:topicId/:reportId" element={<DigestReportPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>

      {/* 移动端底部导航(桌面端 md:hidden 自动隐藏) */}
      <BottomTabBar />
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ConfirmProvider>
      <Routes>
        <Route path="/" element={<Navigate to="/home" replace />} />
        <Route
          path="/login"
          element={
            <Suspense fallback={<LoadingState variant="full" />}>
              <LoginPage />
            </Suspense>
          }
        />
        <Route
          path="/admin"
          element={
            <AuthGuard>
              <Suspense fallback={<LoadingState variant="full" />}>
                <AdminShell />
              </Suspense>
            </AuthGuard>
          }
        >
          <Route index element={<Navigate to="/admin/notes" replace />} />
          <Route path="notes" element={<Suspense fallback={<LoadingState variant="full" />}><ContentAdmin /></Suspense>} />
          <Route path="anthology" element={<Suspense fallback={<LoadingState variant="full" />}><AnthologyAdmin /></Suspense>} />
          <Route path="gallery" element={<Suspense fallback={<LoadingState variant="full" />}><GalleryAdmin /></Suspense>} />
          <Route path="settings" element={<Navigate to="/admin/settings/owner" replace />} />
          <Route path="settings/:tab" element={<Suspense fallback={<LoadingState variant="full" />}><SettingsPage /></Suspense>} />
          {/* 智能采集已迁移到 settings sub-tab，老 URL redirect 防 404 */}
          <Route path="digest" element={<Navigate to="/admin/settings/digest" replace />} />
          <Route path="digest/sources" element={<Navigate to="/admin/settings/digest-sources" replace />} />
          {/* 事项详情页：/admin/digest/:id */}
          <Route
            path="digest/:id"
            element={
              <Suspense fallback={<LoadingState variant="full" />}>
                <DigestTopicDetailPage />
              </Suspense>
            }
          />
        </Route>
        <Route
          path="/admin/notes/:id/edit"
          element={
            <AuthGuard>
              <Suspense fallback={<LoadingState variant="full" />}>
                <DraftEditPage />
              </Suspense>
            </AuthGuard>
          }
        />
        <Route
          path="/admin/gallery/:id/edit"
          element={
            <AuthGuard>
              <Suspense fallback={<LoadingState variant="full" />}>
                <GalleryEditPage />
              </Suspense>
            </AuthGuard>
          }
        />
        <Route
          path="/admin/anthology/:id/edit"
          element={
            <AuthGuard>
              <Suspense fallback={<LoadingState variant="full" />}>
                <DraftEditPage />
              </Suspense>
            </AuthGuard>
          }
        />
        <Route
          path="/admin/notes/import-preview"
          element={
            <AuthGuard>
              <Suspense fallback={<LoadingState variant="full" />}>
                <ImportPreviewPage />
              </Suspense>
            </AuthGuard>
          }
        />
        <Route
          path="/admin/notes/batch-import"
          element={
            <AuthGuard>
              <Suspense fallback={<LoadingState variant="full" />}>
                <BatchImportPage />
              </Suspense>
            </AuthGuard>
          }
        />
        <Route
          path="/design/fonts"
          element={
            <Suspense fallback={<LoadingState variant="full" />}>
              <FontSampleRoom />
            </Suspense>
          }
        />
        <Route path="/*" element={<MainLayout />} />
      </Routes>
      </ConfirmProvider>
      <BannerContainer />
    </ErrorBoundary>
  );
}

export default App;
