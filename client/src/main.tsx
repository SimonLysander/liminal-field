import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import './index.css';

// Apply the persisted shell theme before React mounts so the room does not
// flash from an unrelated palette on initial load.
try {
  const stored = localStorage.getItem('liminal-theme');
  document.body.setAttribute(
    'data-theme',
    stored === 'daylight' || stored === 'midnight' ? stored : 'daylight',
  );
} catch {
  document.body.setAttribute('data-theme', 'daylight');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
