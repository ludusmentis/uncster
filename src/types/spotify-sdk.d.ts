/**
 * Ambient type declarations for the Spotify Web Playback SDK
 * (https://sdk.scdn.co/spotify-player.js), loaded dynamically at runtime
 * via src/playback/sdkLoader.ts.
 */

declare global {
  /** Callback the SDK invokes once the script has finished loading. */
  var onSpotifyWebPlaybackSDKReady: (() => void) | undefined;

  interface Window {
    Spotify?: SpotifySdk;
    onSpotifyWebPlaybackSDKReady?: () => void;
  }

  /** The global object exported by the SDK script (window.Spotify). */
  type SpotifySdk = {
    Player: new (options: Spotify.PlayerInitOptions) => Spotify.Player;
  };

  namespace Spotify {
    /** Playback state snapshot delivered via 'player_state_changed'. */
    interface WebPlaybackState {
      context: {
        uri: string | null;
        metadata: Record<string, unknown>;
      };
      disallows: Record<string, boolean>;
      paused: boolean;
      position: number;
      duration: number;
      track_window: {
        current_track: WebPlaybackTrack;
        previous_tracks: WebPlaybackTrack[];
        next_tracks: WebPlaybackTrack[];
      };
    }

    interface WebPlaybackTrack {
      uri: string;
      /** Present when Spotify relinked playback to a regional/availability
       * variant: points back to the original track URI. */
      linked_from?: { uri: string } | null;
      id: string | null;
      type: string;
      media_type: string;
      name: string;
      is_local: boolean;
      album: WebPlaybackAlbum;
      artists: WebPlaybackArtist[];
    }

    interface WebPlaybackAlbum {
      uri: string;
      name: string;
      images: { url: string }[];
    }

    interface WebPlaybackArtist {
      uri: string;
      name: string;
    }

    interface WebPlaybackError {
      message: string;
    }

    type ErrorTypes =
      | 'initialization_error'
      | 'authentication_error'
      | 'account_error'
      | 'playback_error';

    interface PlayerInitOptions {
      name: string;
      getOAuthToken: (cb: (token: string) => void) => void;
      volume?: number;
    }

    interface Player {
      connect(): Promise<boolean>;
      disconnect(): void;
      addListener(event: ErrorTypes, listener: (e: WebPlaybackError) => void): boolean;
      addListener(
        event: 'ready' | 'not_ready',
        listener: (e: { device_id: string }) => void
      ): boolean;
      addListener(
        event: 'player_state_changed',
        listener: (state: WebPlaybackState) => void
      ): boolean;
      addListener(event: string, listener: (payload: never) => void): boolean;
      removeListener(event: string, listener?: unknown): boolean;
      /** Must be triggered by a user gesture to satisfy autoplay policies. */
      activateElement(): void;
      setName(name: string): Promise<void>;
      setVolume(volume: number): Promise<void>;
      pause(): Promise<void>;
      resume(): Promise<void>;
      togglePlay(): Promise<void>;
      seek(ms: number): Promise<void>;
      getCurrentState(): Promise<WebPlaybackState | null>;
      getVolume(): Promise<number>;
    }
  }
}

export {};
