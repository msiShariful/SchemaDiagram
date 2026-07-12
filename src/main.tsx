import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { useAppStore } from './app/store';
import './styles.css';

// Dev/E2E hook: Playwright specs (perf fixture injection) and the
// error-boundary walkthrough drive store state directly. import.meta.env.DEV
// is compile-time false in `vite build`, so this assignment is dead-code-
// eliminated from production bundles.
if (import.meta.env.DEV) {
  (window as unknown as { __appStore?: typeof useAppStore }).__appStore = useAppStore;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
