// Vitest 全局 setup:引入 @testing-library/jest-dom 的断言扩展(toBeInTheDocument 等),
// 供未来组件测试使用。happy-dom 环境每个测试文件独立,localStorage 自动隔离。
import '@testing-library/jest-dom/vitest';

// KaTeX checks document.compatMode. happy-dom starts in quirks mode and cannot
// switch modes after construction, so make the browser test document explicit.
if (typeof document !== 'undefined') {
  Object.defineProperty(document, 'compatMode', {
    configurable: true,
    value: 'CSS1Compat',
  });
}
