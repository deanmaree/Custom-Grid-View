/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  mdiMagnify,
  mdiMusic,
  mdiPause,
  mdiPlay,
  mdiSkipNext,
  mdiSkipPrevious,
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
  svg,
  TemplateResult,
} from 'lit-element';

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
  entities?: Array<string | { entity: string; name?: string }>;
  default_entity?: string;
  provider?: string;
  presets?: MusicPreset[];
}

interface Speaker {
  entity: string;
  name: string;
}

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

  // Configured speakers, or every Alexa Media Player entity when none are configured
  private get _speakers(): Speaker[] {
    const hass = this.hass!;
    const name = (entity: string): string => hass.states[entity]?.attributes.friendly_name || entity;

    if (this._config!.entities?.length) {
      return this._config!.entities.map(conf =>
        typeof conf === 'string'
          ? { entity: conf, name: name(conf) }
          : { entity: conf.entity, name: conf.name || name(conf.entity) },
      );
    }

    const registry = (hass as any).entities as { [entity: string]: { platform?: string } } | undefined;
    const players = Object.keys(hass.states).filter(entity => entity.startsWith('media_player.'));
    const alexa = registry ? players.filter(entity => registry[entity]?.platform === 'alexa_media') : [];
    return (alexa.length ? alexa : players).map(entity => ({ entity, name: name(entity) }));
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
        </div>

        <div class="controls">
          ${this._button(mdiSkipPrevious, 'Previous', unavailable, () => this._call('media_previous_track'))}
          ${this._button(
            playing ? mdiPause : mdiPlay,
            playing ? 'Pause' : 'Play',
            unavailable,
            () => this._call(playing ? 'media_pause' : 'media_play'),
            'primary',
          )}
          ${this._button(mdiStop, 'Stop', unavailable, () => this._call('media_stop'))}
          ${this._button(mdiSkipNext, 'Next', unavailable, () => this._call('media_next_track'))}
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
        ${this._config.presets?.length
          ? html`
              <div class="presets">
                ${this._config.presets.map(
                  preset => html`
                    <button
                      class="chip"
                      .disabled=${unavailable}
                      @click=${(): Promise<void> => this._playMusic(preset.query, preset.provider)}
                    >
                      ${preset.name}
                    </button>
                  `,
                )}
              </div>
            `
          : ''}
      </ha-card>
    `;
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
  private async _playMusic(query: string, provider?: string): Promise<void> {
    const key = provider || this._provider;
    const request = query.replace(/^play\s+/i, '');
    const command =
      key === 'CLOUDPLAYER' || !PROVIDERS[key] ? `play ${request}` : `play ${request} on ${PROVIDERS[key]}`;
    this._error = undefined;
    try {
      await this._call('play_media', { media_content_id: command, media_content_type: 'custom' });
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

      .warning {
        padding: 16px;
        color: var(--secondary-text-color);
      }

      .speakers,
      .presets {
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
