import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// npm run dev:phone（mode = phone）才開 HTTPS：手機瀏覽器規定 HTTPS 才能開鏡頭
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'phone' ? [basicSsl({ name: 'jumplens-dev' })] : [])],
  test: { include: ['tests/**/*.test.ts'] },
}));
