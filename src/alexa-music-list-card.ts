/* eslint-disable @typescript-eslint/camelcase */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mdiClose, mdiMusic, mdiStarOutline } from '@mdi/js';
import { HomeAssistant, LovelaceCardConfig } from 'custom-card-helpers';
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
import { PROVIDERS } from './alexa-music-player-card';
import { MusicItem, musicStore, sameItem, toggleFavorite } from './music-library';
import { icon, iconButton, iconButtonStyles } from './ui';

interface AlexaMusicListCardConfig extends LovelaceCardConfig {
  title?: string;
  default_tab?: 'favorites' | 'recent';
  presets?: Array<{ name: string; query: string; provider?: string }>;
}

// Favourites and recently played music, played through the Alexa Music Player card on the same dashboard
@customElement('alexa-music-list-card')
export class AlexaMusicListCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;

  @internalProperty() private _config?: AlexaMusicListCardConfig;

  @internalProperty() private _tab: 'favorites' | 'recent' = 'favorites';

  private _unsubscribe?: () => void;

  public static getStubConfig(): Partial<AlexaMusicListCardConfig> {
    return { title: 'Music list' };
  }

  public setConfig(config: AlexaMusicListCardConfig): void {
    this._config = config;
    this._tab = config.default_tab || 'favorites';
  }

  public getCardSize(): number {
    return 6;
  }

  public getGridOptions(): { columns: number; rows: string; min_columns: number } {
    return { columns: 12, rows: 'auto', min_columns: 4 };
  }

  public connectedCallback(): void {
    super.connectedCallback();
    this._unsubscribe = musicStore.subscribe(() => this.requestUpdate());
  }

  public disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe?.();
  }

  protected updated(): void {
    if (this.hass && !musicStore.loaded) {
      musicStore.load(this.hass);
    }
  }

  private get _favorites(): MusicItem[] {
    const presets = [
      ...(this._config!.presets || []).map(preset => ({
        name: preset.name,
        query: preset.query,
        provider: preset.provider,
        subtitle: preset.provider ? PROVIDERS[preset.provider] : undefined,
      })),
      ...(musicStore.player?.presets || []),
    ];
    return [
      ...presets,
      ...musicStore.library.favorites.filter(item => !presets.some(preset => sameItem(preset, item))),
    ];
  }

  protected render(): TemplateResult {
    if (!this.hass || !this._config) {
      return html``;
    }

    const player = musicStore.player;
    const favorites = this._favorites;
    const items = this._tab === 'favorites' ? favorites : musicStore.library.recent;
    const disabled = !player || player.unavailable;

    return html`
      <ha-card .header=${this._config.title}>
        <div class="content">
          <div class="target">
            ${player
              ? html`
                  Plays on <strong>${player.speakerName || 'the selected speaker'}</strong>
                `
              : 'Add the Alexa Music Player card to this dashboard to play from this list.'}
          </div>
          <div class="tabs">
            ${this._renderTab('favorites', 'Favourites')} ${this._renderTab('recent', 'Recent')}
          </div>
          <div class="list">
            ${items.length
              ? items.map(item => this._renderItem(item, favorites, disabled))
              : html`
                  <div class="empty">
                    ${this._tab === 'favorites'
                      ? 'Tap ☆ on the player or in Recent to add songs here.'
                      : 'Songs you play will show up here.'}
                  </div>
                `}
          </div>
        </div>
      </ha-card>
    `;
  }

  private _renderTab(tab: 'favorites' | 'recent', label: string): TemplateResult {
    return html`
      <button
        class="tab ${this._tab === tab ? 'active' : ''}"
        @click=${(): void => {
          this._tab = tab;
        }}
      >
        ${label}
      </button>
    `;
  }

  private _renderItem(item: MusicItem, favorites: MusicItem[], disabled: boolean): TemplateResult {
    const saved = musicStore.library.favorites.some(existing => sameItem(existing, item));
    const isPreset = !saved && favorites.some(existing => sameItem(existing, item));
    const toggle = (): void => musicStore.update(toggleFavorite(musicStore.library, item));

    let action: TemplateResult | string = '';
    if (this._tab === 'favorites' && saved) {
      action = iconButton(mdiClose, 'Remove from favourites', false, toggle);
    } else if (this._tab === 'recent' && !saved && !isPreset) {
      action = iconButton(mdiStarOutline, 'Add to favourites', false, toggle);
    }

    return html`
      <div class="item">
        <button
          class="item-play"
          title="Play ${item.name}"
          .disabled=${disabled}
          @click=${(): void => {
            musicStore.player?.playMusic(item.query, item.provider, item);
          }}
        >
          <span class="thumb" style=${item.image ? `background-image: url("${item.image}")` : ''}>
            ${item.image ? '' : icon(mdiMusic)}
          </span>
          <span class="item-text">
            <span class="item-name">${item.name}</span>
            <span class="item-sub">${item.subtitle || ''}</span>
          </span>
        </button>
        ${action}
      </div>
    `;
  }

  static get styles(): CSSResult[] {
    return [
      iconButtonStyles,
      css`
        .content {
          padding: 0 16px 12px;
        }

        .target {
          padding-bottom: 8px;
          color: var(--secondary-text-color);
          font-size: 13px;
        }

        .target strong {
          color: var(--primary-text-color);
          font-weight: 500;
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
          max-height: 420px;
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
      `,
    ];
  }
}

(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: 'alexa-music-list-card',
  name: 'Alexa Music List',
  description: 'Favourites and recently played music for the Alexa Music Player card.',
  preview: false,
});
