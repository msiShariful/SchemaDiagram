/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    // Unit tests only (src/**/*.test.ts). e2e/ is Playwright's domain
    // (*.spec.ts) and must never enter vitest: its specs import
    // '@playwright/test', whose test() registration throws outside a
    // Playwright run.
    include: ['src/**/*.test.ts'],
  },
});
