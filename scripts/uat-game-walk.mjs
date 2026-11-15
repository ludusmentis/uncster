/**
 * Mock-harness game walk (M007 / S02, T05) — full silent-audio UAT game
 * under the P007 vite-mock harness, following the scripts/uat-assert.mjs
 * CDP pattern. `node scripts/uat-assert.mjs` (default mode) runs this.
 *
 * The walk plays four complete games against real UI flows (setup -> start
 * -> /game), with zero audio:
 *
 * Game 1 — deterministic fail-then-win on the pl-quick fixture
 * (2 tracks, 1990 and 2020):
 *   - single player, songsToWin 2; the start card's year is read from the
 *     DOM, which identifies the hidden song (the other track, since
 *     drawNext skips owned cards in a 2-card deck), so the walk can force a
 *     deliberately WRONG drop and verify the fail overlay (correct
 *     position + actual year revealed, song NOT joining the list), then a
 *     correct drop on the next turn for the success overlay and the win.
 *   - Also asserts the ? box is metadata-free in the DOM and pulsates.
 *
 * Game 2 — rotation + winner removal on the pl-1995 fixture
 * (all tracks 1995, same-year ties are always correct):
 *   - two players, songsToWin 1; after player 1 wins, Continue must rotate
 *     to player 2 (winner removed from rotation), then the game ends with
 *     two winners.
 *
 * Game 4 (S05-T03) — full multi-player closure on the pl-quick fixture:
 *   - two players, songsToWin 2; a deliberate wrong drop (fail overlay),
 *     a mid-game hard refresh-resume on Bo's awaiting-drop turn (identical
 *     hidden song + snapshot), rotation until the last player (Ada) wins,
 *     landing on the PodiumSummary finale: every player's full revealed
 *     chronology in win order, Play again -> /setup/<id>, Back to playlist
 *     -> /playlist/<id>, and zero live api.spotify.com requests.
 *
 * Requires the vite-mock dev server on 127.0.0.1:3000 and the gsd
 * chrome-for-testing browser (found via its CDP socket), like uat-assert.
 */

const WAIT_MS = 4000;

export async function runGameWalk({ page, check, BASE }) {
  const requests = [];
  page.on('request', (r) => {
    // Only the app's own (main-frame) requests count: the Spotify Web
    // Playback SDK's internal iframes issue their own api.spotify.com
    // telemetry (e.g. /v1/melody/v1/check_scope) that no window.fetch
    // patch can intercept. The P007 zero-live guarantee covers the app's
    // fetches, which the mock fully satisfies.
    if (r.frame() === page.mainFrame()) requests.push(r.url());
  });

  await page.setViewportSize({ width: 1280, height: 800 });

  // Fresh game + setup state (never touch the seeded auth tokens).
  // The walk may start on about:blank, where localStorage access is
  // denied — get onto the app origin first (this also satisfies the
  // harness's own CDP page-lookup, which needs a 127.0.0.1:3000 page).
  const clearGameState = async () => {
    if (!page.url().startsWith(BASE)) {
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    }
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('harlequin.game.') || k.startsWith('harlequin.setup.')) {
          localStorage.removeItem(k);
        }
      }
    });
  };

  /** Drive the real setup surface: roster, win condition, Start Game. */
  const startGame = async (playlistId, players, songsToWin) => {
    await clearGameState();
    // Full page load resets the module-slot take-once caches in Game.tsx /
    // useGameEngine.ts so the pending GameConfig handoff starts clean.
    await page.goto(`${BASE}/setup/${playlistId}`, { waitUntil: 'networkidle' });
    for (const name of players) {
      await page.fill('#player-name', name);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await page.fill('#songs-to-win', String(songsToWin));
    await page.locator('.btn-primary').click();
    await page.waitForSelector('.game-drag-handle', { timeout: WAIT_MS });
  };

  /**
   * Pointer-based drag of the ? box onto insertion gap `index`
   * (data-drop-index). Returns whether the visible drop-target feedback
   * (.drop-target-active) was present mid-drag.
   */
  const dragHiddenTo = async (index) => {
    const from = await page.locator('.game-drag-handle').boundingBox();
    const gap = await page.locator(`[data-drop-index="${index}"]`).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(gap.x + gap.width / 2, gap.y + gap.height / 2, { steps: 4 });
    const feedback = await page.evaluate(
      () => !!document.querySelector('.drop-target-active'),
    );
    await page.mouse.up();
    await page.waitForSelector('[role="alertdialog"]', { timeout: WAIT_MS });
    return feedback;
  };

  const overlayState = () =>
    page.evaluate(() => {
      const dialog = document.querySelector('[role="alertdialog"]');
      return {
        heading: dialog?.querySelector('.turn-result-heading')?.textContent?.trim(),
        title: dialog?.querySelector('.turn-result-title')?.textContent?.trim(),
        year: dialog?.querySelector('.turn-result-year')?.textContent?.trim(),
        hint: dialog?.querySelector('.turn-result-hint')?.textContent?.trim(),
        rows: document.querySelectorAll('.game-list-row').length,
      };
    });

  const clickContinue = async (waitForGameOver = false) => {
    await page.locator('.turn-result-overlay .btn').click();
    if (waitForGameOver) {
      await page.waitForSelector('[data-testid="game-over-winners"]', { timeout: WAIT_MS });
    } else {
      await page.waitForSelector('[role="alertdialog"]', { state: 'hidden', timeout: WAIT_MS });
      await page.waitForSelector('.game-drag-handle', { timeout: WAIT_MS });
    }
  };

  const turnPlayerName = () =>
    page.evaluate(() => document.querySelector('.game-player-name')?.textContent?.trim());

  // ---- Game 1: pl-quick, single player, songsToWin 2 ----
  await startGame('pl-quick', ['Solo'], 2);

  let board = await page.evaluate(() => ({
    heading: document.querySelector('.game-player-name')?.textContent?.trim(),
    rows: document.querySelectorAll('.game-list-row').length,
    startYear: document.querySelector('.game-list-row .track-year')?.textContent?.trim(),
    hiddenHtml: document.querySelector('.game-hidden-slot')?.outerHTML ?? '',
    hiddenText: document.querySelector('.game-hidden-slot')?.textContent?.trim(),
    hiddenId: document.querySelector('.game-hidden-slot')?.getAttribute('data-hidden-id'),
    pulse: getComputedStyle(document.querySelector('.game-hidden-slot')).animationName,
  }));
  check('G1 turn 1: current player heading + start card row',
    board.heading === "Solo's turn" && board.rows === 1 && Boolean(board.startYear),
    JSON.stringify({ heading: board.heading, rows: board.rows, startYear: board.startYear }));
  check('G1 turn 1: ? box pulsates with an opaque handle id',
    board.pulse === 'game-pulse' && Boolean(board.hiddenId) && board.hiddenText === '?',
    `pulse=${board.pulse} id=${board.hiddenId} text=${board.hiddenText}`);
  check('G1 turn 1: ? box carries ZERO song metadata in the DOM',
    !board.hiddenHtml.includes('Retro') && !board.hiddenHtml.includes('Future')
      && !board.hiddenHtml.includes('1990') && !board.hiddenHtml.includes('2020'),
    board.hiddenHtml);

  // Identify the hidden song from the start card's year (2-card deck:
  // hidden = the one other track; drawNext skips owned cards).
  const startIs1990 = board.startYear === '1990';
  const hiddenYear = startIs1990 ? '2020' : '1990';
  const hiddenName = startIs1990 ? 'Future Bop' : 'Retro Rodge';
  const wrongIndex = startIs1990 ? 0 : 1; // before the older / after the newer
  const correctIndex = startIs1990 ? 1 : 0;
  const correctPosHuman = String(correctIndex + 1);

  // Deliberately wrong drop -> fail overlay with reveals.
  const feedback1 = await dragHiddenTo(wrongIndex);
  let overlay = await overlayState();
  check('G1 wrong drop: visible drop-target feedback during drag', feedback1 === true);
  check('G1 wrong drop: fail overlay (Wrong!) reveals song + year',
    overlay.heading === 'Wrong!' && overlay.title === hiddenName && overlay.year === hiddenYear,
    JSON.stringify(overlay));
  check('G1 wrong drop: fail overlay reveals the correct position',
    overlay.hint === `It should have gone at position ${correctPosHuman}.`,
    overlay.hint ?? 'no hint');
  check('G1 wrong drop: song is lost (list still 1 row)', overlay.rows === 1,
    `rows=${overlay.rows}`);
  await clickContinue();

  // Second turn: same hidden song (only other unowned card) — correct drop.
  const heading2 = await turnPlayerName();
  check('G1 turn 2: rotation stays on the same (only) player',
    heading2 === "Solo's turn", heading2);
  await dragHiddenTo(correctIndex);
  overlay = await overlayState();
  check('G1 correct drop: success overlay (Correct!) reveals song + year',
    overlay.heading === 'Correct!' && overlay.title === hiddenName && overlay.year === hiddenYear,
    JSON.stringify(overlay));
  check('G1 correct drop: song joined the list behind the overlay',
    overlay.rows === 2, `rows=${overlay.rows}`);
  await clickContinue(true);
  const over = await page.evaluate(() => ({
    heading: document.querySelector('h2')?.textContent?.trim(),
    winners: document.querySelectorAll('[data-testid="game-over-winners"] li').length,
  }));
  check('G1 game over after single-player win: 1 winner',
    over.heading === 'Game over' && over.winners === 1, JSON.stringify(over));

  // ---- Game 2: pl-1995, two players, songsToWin 1 (rotation + removal) ----
  await startGame('pl-1995', ['Ada', 'Bo'], 1);
  const adaHeading = await turnPlayerName();
  check('G2 turn 1: starts on Ada', adaHeading === "Ada's turn", adaHeading);

  await dragHiddenTo(1); // same-year ties: any index is chronologically correct
  overlay = await overlayState();
  check('G2 Ada correct drop shows success overlay', overlay.heading === 'Correct!',
    JSON.stringify(overlay));
  await clickContinue(); // Ada won (1 song... 2 after drop) -> removed from rotation
  const boHeading = await turnPlayerName();
  check('G2 Continue rotates to Bo (winner removed from rotation)',
    boHeading === "Bo's turn", boHeading);

  await dragHiddenTo(1);
  overlay = await overlayState();
  check('G2 Bo correct drop shows success overlay', overlay.heading === 'Correct!',
    JSON.stringify(overlay));
  await clickContinue(true);
  const over2 = await page.evaluate(() => ({
    heading: document.querySelector('h2')?.textContent?.trim(),
    winners: document.querySelectorAll('[data-testid="game-over-winners"] li').length,
  }));
  check('G2 game over with both winners removed: 2 winners',
    over2.heading === 'Game over' && over2.winners === 2, JSON.stringify(over2));

  // ---- Game 3 (S03-T03): mid-game hard-refresh resume of bare /game ----
  // Multi-player game on pl-1995 (all-1995 ties → every drop correct),
  // one song placed, then a hard reload of bare /game must reopen the
  // SAME player's turn with the SAME hidden song (? box at position 1,
  // zero song metadata in the DOM), the identical persisted snapshot
  // (lists + deck), and rotation must keep working after the resume.
  await startGame('pl-1995', ['Ada', 'Bo', 'Cy'], 5);
  check('G3 turn 1: starts on Ada', (await turnPlayerName()) === "Ada's turn",
    await turnPlayerName());
  await dragHiddenTo(1); // Ada places one song
  let overlay3 = await overlayState();
  check('G3 Ada drop shows success overlay', overlay3.heading === 'Correct!',
    JSON.stringify(overlay3));
  await clickContinue(); // rotate to Bo — awaiting-drop with hidden song drawn
  const preReload = await page.evaluate(() => ({
    heading: document.querySelector('.game-player-name')?.textContent?.trim(),
    hiddenId: document.querySelector('.game-hidden-slot')?.getAttribute('data-hidden-id'),
    hiddenHtml: document.querySelector('.game-hidden-slot')?.outerHTML ?? '',
    rows: [...document.querySelectorAll('.game-list-row')].map((r) => r.textContent),
    activePointer: localStorage.getItem('harlequin.game.active'),
    snapshot: localStorage.getItem(`harlequin.game.${localStorage.getItem('harlequin.game.active')}`),
  }));
  check('G3 pre-reload: Ada placed one song and rotation reached Bo',
    preReload.heading === "Bo's turn" && preReload.rows.length === 1,
    JSON.stringify({ heading: preReload.heading, rows: preReload.rows }));
  check('G3 pre-reload: active-game pointer + snapshot persisted',
    Boolean(preReload.activePointer) && Boolean(preReload.snapshot),
    `pointer=${preReload.activePointer}`);

  // Hard reload of the bare /game route (full page load resets the
  // module-slot take-once caches — exactly the refresh-resume path).
  await page.goto(`${BASE}/game`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.game-drag-handle', { timeout: WAIT_MS });
  const postReload = await page.evaluate(() => ({
    heading: document.querySelector('.game-player-name')?.textContent?.trim(),
    hiddenId: document.querySelector('.game-hidden-slot')?.getAttribute('data-hidden-id'),
    hiddenHtml: document.querySelector('.game-hidden-slot')?.outerHTML ?? '',
    hiddenText: document.querySelector('.game-hidden-slot')?.textContent?.trim(),
    rows: [...document.querySelectorAll('.game-list-row')].map((r) => r.textContent),
    snapshot: localStorage.getItem(`harlequin.game.${localStorage.getItem('harlequin.game.active')}`),
  }));
  check('G3 resume: same player\'s turn reopens (Bo)',
    postReload.heading === "Bo's turn" && postReload.heading === preReload.heading,
    JSON.stringify({ heading: postReload.heading }));
  check('G3 resume: identical hidden song (opaque handle id unchanged)',
    Boolean(postReload.hiddenId) && postReload.hiddenId === preReload.hiddenId,
    `pre=${preReload.hiddenId} post=${postReload.hiddenId}`);
  check('G3 resume: ? box at position 1, metadata-free in the DOM',
    postReload.hiddenText === '?' &&
      !postReload.hiddenHtml.includes('One Hit') &&
      !postReload.hiddenHtml.includes('1995') &&
      !postReload.hiddenHtml.includes('The '),
    postReload.hiddenHtml);
  check('G3 resume: identical player list (same rows in same order)',
    JSON.stringify(postReload.rows) === JSON.stringify(preReload.rows),
    JSON.stringify({ pre: preReload.rows, post: postReload.rows }));
  check('G3 resume: identical persisted snapshot (deck + lists + hidden song)',
    postReload.snapshot === preReload.snapshot && Boolean(postReload.snapshot),
    preReload.snapshot === postReload.snapshot ? 'byte-identical' : 'SNAPSHOT DRIFTED');
  await dragHiddenTo(1); // Bo's turn continues: drop still works after resume
  overlay3 = await overlayState();
  check('G3 resume: post-resume drop is judged (Bo success overlay)',
    overlay3.heading === 'Correct!' && overlay3.rows === 2,
    JSON.stringify(overlay3));
  await clickContinue();
  check('G3 rotation after resume: Continue advances to Cy',
    (await turnPlayerName()) === "Cy's turn", await turnPlayerName());

  // ---- Game 4 (S05-T03): full multi-player closure game ----
  // Two players on pl-quick, songsToWin 2, combining every S05 element:
  // a deliberate wrong drop (Ada), rotation to Bo, a mid-game hard
  // refresh-resume on Bo's awaiting-drop turn, then rotation until the
  // last player (Ada) wins — landing on the PodiumSummary finale with
  // both exit options exercised through the real setup/playlist routes.
  // Deterministic on the 2-card deck: every player's start card is the
  // deck's first card (year read from the DOM) and the hidden song is
  // always the other track (drawNext skips owned cards).
  await startGame('pl-quick', ['Ada', 'Bo'], 2);
  const g4Start = await page.evaluate(() => ({
    heading: document.querySelector('.game-player-name')?.textContent?.trim(),
    rows: document.querySelectorAll('.game-list-row').length,
    startYear: document.querySelector('.game-list-row .track-year')?.textContent?.trim(),
  }));
  check('G4 turn 1: Ada starts with her start card dealt',
    g4Start.heading === "Ada's turn" && g4Start.rows === 1 && Boolean(g4Start.startYear),
    JSON.stringify(g4Start));
  const g4StartIs1990 = g4Start.startYear === '1990';
  const g4HiddenName = g4StartIs1990 ? 'Future Bop' : 'Retro Rodge';
  const g4HiddenYear = g4StartIs1990 ? '2020' : '1990';
  const g4StartName = g4StartIs1990 ? 'Retro Rodge' : 'Future Bop';
  const g4WrongIndex = g4StartIs1990 ? 0 : 1; // before the older / after the newer
  const g4CorrectIndex = g4StartIs1990 ? 1 : 0;

  // (1) Deliberate wrong drop: fail overlay, song lost, Ada stays active.
  const feedback4 = await dragHiddenTo(g4WrongIndex);
  let overlay4 = await overlayState();
  check('G4 wrong drop: visible drop-target feedback + fail overlay reveals song + year',
    feedback4 === true && overlay4.heading === 'Wrong!'
      && overlay4.title === g4HiddenName && overlay4.year === g4HiddenYear,
    JSON.stringify(overlay4));
  check('G4 wrong drop: Ada loses the song (list still 1 row)',
    overlay4.rows === 1, `rows=${overlay4.rows}`);
  await clickContinue(); // no win -> rotation advances to Bo
  check('G4 rotation after fail: Continue advances to Bo',
    (await turnPlayerName()) === "Bo's turn", await turnPlayerName());

  // (2) Mid-game hard refresh-resume on Bo's awaiting-drop turn.
  const preReload4 = await page.evaluate(() => ({
    heading: document.querySelector('.game-player-name')?.textContent?.trim(),
    hiddenId: document.querySelector('.game-hidden-slot')?.getAttribute('data-hidden-id'),
    rows: [...document.querySelectorAll('.game-list-row')].map((r) => r.textContent),
    snapshot: localStorage.getItem(`harlequin.game.${localStorage.getItem('harlequin.game.active')}`),
  }));
  check('G4 pre-reload: Bo awaiting drop with persisted snapshot',
    preReload4.heading === "Bo's turn" && Boolean(preReload4.hiddenId)
      && Boolean(preReload4.snapshot),
    JSON.stringify({ heading: preReload4.heading, rows: preReload4.rows }));
  await page.goto(`${BASE}/game`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.game-drag-handle', { timeout: WAIT_MS });
  const postReload4 = await page.evaluate(() => ({
    heading: document.querySelector('.game-player-name')?.textContent?.trim(),
    hiddenId: document.querySelector('.game-hidden-slot')?.getAttribute('data-hidden-id'),
    rows: [...document.querySelectorAll('.game-list-row')].map((r) => r.textContent),
    snapshot: localStorage.getItem(`harlequin.game.${localStorage.getItem('harlequin.game.active')}`),
  }));
  check('G4 resume: same player (Bo), identical hidden song + list + snapshot',
    postReload4.heading === preReload4.heading
      && postReload4.hiddenId === preReload4.hiddenId
      && JSON.stringify(postReload4.rows) === JSON.stringify(preReload4.rows)
      && postReload4.snapshot === preReload4.snapshot,
    postReload4.snapshot === preReload4.snapshot ? 'byte-identical' : 'SNAPSHOT DRIFTED');

  // (3) Bo wins (start card + correct drop = 2 songs), rotation continues
  // to the last active player (Ada), Ada wins -> game over -> podium.
  await dragHiddenTo(g4CorrectIndex);
  overlay4 = await overlayState();
  check('G4 Bo correct drop: success overlay + song joined (rows 2)',
    overlay4.heading === 'Correct!' && overlay4.rows === 2, JSON.stringify(overlay4));
  await clickContinue(); // Bo reached songsToWin -> winner, removed from rotation
  check('G4 winner removed from rotation: Continue advances to Ada (last player)',
    (await turnPlayerName()) === "Ada's turn", await turnPlayerName());
  await dragHiddenTo(g4CorrectIndex);
  overlay4 = await overlayState();
  check('G4 Ada correct drop: success overlay (last player, rows 2)',
    overlay4.heading === 'Correct!' && overlay4.rows === 2, JSON.stringify(overlay4));
  await clickContinue(true); // every player has won -> game over

  const podium = await page.evaluate(() => {
    const players = [...document.querySelectorAll('[data-testid="podium-player"]')];
    return {
      podium: Boolean(document.querySelector('[data-testid="podium"]')),
      heading: document.querySelector('[data-testid="podium"] h2')?.textContent?.trim(),
      winnerListCount: document.querySelectorAll('[data-testid="game-over-winners"] li').length,
      players: players.map((p) => ({
        rank: p.getAttribute('data-rank'),
        name: p.querySelector('.podium-player-title')?.textContent?.trim(),
        songs: [...p.querySelectorAll('[data-testid="podium-song"]')].map((s) => ({
          title: s.querySelector('.track-title')?.textContent?.trim(),
          year: s.querySelector('.track-year')?.textContent?.trim(),
        })),
      })),
    };
  });
  // Final chronology is always chronological: the correct drop inserts the
  // hidden song at its judged position, so both players end [1990, 2020]
  // regardless of which track was the start card (deck order flips per run).
  const expectedChronology = JSON.stringify([
    { title: 'Retro Rodge', year: '1990' },
    { title: 'Future Bop', year: '2020' },
  ]);
  check('G4 podium: game-over view renders the PodiumSummary testid + sr-only winners list',
    podium.podium === true && podium.heading === 'Game over' && podium.winnerListCount === 2,
    JSON.stringify(podium));
  check('G4 podium: every player ranked, win order first (Bo rank 1, Ada rank 2)',
    podium.players.length === 2
      && podium.players[0].rank === '1' && podium.players[0].name.startsWith('Bo')
      && podium.players[0].name.includes('winner!')
      && podium.players[1].rank === '2' && podium.players[1].name === 'Ada',
    JSON.stringify(podium.players.map((p) => ({ rank: p.rank, name: p.name }))));
  check('G4 podium: rank-1 winner (Bo) full revealed chronology',
    JSON.stringify(podium.players[0].songs) === expectedChronology,
    `${JSON.stringify(podium.players[0].songs)} vs ${expectedChronology}`);
  check('G4 podium: rank-2 player (Ada) full revealed chronology',
    JSON.stringify(podium.players[1].songs) === expectedChronology,
    `${JSON.stringify(podium.players[1].songs)} vs ${expectedChronology}`);

  // Option navigation through the real routes: Play again -> /setup/<id>.
  await page.locator('[data-testid="podium-play-again"]').click();
  await page.waitForSelector('#player-name', { timeout: WAIT_MS });
  check('G4 podium: Play again navigates to the setup route',
    page.url() === `${BASE}/setup/pl-quick`, page.url());

  // The setup surface the Play-again option lands on is fully playable:
  // a quick single-player game reaches the podium again, where the
  // Back-to-playlist option -> /playlist/<id> gets exercised.
  await startGame('pl-quick', ['Solo'], 2);
  const g4bStart = await page.evaluate(() => ({
    startYear: document.querySelector('.game-list-row .track-year')?.textContent?.trim(),
  }));
  await dragHiddenTo(g4bStart.startYear === '1990' ? 1 : 0);
  const overlay4b = await overlayState();
  check('G4b quick replay: Solo correct drop wins the game',
    overlay4b.heading === 'Correct!' && overlay4b.rows === 2, JSON.stringify(overlay4b));
  await clickContinue(true);
  await page.waitForSelector('[data-testid="podium-back-to-playlist"]', { timeout: WAIT_MS });
  await page.locator('[data-testid="podium-back-to-playlist"]').click();
  await page.waitForSelector('h1.neon-heading', { timeout: WAIT_MS });
  const playlistPage = await page.evaluate(() => ({
    heading: document.querySelector('h1.neon-heading')?.textContent?.trim(),
    url: location.href,
  }));
  check('G4 podium: Back to playlist navigates to the playlist route',
    playlistPage.url === `${BASE}/playlist/pl-quick`
      && playlistPage.heading === 'Playlist tracks',
    JSON.stringify(playlistPage));

  // ---- Network isolation across the whole walk ----
  const live = requests.filter((u) => u.includes('api.spotify.com'));
  check('zero live Spotify requests across the whole walk (all games)',
    live.length === 0,
    `${requests.length} requests observed, ${live.length} to api.spotify.com: ${live.join(' | ')}`);

  return true;
}
