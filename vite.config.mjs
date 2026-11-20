import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/app/lan-automation/',
  plugins: [react()],
  build: { outDir: 'build/web', license: true },
});
