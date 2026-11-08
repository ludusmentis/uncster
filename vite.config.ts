import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server MUST listen on the exact host:port of the Spotify-registered
// redirect URI (http://127.0.0.1:3000). strictPort fails fast instead of
// silently moving to another port where Spotify auth would break.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
  },
});
