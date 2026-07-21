import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { defineConfig } from 'vitest/config';

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 4399,
    host: true, // 0.0.0.0 — 局域网内其他设备（如同网段 Win 测 IME bug）能访问
    proxy: {
      '/api': 'http://localhost:4398',
    },
  },
  build: {
    // 阅读器已移除交互 Plate runtime；当前最大的按需 chunk 约 720 KB。
    // 800 KB 留出合理增长余量，同时能尽早暴露新的重量级依赖。
    chunkSizeWarningLimit: 800,
  },
  // 前端单测:happy-dom 提供 DOM + localStorage(比 jsdom 轻、无 tldts 依赖坑);
  // globals 让 describe/it/expect 免 import。复用上面的 @ 别名。
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
