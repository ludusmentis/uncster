import { describe, expect, it } from 'vitest';
import { SCOPES } from './spotifyAuth';

describe('SCOPES', () => {
  it('contains the original playlist scope', () => {
    expect(SCOPES).toContain('playlist-read-private');
  });

  it('contains all five playback/user scopes required by the Web Playback SDK (M005)', () => {
    expect(SCOPES).toContain('streaming');
    expect(SCOPES).toContain('user-read-email');
    expect(SCOPES).toContain('user-read-private');
    expect(SCOPES).toContain('user-modify-playback-state');
    expect(SCOPES).toContain('user-read-playback-state');
  });

  it('has no duplicates', () => {
    expect(new Set(SCOPES).size).toBe(SCOPES.length);
  });
});
