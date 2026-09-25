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
  mdiVolumeOff,
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
  TemplateResult,
} from 'lit-element';

// Content types understood by the Alexa Media Player integration's play_media service
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
            ${attrs.entity_picture
              ? ''
              : html`
                  <ha-svg-icon .path=${mdiMusic}></ha-svg-icon>
                `}
          </div>
          <div class="info">
            <div class="title">${unavailable ? 'Unavailable' : attrs.media_title || 'Nothing playing'}</div>
            <div class="artist">${attrs.media_artist || attrs.media_album_name || ''}</div>
            <div class="source">${attrs.source || ''}</div>
          </div>
        </div>

        <div class="controls">
          <mwc-icon-button
            .disabled=${unavailable}
            title="Previous"
            @click=${(): void => this._call('media_previous_track')}
          >
            <ha-svg-icon .path=${mdiSkipPrevious}></ha-svg-icon>
          </mwc-icon-button>
          <mwc-icon-button
            class="primary"
            .disabled=${unavailable}
            title=${playing ? 'Pause' : 'Play'}
            @click=${(): void => this._call(playing ? 'media_pause' : 'media_play')}
          >
            <ha-svg-icon .path=${playing ? mdiPause : mdiPlay}></ha-svg-icon>
          </mwc-icon-button>
          <mwc-icon-button .disabled=${unavailable} title="Stop" @click=${(): void => this._call('media_stop')}>
            <ha-svg-icon .path=${mdiStop}></ha-svg-icon>
          </mwc-icon-button>
          <mwc-icon-button .disabled=${unavailable} title="Next" @click=${(): void => this._call('media_next_track')}>
            <ha-svg-icon .path=${mdiSkipNext}></ha-svg-icon>
          </mwc-icon-button>
        </div>

        <div class="volume">
          <mwc-icon-button
            .disabled=${unavailable}
            title=${attrs.is_volume_muted ? 'Unmute' : 'Mute'}
            @click=${(): void => this._call('volume_mute', { is_volume_muted: !attrs.is_volume_muted })}
          >
            <ha-svg-icon .path=${attrs.is_volume_muted ? mdiVolumeOff : mdiVolumeHigh}></ha-svg-icon>
          </mwc-icon-button>
          <input
            type="range"
            min="0"
            max="100"
            .value=${String(volume)}
            .disabled=${unavailable}
            @change=${this._setVolume}
          />
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
          <mwc-icon-button title="Play" .disabled=${unavailable || !this._query.trim()} @click=${this._search}>
            <ha-svg-icon .path=${mdiMagnify}></ha-svg-icon>
          </mwc-icon-button>
        </form>

        ${this._config.presets?.length
          ? html`
              <div class="presets">
                ${this._config.presets.map(
                  preset => html`
                    <button
                      class="chip"
                      .disabled=${unavailable}
                      @click=${(): void => this._playMusic(preset.query, preset.provider)}
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

  private _call(service: string, data: { [key: string]: any } = {}): void {
    this.hass!.callService('media_player', service, { entity_id: this._active, ...data });
  }

  private _setVolume(ev: Event): void {
    const level = Number((ev.target as HTMLInputElement).value) / 100;
    this._call('volume_set', { volume_level: level });
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

  private _playMusic(query: string, provider?: string): void {
    this._call('play_media', {
      media_content_id: query,
      media_content_type: provider || this._provider,
    });
  }

  static get styles(): CSSResult {
    return css`
      ha-card {
        height: 100%;
        box-sizing: border-box;
        padding-bottom: 12px;
        overflow: hidden;
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
        --mdc-icon-button-size: 56px;
        --mdc-icon-size: 40px;
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
