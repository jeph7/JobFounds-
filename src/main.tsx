import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Proactively refresh any outdated PWA Service Worker so live deployments appear immediately
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  let reloadingForSwUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForSwUpdate) return;
    reloadingForSwUpdate = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        regs.forEach((reg) => {
          reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
