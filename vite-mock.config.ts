/**
 * UAT mock harness config (M003 / S03-3) — wraps vite.config.ts and injects
 * the fetch-mock setup script (mock/uat-mock-setup.ts) as the first module
 * script in index.html so it executes before the app entry. Run with:
 *
 *   npx vite --config vite-mock.config.ts
 *
 * Used only for browser UAT screenshots with mocked Spotify data; never for
 * real dev (the real config stays untouched) and never imported by tests.
 */
import { fileURLToPath } from 'node:url';
import baseConfig from './vite.config';
import { defineConfig, mergeConfig, type Plugin } from 'vite';

const injectMockSetup = (): Plugin => ({
  name: 'uat-mock-setup-injector',
  apply: 'serve',
  transformIndexHtml(html: string): string {
    return html.replace(
      '<script type="module" src="/src/main.tsx"></script>',
      '<script type="module" src="/mock/uat-mock-setup.ts"></script>\n' +
        '<script type="module" src="/src/main.tsx"></script>',
    );
  },
});

export default defineConfig(
  mergeConfig(baseConfig, {
    plugins: [injectMockSetup()],
    resolve: {
      alias: {
        '/mock/uat-mock-setup.ts': fileURLToPath(
          new URL('./mock/uat-mock-setup.ts', import.meta.url),
        ),
      },
    },
  }),
);
