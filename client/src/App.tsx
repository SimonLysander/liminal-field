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
 *   - Display pages (home/note/gallery/agent) share MainLayout with the
 *     display Sidebar component.
 *   - Admin pages (/admin, /admin/edit/:id) are standalone — they have their
 *     own TreePanel sidebar and are code-split via React.lazy.
 */

import { lazy, Suspense, useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { LoadingState } from '@/components/LoadingState';
import { smoothBounce } from './lib/motion';
import { authApi } from '@/services/auth';
import { ErrorBoundary } from '@/components/ErrorBoundary';

import Sidebar from './components/global/Sidebar';
import Topbar from './components/global/Topbar';
import AgentPage from './pages/agent';
import GalleryPage from './pages/gallery';
import HomePage from './pages/home';
import NotePage from './pages/note';
import NotFoundPage from './pages/not-found';

const AdminShell = lazy(() => import('./pages/admin'));
const ContentAdmin = lazy(() => import('./pages/admin/content'));
const GalleryAdmin = lazy(() => import('./pages/admin/gallery'));
const GalleryEditPage = lazy(() => import('./pages/admin/gallery/edit'));
const DraftEditPage = lazy(() => import('./pages/admin/edit'));
const ImportPreviewPage = lazy(() => import('./pages/admin/import-preview'));
const LoginPage = lazy(() => import('./pages/login'));

/**
 * 管理端路由守卫——加载前检查登录态。
 * 首次检查结果缓存在模块作用域，避免每次路由切换都请求 /auth/check。
 */
let authChecked = false;
let isAuthenticated = false;

function AuthGuard({ children }: { children: React.ReactNode }) {
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

  return (
    <div data-layout-root className="relative z-[1] flex h-screen" style={{ background: 'var(--paper)' }}>
      {/* Sidebar — floating grey card; see Sidebar.tsx for styling details */}
      <Sidebar />

      {/* Main content — flat white, no card styling (left card / right flat pattern) */}
      <main
        className="relative z-0 flex flex-1 flex-col overflow-hidden"
      >
        <Topbar />

        <AnimatePresence mode="wait">
          {/* 打开具体文档时 key 变化触发入场动画，浏览目录时稳定 key 不做动画 */}
          <motion.div
            key={(() => {
              const doc = new URLSearchParams(location.search).get('doc');
              return doc ? `/note/${doc}` : '/note';
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
              <Route path="/gallery" element={<GalleryPage />} />
              <Route path="/agent" element={<AgentPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
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
          <Route path="gallery" element={<Suspense fallback={<LoadingState variant="full" />}><GalleryAdmin /></Suspense>} />
          <Route path="gallery/:id/edit" element={<Suspense fallback={<LoadingState variant="full" />}><GalleryEditPage /></Suspense>} />
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
          path="/admin/notes/import-preview"
          element={
            <AuthGuard>
              <Suspense fallback={<LoadingState variant="full" />}>
                <ImportPreviewPage />
              </Suspense>
            </AuthGuard>
          }
        />
        <Route path="/*" element={<MainLayout />} />
      </Routes>
      {/* 全局 toast 容器——样式对齐设计系统 token */}
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'var(--shelf)',
            color: 'var(--ink)',
            border: '0.5px solid var(--separator)',
            borderRadius: 'var(--radius-md)',
          },
        }}
      />
    </ErrorBoundary>
  );
}

export default App;
