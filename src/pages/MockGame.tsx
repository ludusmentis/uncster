import { useState } from 'react';
import { navigate } from '../routing';
import { takePendingGameConfig } from '../game/setupStore';
import type { GameConfig } from '../game/setupLogic';

/**
 * Mocked game view (M004 / S03, T4) at /game: reads the pending GameConfig
 * from the shared module slot (D010 — no URL params) on mount and renders a
 * coming-soon summary; a bare /game with no pending config degrades to a
 * friendly "No game in progress" state. The take happens inside the
 * component body (guarded by a lazy useState initializer so it runs once
 * per mount), which keeps renderToString tests able to assert both states.
 */

// React 18 StrictMode double-invokes useState lazy initializers in dev.
// takePendingGameConfig() clears the module slot, so a naive initializer
// would take the config on the first invocation and get null on the
// second (React keeps the second). Guard with a module-level take-once
// cache: the first initializer invocation drains the slot and the cached
// value survives the StrictMode replay. A full page load resets modules,
// so a fresh visit to /game without a pending config still shows the
// empty state.
let lastTaken: { value: GameConfig | null } | null = null;

export default function MockGame(): JSX.Element {
  // Lazy initializer: takePendingGameConfig runs once per component mount,
  // clearing the shared-module slot exactly once (D010 handoff contract).
  const [config] = useState<GameConfig | null>(() => {
    if (lastTaken === null) {
      lastTaken = { value: takePendingGameConfig() };
    }
    return lastTaken.value;
  });

  if (!config) {
    return (
      <main className="page">
        <h1 className="neon-heading">No game in progress</h1>
        <p>Start a game from a playlist to see it here.</p>
        <p className="back-row">
          <button className="btn" onClick={() => navigate('/')}>
            ← Back home
          </button>
        </p>
      </main>
    );
  }

  return (
    <main className="page">
      <h1 className="neon-heading">Game starting…</h1>
      <p>
        Playlist:{' '}
        <strong>
          {config.playlistName} ({config.playlistId})
        </strong>
      </p>
      <p>
        Songs to win: <strong>{config.songsToWin}</strong>
      </p>
      <p>Players:</p>
      <ul>
        {config.players.map((player) => (
          <li key={player.id}>{player.name}</li>
        ))}
      </ul>
      <p className="back-row">
        <button className="btn" onClick={() => navigate('/')}>
          ← Back to playlists
        </button>
      </p>
    </main>
  );
}