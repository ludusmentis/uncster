/**
 * UAT mock harness (M003 / S03-3) — dev-only, injected before the app entry
 * by vite-mock.config.ts (transformIndexHtml). Patches window.fetch so every
 * https://api.spotify.com request is answered with P006-shaped fixtures and
 * seeds a valid auth session in localStorage, letting the real app render
 * fully mocked views with ZERO live Spotify network calls.
 *
 * This file is never imported by app code or tests; only by the harness
 * vite config used for browser UAT screenshots.
 */

const IMG = (color: string, label: string): string =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="${color}"/><text x="150" y="160" font-size="40" fill="#ffffff" text-anchor="middle" font-family="sans-serif">${label}</text></svg>`,
  )}`;

const playlists = [
  {
    id: 'pl-1',
    name: 'Main Character Energy',
    images: [{ url: IMG('#b30059', 'M01'), height: 300, width: 300 }],
    tracks: { total: 42 },
    owner: { id: 'u1' },
  },
  {
    id: 'pl-2',
    name: 'Crying In The Club',
    images: [{ url: IMG('#1db954', 'M02'), height: 300, width: 300 }],
    tracks: { total: 17 },
    owner: { id: 'u1' },
  },
  {
    id: 'pl-3',
    name: 'Soft Launch Playlist',
    images: [{ url: IMG('#00e5ff', 'M03'), height: 300, width: 300 }],
    tracks: { total: 1 },
    owner: { id: 'u1' },
  },
  {
    id: 'pl-4',
    name: 'No Cover Art Fits My Vibe',
    images: [],
    tracks: { total: 8 },
    owner: { id: 'u1' },
  },
  {
    id: 'pl-5',
    name: 'Delulu Hits',
    images: [{ url: IMG('#ff1493', 'M05'), height: 300, width: 300 }],
    tracks: { total: 23 },
    owner: { id: 'u1' },
  },
  {
    id: 'pl-6',
    name: 'Gym Rotation',
    images: [{ url: IMG('#39ff14', 'M06'), height: 300, width: 300 }],
    tracks: { total: 64 },
    owner: { id: 'u1' },
  },
  {
    id: 'pl-empty',
    name: 'Mainly A Placeholder',
    images: [{ url: IMG('#808080', 'EMP'), height: 300, width: 300 }],
    tracks: { total: 0 },
    owner: { id: 'u1' },
  },
];

const tracksPage = {
  items: Array.from({ length: 12 }, (_, i) => ({
    item: {
      id: `t-${i + 1}`,
      name: `Neon Anthem ${i + 1}`,
      type: 'track',
      artists: [{ id: `a-${i}`, name: ['DJ Static', 'Vaporwave Vic', 'MC Lumen', 'Sine Wave'][i % 4] }],
      album: {
        name: `Album ${i + 1}`,
        release_date: `${2018 + (i % 7)}-03-01`,
        images: [{ url: IMG('#262626', `T${i + 1}`), height: 64, width: 64 }],
      },
    },
  })),
  next: null,
  total: 12,
  limit: 100,
  offset: 0,
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// UAT knobs (03-3-T3):
// - 'uat.slow' delays every mocked response ~2.5s so the shimmer skeleton
//   loading screens are visible for screenshots.
// - playlist 'pl-empty' has zero tracks so the refined empty states render.
const delay = localStorage.getItem('uat.slow') === '1' ? 2500 : 0;
// 'uat.noplaylists' returns an empty playlist page so the refined grid
// empty state is screenshotable.
const noPlaylists = localStorage.getItem('uat.noplaylists') === '1';
const slow = <T>(value: T): Promise<T> =>
  delay === 0
    ? Promise.resolve(value)
    : new Promise((resolve) => setTimeout(() => resolve(value), delay));

const originalFetch = window.fetch.bind(window);

window.fetch = ((
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const url = typeof input === 'string' ? input : String(input);
  if (url.startsWith('https://api.spotify.com/v1/me/playlists')) {
    if (noPlaylists) {
      return slow(jsonResponse({ items: [], next: null, total: 0, limit: 50, offset: 0 }));
    }
    return slow(jsonResponse({ items: playlists, next: null, total: playlists.length, limit: 50, offset: 0 }));
  }
  if (url.startsWith('https://api.spotify.com/v1/me')) {
    return Promise.resolve(jsonResponse({ id: 'u1', display_name: 'Mock User', product: 'premium' }));
  }
  if (/^https:\/\/api\.spotify\.com\/v1\/playlists\/[^/]+$/.test(url)) {
    // Game-setup UAT fixture (M004 / S03-T6): GET /v1/playlists/{id} must
    // answer with playlist metadata including tracks.total small enough
    // (10) that 2 players x 15 songs triggers the short-playlist warning.
    if (url.endsWith('/v1/playlists/pl-1')) {
      return slow(
        jsonResponse({
          id: 'pl-1',
          name: 'Mock Playlist One',
          tracks: { total: 10 },
        }),
      );
    }
    // Any other single-playlist GET is answered from the playlist array
    // so the harness never makes a live Spotify call (P007 zero-live
    // guarantee); unknown ids 404 like the API would.
    const plId = url.split('/v1/playlists/')[1] || '';
    const found = playlists.find((p) => p.id === plId);
    if (!found) {
      return slow(jsonResponse({ error: { status: 404, message: 'Playlist not found' } }, 404));
    }
    return slow(
      jsonResponse({
        id: found.id,
        name: found.name,
        tracks: { total: found.tracks.total },
      }),
    );
  }
  if (/^https:\/\/api\.spotify\.com\/v1\/playlists\/[^/]+\/items/.test(url)) {
    if (url.includes('/v1/playlists/pl-empty/items')) {
      return slow(jsonResponse({ items: [], next: null, total: 0, limit: 100, offset: 0 }));
    }
    return slow(jsonResponse(tracksPage));
  }
  return originalFetch(input as RequestInfo, init);
}) as typeof window.fetch;

// Seed a valid session (future expiry → no silent-refresh POST) per P006,
// unless 'uat.unauthed' asks for the signed-out Home CTA state.
if (localStorage.getItem('uat.unauthed') !== '1') {
localStorage.setItem(
  'harlequin.spotify.tokens.v2',
  JSON.stringify({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    expiresAt: Date.now() + 3600000,
    scope: 'user-read-private playlist-read-private',
  }),
);
}
