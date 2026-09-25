/* eslint-disable @typescript-eslint/no-explicit-any */
import { HomeAssistant } from 'custom-card-helpers';

export interface MusicItem {
  name: string;
  // What to ask Alexa to play, e.g. "Love Story by Taylor Swift"
  query: string;
  provider?: string;
  subtitle?: string;
  image?: string;
}

export interface MusicLibrary {
  favorites: MusicItem[];
  recent: MusicItem[];
}

// Stored in the Home Assistant user's frontend data so every dashboard and device shares it
const STORAGE_KEY = 'alexa_music_player';
const MAX_RECENT = 25;

export const emptyLibrary = (): MusicLibrary => ({ favorites: [], recent: [] });

export const sameItem = (a: MusicItem, b: MusicItem): boolean => a.query.toLowerCase() === b.query.toLowerCase();

export const loadLibrary = async (hass: HomeAssistant): Promise<MusicLibrary> => {
  try {
    const result: any = await hass.connection.sendMessagePromise({ type: 'frontend/get_user_data', key: STORAGE_KEY });
    if (result?.value) {
      return { ...emptyLibrary(), ...result.value };
    }
  } catch (err) {
    // Fall back to this browser's copy below
  }
  try {
    const local = window.localStorage.getItem(STORAGE_KEY);
    return local ? { ...emptyLibrary(), ...JSON.parse(local) } : emptyLibrary();
  } catch (err) {
    return emptyLibrary();
  }
};

export const saveLibrary = async (hass: HomeAssistant, library: MusicLibrary): Promise<void> => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  } catch (err) {
    // Storage can be unavailable (private windows); the Home Assistant copy still saves
  }
  try {
    await hass.connection.sendMessagePromise({ type: 'frontend/set_user_data', key: STORAGE_KEY, value: library });
  } catch (err) {
    // Older Home Assistant versions without user data keep only the browser copy
  }
};

export const addRecent = (library: MusicLibrary, item: MusicItem): MusicLibrary => ({
  ...library,
  recent: [item, ...library.recent.filter(existing => !sameItem(existing, item))].slice(0, MAX_RECENT),
});

export const toggleFavorite = (library: MusicLibrary, item: MusicItem): MusicLibrary => ({
  ...library,
  favorites: library.favorites.some(existing => sameItem(existing, item))
    ? library.favorites.filter(existing => !sameItem(existing, item))
    : [item, ...library.favorites],
});

// What the list card needs from the player card on the same dashboard
export interface MusicPlayer {
  readonly speakerName?: string;
  readonly unavailable: boolean;
  readonly presets: MusicItem[];
  playMusic(query: string, provider?: string, item?: MusicItem): Promise<void>;
}

// One shared copy of the library and the current player, so the player and list cards stay in sync
class MusicStore {
  public library: MusicLibrary = emptyLibrary();

  public loaded = false;

  public player?: MusicPlayer;

  private _loading?: Promise<void>;

  private _hass?: HomeAssistant;

  private _saveTimer?: number;

  private _listeners = new Set<() => void>();

  public load(hass: HomeAssistant): Promise<void> {
    this._hass = hass;
    if (!this._loading) {
      this._loading = loadLibrary(hass).then(library => {
        this.library = library;
        this.loaded = true;
        this.notify();
      });
    }
    return this._loading;
  }

  public update(library: MusicLibrary): void {
    this.library = library;
    this.notify();
    clearTimeout(this._saveTimer);
    this._saveTimer = window.setTimeout(() => this._hass && saveLibrary(this._hass, this.library), 1000);
  }

  public setPlayer(player?: MusicPlayer): void {
    this.player = player;
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this._listeners.add(listener);
    return (): void => {
      this._listeners.delete(listener);
    };
  }

  public notify(): void {
    this._listeners.forEach(listener => listener());
  }
}

export const musicStore = new MusicStore();
