/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  mdiClose,
  mdiMagnify,
  mdiMusic,
  mdiPause,
  mdiPlay,
  mdiSkipNext,
  mdiSkipPrevious,
  mdiStar,
  mdiStarOutline,
  mdiStop,
  mdiVolumeHigh,
  mdiVolumeMinus,
  mdiVolumeOff,
  mdiVolumePlus,
} from '@mdi/js';
import { HomeAssistant, LovelaceCardConfig } from 'custom-card-helpers';
import { HassEntity } from 'home-assistant-js-websocket';
import {
  css,
  CSSResult,
  customElement,
  html,
  internalProperty,
  LitElement,
  property,
  PropertyValues,
  svg,
  TemplateResult,
} from 'lit-element';
import {
  addRecent,
  emptyLibrary,
  loadLibrary,
  MusicItem,
  MusicLibrary,
  sameItem,
  saveLibrary,
  toggleFavorite,
} from './music-library';

// Music services linked in the Alexa app, keyed by the names used in the card config
const PROVIDERS: { [key: string]: string } = {
  AMAZON_MUSIC: 'Amazon Music',
  SPOTIFY: 'Spotify',
  APPLE_MUSIC: 'Apple Music',
  TUNEIN: 'TuneIn',
  DEEZER: 'Deezer',
  IHEARTRADIO: 'iHeartRadio',
  PANDORA: 'Pandora',
  SIRIUSXM: 'SiriusXM',
  CLOUDPLAYER: 'My Music',
};

interface MusicPreset {
  name: string;
  query: string;
  provider?: string;
}

interface AlexaMusicPlayerCardConfig extends LovelaceCardConfig {
  title?: string;
  entities?: Array<string | SpeakerConfig>;
  default_entity?: string;
  provider?: string;
  presets?: MusicPreset[];
  // Same as presets
  favorites?: MusicPreset[];
  // Set to false to hide the Favourites/Recent list
  show_list?: boolean;
}

interface SpeakerConfig {
  entity: string;
  name?: string;
  // Speaker groups only: the group's name in the Alexa app, if it differs from Home Assistant's
  alexa_name?: string;
}

interface Speaker {
  entity: string;
  name: string;
  alexaName?: string;
}

// Alexa Media Player shows the Alexa app's multi-room groups as devices with this model
const GROUP_MODEL = 'Speaker Group';

// How often to re-poll a speaker after a playback action so new track details and art show sooner
const REFRESH_DELAYS = [1500, 4000, 8000];

@customElement('alexa-music-player-card')
export class AlexaMusicPlayerCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @internalProperty() private _config?: AlexaMusicPlayerCardConfig;

  @internalProperty() private _selected?: string;

  // Speaker the controls act on, resolved on every render
  private _active?: string;

  @internalProperty() private _provider = 'AMAZON_MUSIC';

  @internalProperty() private _query = '';

  @internalProperty() private _error?: string;

  @internalProperty() private _library: MusicLibrary = emptyLibrary();

  @internalProperty() private _tab: 'favorites' | 'recent' = 'favorites';

  private _libraryLoaded = false;

  private _saveTimer?: number;

  // Last track seen on each speaker, so each new song is added to Recent once
  private _lastTracks: { [entity: string]: string } = {};

  public static getStubConfig(): Partial<AlexaMusicPlayerCardConfig> {
    return { title: 'Music' };
  }

  public setConfig(config: AlexaMusicPlayerCardConfig): void {
    if (config.provider && !PROVIDERS[config.provider]) {
      throw new Error(`Unknown provider "${config.provider}". Use one of: ${Object.keys(PROVIDERS).join(', ')}`);
    }
    this._config = config;
    this._provider = config.provider || 'AMAZON_MUSIC';
    this._selected = config.default_entity;
  }

  public getCardSize(): number {
    return 7;
  }

  // Sections dashboards: take the full width and grow to fit the content
  public getGridOptions(): { columns: number; rows: string; min_columns: number } {
    return { columns: 12, rows: 'auto', min_columns: 6 };
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    if (!changedProps.has('hass') || !this.hass || !this._config) {
      return;
    }
    if (!this._libraryLoaded) {
      this._libraryLoaded = true;
      loadLibrary(this.hass).then(library => {
        this._library = library;
        this._trackPlaying();
      });
      return;
    }
    this._trackPlaying();
  }

  private _trackPlaying(): void {
    for (const speaker of this._speakers) {
      const attrs = this.hass!.states[speaker.entity]?.attributes;
      if (this.hass!.states[speaker.entity]?.state !== 'playing' || !attrs?.media_title) {
        continue;
      }
      const key = `${attrs.media_title}|${attrs.media_artist || ''}`;
      if (this._lastTracks[speaker.entity] === key) {
        continue;
      }
      this._lastTracks[speaker.entity] = key;
      const item = this._currentItem(speaker.entity);
      if (item && !(this._library.recent[0] && sameItem(this._library.recent[0], item))) {
        this._updateLibrary(addRecent(this._library, item));
      }
    }
  }

  // The song playing on a speaker as a list item that can be played again
  private _currentItem(entity: string): MusicItem | undefined {
    const attrs = this.hass!.states[entity]?.attributes;
    if (!attrs?.media_title) {
      return undefined;
    }
    const picture: string | undefined = attrs.entity_picture;
    return {
      name: attrs.media_title,
      subtitle: attrs.media_artist || attrs.media_album_name,
      query: attrs.media_artist ? `${attrs.media_title} by ${attrs.media_artist}` : attrs.media_title,
      // Home Assistant's proxy links expire, so only keep direct image links
      image: picture && /^https?:/.test(picture) ? picture : undefined,
    };
  }

  private _updateLibrary(library: MusicLibrary): void {
    this._library = library;
    clearTimeout(this._saveTimer);
    this._saveTimer = window.setTimeout(() => saveLibrary(this.hass!, this._library), 1000);
  }

  private get _favorites(): MusicItem[] {
    const presets = [...(this._config!.presets || []), ...(this._config!.favorites || [])].map(preset => ({
      name: preset.name,
      query: preset.query,
      provider: preset.provider,
      subtitle: preset.provider ? PROVIDERS[preset.provider] : undefined,
    }));
    return [...presets, ...this._library.favorites.filter(item => !presets.some(preset => sameItem(preset, item)))];
  }

  // Configured speakers, or every Alexa Media Player entity when none are configured
  private get _speakers(): Speaker[] {
    const hass = this.hass!;
    const name = (entity: string): string => hass.states[entity]?.attributes.friendly_name || entity;

    if (this._config!.entities?.length) {
      return this._config!.entities.map(conf =>
        typeof conf === 'string'
          ? { entity: conf, name: name(conf) }
          : { entity: conf.entity, name: conf.name || name(conf.entity), alexaName: conf.alexa_name },
      );
    }

    const registry = (hass as any).entities as { [entity: string]: { platform?: string } } | undefined;
    const players = Object.keys(hass.states).filter(entity => entity.startsWith('media_player.'));
    const alexa = registry ? players.filter(entity => registry[entity]?.platform === 'alexa_media') : [];
    return (alexa.length ? alexa : players).map(entity => ({ entity, name: name(entity) }));
  }
  private _isGroup(entity: string): boolean {
    const hass = this.hass as any;
    const deviceId = hass.entities?.[entity]?.device_id;
    return hass.devices?.[deviceId]?.model === GROUP_MODEL;
  }

  // Groups can't take typed commands, so a real speaker is asked to play on the group instead
  private _commandSpeaker(): string | undefined {
    const hass = this.hass as any;
    const candidates = [
      ...this._speakers.map(speaker => speaker.entity),
      ...Object.keys(hass.entities || {}).filter(
        entity => entity.startsWith('media_player.') && hass.entities[entity].platform === 'alexa_media',
      ),
    ];
    return candidates.find(
      entity => !this._isGroup(entity) && hass.states[entity] && hass.states[entity].state !== 'unavailable',
    );
  }

  private _groupName(entity: string): string {
    const hass = this.hass as any;
    const configured = this._speakers.find(speaker => speaker.entity === entity)?.alexaName;
    const device = hass.devices?.[hass.entities?.[entity]?.device_id];
    return configured || device?.name || hass.states[entity]?.attributes.friendly_name || entity;
  }

  protected render(): TemplateResult {
    if (!this.hass || !this._config) {
      return html``;
    }

    const speakers = this._speakers;
    if (!speakers.length) {
      return html`
        <ha-card .header=${this._config.title}>
          <div class="warning">No Alexa speakers found. Install Alexa Media Player or list <code>entities</code>.</div>
        </ha-card>
      `;
    }

    // Default to the configured speaker, else whichever one is already playing
    if (!speakers.some(speaker => speaker.entity === this._selected)) {
      const playing = speakers.find(speaker => this.hass!.states[speaker.entity]?.state === 'playing');
      this._active = (playing || speakers[0]).entity;
    } else {
      this._active = this._selected!;
    }

    const stateObj: HassEntity | undefined = this.hass.states[this._active];
    const attrs = stateObj?.attributes || {};
    const unavailable = !stateObj || stateObj.state === 'unavailable';
    const playing = stateObj?.state === 'playing';
    const volume = Math.round((attrs.volume_level ?? 0) * 100);

    return html`
      <ha-card .header=${this._config.title}>
        <div class="layout">
          <div class="player">
            <div class="speakers">
              ${speakers.map(
                speaker => html`
                  <button
                    class=${this._speakerClass(speaker.entity)}
                    @click=${(): void => this._selectSpeaker(speaker.entity)}
                  >
                    ${speaker.name}
                  </button>
                `,
              )}
            </div>

            <div class="now-playing">
              <div
                class="art"
                style=${attrs.entity_picture ? `background-image: url("${this._artUrl(attrs.entity_picture)}")` : ''}
              >
                ${attrs.entity_picture ? '' : this._icon(mdiMusic)}
              </div>
              <div class="info">
                <div class="title">${unavailable ? 'Unavailable' : attrs.media_title || 'Nothing playing'}</div>
                <div class="artist">${attrs.media_artist || attrs.media_album_name || ''}</div>
                <div class="source">${attrs.source || ''}</div>
              </div>
              ${this._renderFavoriteToggle(this._currentItem(this._active))}
            </div>

            <div class="controls">
              ${this._button(mdiSkipPrevious, 'Previous', unavailable, () => this._control('media_previous_track'))}
              ${this._button(
                playing ? mdiPause : mdiPlay,
                playing ? 'Pause' : 'Play',
                unavailable,
                () => this._control(playing ? 'media_pause' : 'media_play'),
                'primary',
              )}
              ${this._button(mdiStop, 'Stop', unavailable, () => this._control('media_stop'))}
              ${this._button(mdiSkipNext, 'Next', unavailable, () => this._control('media_next_track'))}
            </div>

            <div class="volume">
              ${this._button(
                attrs.is_volume_muted ? mdiVolumeOff : mdiVolumeHigh,
                attrs.is_volume_muted ? 'Unmute' : 'Mute',
                unavailable,
                () => this._call('volume_mute', { is_volume_muted: !attrs.is_volume_muted }),
              )}
              ${this._button(mdiVolumeMinus, 'Volume down', unavailable, () => this._changeVolume(volume - 10))}
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                aria-label="Volume"
                .value=${String(volume)}
                .disabled=${unavailable}
                @change=${(ev: Event): void => this._changeVolume(Number((ev.target as HTMLInputElement).value))}
              />
              ${this._button(mdiVolumePlus, 'Volume up', unavailable, () => this._changeVolume(volume + 10))}
              <span class="volume-level">${volume}%</span>
            </div>

            <form class="search" @submit=${this._search}>
              <select .value=${this._provider} @change=${(ev: Event): void => this._setProvider(ev)}>
                ${Object.entries(PROVIDERS).map(
                  ([key, label]) => html`
                    <option value=${key} ?selected=${key === this._provider}>${label}</option>
                  `,
                )}
              </select>
              <input
                type="text"
                placeholder="Song, artist, album or playlist"
                .value=${this._query}
                @input=${(ev: Event): void => {
                  this._query = (ev.target as HTMLInputElement).value;
                }}
              />
              <button class="icon-button" type="submit" title="Play" .disabled=${unavailable || !this._query.trim()}>
                ${this._icon(mdiMagnify)}
              </button>
            </form>
            ${this._error
              ? html`
                  <div class="error">${this._error}</div>
                `
              : ''}
          </div>
          ${this._config.show_list === false ? '' : this._renderList(unavailable)}
        </div>
      </ha-card>
    `;
  }

  private _renderList(unavailable: boolean): TemplateResult {
    const favorites = this._favorites;
    const items = this._tab === 'favorites' ? favorites : this._library.recent;
    return html`
      <div class="library">
        <div class="tabs">
          <button
            class="tab ${this._tab === 'favorites' ? 'active' : ''}"
            @click=${(): void => {
              this._tab = 'favorites';
            }}
          >
            Favourites
          </button>
          <button
            class="tab ${this._tab === 'recent' ? 'active' : ''}"
            @click=${(): void => {
              this._tab = 'recent';
            }}
          >
            Recent
          </button>
        </div>
        <div class="list">
          ${items.length
            ? items.map(item => this._renderItem(item, unavailable))
            : html`
                <div class="empty">
                  ${this._tab === 'favorites'
                    ? 'Tap ☆ next to a song to add it here.'
                    : 'Songs you play will show up here.'}
                </div>
              `}
        </div>
      </div>
    `;
  }

  private _renderItem(item: MusicItem, unavailable: boolean): TemplateResult {
    return html`
      <div class="item">
        <button
          class="item-play"
          title="Play ${item.name}"
          .disabled=${unavailable}
          @click=${(): Promise<void> => this._playMusic(item.query, item.provider, item)}
        >
          <span class="thumb" style=${item.image ? `background-image: url("${item.image}")` : ''}>
            ${item.image ? '' : this._icon(mdiMusic)}
          </span>
          <span class="item-text">
            <span class="item-name">${item.name}</span>
            <span class="item-sub">${item.subtitle || ''}</span>
          </span>
        </button>
        ${this._renderFavoriteToggle(item, this._tab === 'favorites')}
      </div>
    `;
  }

  // Star to add or remove a favourite (an ✕ inside the Favourites tab). Presets from the config stay put.
  private _renderFavoriteToggle(item?: MusicItem, inFavorites = false): TemplateResult | string {
    if (!item) {
      return '';
    }
    const saved = this._library.favorites.some(existing => sameItem(existing, item));
    if (!saved && this._favorites.some(existing => sameItem(existing, item))) {
      return '';
    }
    const toggle = (): void => this._updateLibrary(toggleFavorite(this._library, item));
    if (inFavorites) {
      return this._button(mdiClose, 'Remove from favourites', false, toggle);
    }
    return this._button(
      saved ? mdiStar : mdiStarOutline,
      saved ? 'Remove from favourites' : 'Add to favourites',
      false,
      toggle,
      saved ? 'starred' : '',
    );
  }

  private _speakerClass(entity: string): string {
    const classes = ['chip'];
    if (entity === this._active) {
      classes.push('active');
    }
    if (this.hass!.states[entity]?.state === 'playing') {
      classes.push('playing');
    }
    return classes.join(' ');
  }

  private _selectSpeaker(entity: string): void {
    this._selected = entity;
  }

  private _setProvider(ev: Event): void {
    this._provider = (ev.target as HTMLSelectElement).value;
  }

  private _artUrl(picture: string): string {
    return picture.startsWith('/') ? (this.hass as any).hassUrl(picture) : picture;
  }

  private _call(service: string, data: { [key: string]: any } = {}): Promise<unknown> {
    return this.hass!.callService('media_player', service, { entity_id: this._active, ...data });
  }

  private async _control(service: string): Promise<void> {
    this._error = undefined;
    try {
      await this._call(service);
      this._refreshSoon([this._active!]);
    } catch (err) {
      this._error = (err as Error).message || String(err);
    }
  }

  // Alexa Media Player only polls Amazon now and then; ask for fresh state a few times after a change
  private _refreshSoon(entities: string[]): void {
    REFRESH_DELAYS.forEach(delay =>
      setTimeout(() => {
        this.hass!.callService('homeassistant', 'update_entity', { entity_id: entities }).catch(() => undefined);
      }, delay),
    );
  }

  private _changeVolume(percent: number): void {
    const level = Math.min(100, Math.max(0, percent)) / 100;
    this._call('volume_set', { volume_level: level });
  }

  // Plain buttons and inline SVG so the card doesn't depend on Home Assistant's internal elements
  private _icon(path: string): TemplateResult {
    return html`
      <svg viewBox="0 0 24 24" aria-hidden="true">${svg`<path d=${path}></path>`}</svg>
    `;
  }

  private _button(
    path: string,
    title: string,
    disabled: boolean,
    onClick: () => void,
    extraClass = '',
  ): TemplateResult {
    return html`
      <button
        class="icon-button ${extraClass}"
        type="button"
        title=${title}
        aria-label=${title}
        .disabled=${disabled}
        @click=${onClick}
      >
        ${this._icon(path)}
      </button>
    `;
  }

  private _search(ev: Event): void {
    ev.preventDefault();
    const query = this._query.trim();
    if (!query) {
      return;
    }
    this._playMusic(query);
    this._query = '';
  }

  // Sent as a typed Alexa command ("play ... on Spotify"), the same as saying it to the speaker.
  // This is more reliable than Alexa Media Player's music search content types.
  private async _playMusic(query: string, provider?: string, item?: MusicItem): Promise<void> {
    const key = provider || this._provider;
    const request = query.replace(/^play\s+/i, '');
    const service = key === 'CLOUDPLAYER' ? undefined : PROVIDERS[key];
    const active = this._active!;
    this._error = undefined;

    let target = active;
    let command = service ? `play ${request} on ${service}` : `play ${request}`;
    if (this._isGroup(active)) {
      const speaker = this._commandSpeaker();
      if (!speaker) {
        this._error = 'No available Alexa speaker to send the request through.';
        return;
      }
      target = speaker;
      command = `play ${request}${service ? ` from ${service}` : ''} on ${this._groupName(active)}`;
    }

    try {
      await this.hass!.callService('media_player', 'play_media', {
        entity_id: target,
        media_content_id: command,
        media_content_type: 'custom',
      });
      this._refreshSoon([active]);
      this._updateLibrary(
        addRecent(this._library, item || { name: request, query: request, provider, subtitle: service || 'Search' }),
      );
    } catch (err) {
      this._error = `Couldn't play "${request}": ${(err as Error).message || err}`;
    }
  }

  static get styles(): CSSResult {
    return css`
      ha-card {
        box-sizing: border-box;
        padding-bottom: 12px;
      }

      .icon-button {
        flex: none;
        width: 40px;
        height: 40px;
        padding: 8px;
        border: none;
        border-radius: 50%;
        background: none;
        color: var(--primary-text-color);
        cursor: pointer;
      }

      .icon-button:hover:not(:disabled) {
        background: var(--secondary-background-color);
      }

      .icon-button.starred {
        color: var(--primary-color);
      }

      .icon-button:disabled {
        opacity: 0.4;
        cursor: default;
      }

      .icon-button svg,
      .art svg {
        display: block;
        width: 100%;
        height: 100%;
        fill: currentColor;
      }

      .art svg {
        width: 40px;
        height: 40px;
      }

      .error {
        padding: 0 16px 12px;
        color: var(--error-color, #db4437);
        font-size: 13px;
      }

      .layout {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
      }

      .player {
        flex: 1 1 320px;
        min-width: 0;
      }

      .library {
        flex: 1 1 240px;
        min-width: 0;
        padding: 0 16px;
      }

      .tabs {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid var(--divider-color);
        margin-bottom: 4px;
      }

      .tab {
        flex: 1;
        padding: 8px;
        border: none;
        border-bottom: 2px solid transparent;
        background: none;
        color: var(--secondary-text-color);
        font: inherit;
        font-size: 14px;
        cursor: pointer;
      }

      .tab.active {
        color: var(--primary-color);
        border-bottom-color: var(--primary-color);
      }

      .list {
        max-height: 340px;
        overflow-y: auto;
      }

      .empty {
        padding: 16px 0;
        color: var(--secondary-text-color);
        font-size: 13px;
        text-align: center;
      }

      .item {
        display: flex;
        align-items: center;
      }

      .item-play {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 6px 4px;
        border: none;
        border-radius: 8px;
        background: none;
        color: var(--primary-text-color);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .item-play:hover:not(:disabled) {
        background: var(--secondary-background-color);
      }

      .item-play:disabled {
        opacity: 0.5;
        cursor: default;
      }

      .thumb {
        flex: none;
        width: 40px;
        height: 40px;
        border-radius: 4px;
        background-color: var(--secondary-background-color);
        background-size: cover;
        background-position: center;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--secondary-text-color);
      }

      .thumb svg {
        width: 20px;
        height: 20px;
        fill: currentColor;
      }

      .item-text {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .item-name,
      .item-sub {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .item-sub {
        color: var(--secondary-text-color);
        font-size: 12px;
      }

      .warning {
        padding: 16px;
        color: var(--secondary-text-color);
      }

      .speakers {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 0 16px 12px;
      }

      .chip {
        border: 1px solid var(--divider-color);
        border-radius: 16px;
        padding: 6px 12px;
        background: none;
        color: var(--primary-text-color);
        font: inherit;
        font-size: 13px;
        cursor: pointer;
      }

      .chip.playing::before {
        content: '♪ ';
        color: var(--accent-color);
      }

      .chip.active {
        background: var(--primary-color);
        border-color: var(--primary-color);
        color: var(--text-primary-color);
      }

      .chip:disabled {
        opacity: 0.5;
        cursor: default;
      }

      .now-playing {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 0 16px;
      }

      .art {
        flex: none;
        width: 88px;
        height: 88px;
        border-radius: 8px;
        background-color: var(--secondary-background-color);
        background-size: cover;
        background-position: center;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--secondary-text-color);
      }

      .info {
        min-width: 0;
      }

      .title {
        font-size: 18px;
        font-weight: 500;
      }

      .title,
      .artist,
      .source {
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .artist,
      .source {
        color: var(--secondary-text-color);
      }

      .source {
        font-size: 12px;
      }

      .controls {
        display: flex;
        justify-content: center;
        padding: 8px 16px 0;
      }

      .controls .primary {
        width: 56px;
        height: 56px;
        color: var(--primary-color);
      }

      .volume,
      .search {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 16px;
      }

      .volume input {
        flex: 1;
        min-width: 60px;
        accent-color: var(--primary-color);
      }

      .volume-level {
        width: 40px;
        text-align: right;
        color: var(--secondary-text-color);
        font-size: 13px;
      }

      .search {
        padding-bottom: 12px;
      }

      .search select,
      .search input {
        height: 36px;
        box-sizing: border-box;
        border: 1px solid var(--divider-color);
        border-radius: 4px;
        padding: 0 8px;
        background: var(--card-background-color);
        color: var(--primary-text-color);
        font: inherit;
      }

      .search input {
        flex: 1;
        min-width: 0;
      }
    `;
  }
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: 'alexa-music-player-card',
  name: 'Alexa Music Player',
  description: 'Pick an Alexa speaker, control playback and play music from Amazon Music, Spotify and more.',
  preview: false,
});
