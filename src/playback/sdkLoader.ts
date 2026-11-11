/**
 * Idempotent loader for the Spotify Web Playback SDK.
 *
 * Injects https://sdk.scdn.co/spotify-player.js exactly once per page load and
 * resolves with the global `Spotify` namespace once the SDK reports readiness
 * via `window.onSpotifyWebPlaybackSDKReady`.
 */

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

/** Module-level promise cache: guarantees a single <script> injection. */
let sdkPromise: Promise<SpotifySdk> | null = null;

function injectScript(): Promise<SpotifySdk> {
  return new Promise<SpotifySdk>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('loadSpotifySdk requires a browser environment'));
      return;
    }

    // The SDK calls this global once it has finished initializing.
    window.onSpotifyWebPlaybackSDKReady = () => {
      if (window.Spotify) {
        resolve(window.Spotify);
      } else {
        reject(new Error('Spotify SDK reported ready but window.Spotify is missing'));
      }
    };

    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => {
      // Allow a future retry instead of caching a dead promise forever.
      sdkPromise = null;
      delete window.onSpotifyWebPlaybackSDKReady;
      reject(new Error(`Failed to load Spotify SDK from ${SDK_URL}`));
    };
    document.head.appendChild(script);
  });
}

/**
 * Load the Spotify Web Playback SDK, returning the global `Spotify` namespace.
 * Concurrent and repeat calls share a single script injection and promise.
 */
export function loadSpotifySdk(): Promise<SpotifySdk> {
  if (!sdkPromise) {
    sdkPromise = injectScript();
  }
  return sdkPromise;
}
