import { css, CSSResult, html, svg, TemplateResult } from 'lit-element';

// Plain buttons and inline SVG so the cards don't depend on Home Assistant's internal elements
export const icon = (path: string): TemplateResult => html`
  <svg viewBox="0 0 24 24" aria-hidden="true">${svg`<path d=${path}></path>`}</svg>
`;

export const iconButton = (
  path: string,
  title: string,
  disabled: boolean,
  onClick: () => void,
  extraClass = '',
): TemplateResult => html`
  <button
    class="icon-button ${extraClass}"
    type="button"
    title=${title}
    aria-label=${title}
    .disabled=${disabled}
    @click=${onClick}
  >
    ${icon(path)}
  </button>
`;

export const iconButtonStyles: CSSResult = css`
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

  .icon-button svg {
    display: block;
    width: 100%;
    height: 100%;
    fill: currentColor;
  }
`;
