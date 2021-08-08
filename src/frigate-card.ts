// TODO: Can I use ajv (https://ajv.js.org/guide/typescript.html) to verify
// event return matches the TS interface?

// TODO Does each event contain thumbnail?

// TODO comments per method.

// TODO: Stop the live view video when I hide it.

// TODO Check for HA state presence and validity before using it, otherwise warn.

// TODO Add material tooltips


/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  LitElement,
  html,
  customElement,
  property,
  CSSResult,
  TemplateResult,
  PropertyValues,
  state,
  unsafeCSS,
} from 'lit-element';

import { until } from 'lit-html/directives/until.js';
import {
  HomeAssistant,
  ActionHandlerEvent,
  handleAction,
  LovelaceCardEditor,
  getLovelace,
} from 'custom-card-helpers';

import './editor';

import style from './frigate-card.scss'

import type { FrigateCardConfig, FrigateEvent, GetEventsParameters } from './types';
import { actionHandler } from './action-handler-directive';
import { CARD_VERSION } from './const';
import { localize } from './localize/localize';

/* eslint no-console: 0 */
console.info(
  `%c  FRIGATE-HASS-CARD \n%c  ${localize('common.version')} ${CARD_VERSION}    `,
  'color: pink; font-weight: bold; background: black',
  'color: white; font-weight: bold; background: dimgray',
);

// This puts your card into the UI card picker dialog
(window as any).customCards = (window as any).customCards || [];
(window as any).customCards.push({
  type: 'frigate-card',
  name: 'Frigate Card',
  description: 'A lovelace card for use with Frigate',
});

enum FrigateCardView {
  LIVE,       // Show the live camera.
  CLIP,       // Show a clip video.
  CLIPS,      // Show the clips gallery.
  SNAPSHOT,   // Show a snapshot.
  SNAPSHOTS,  // Show the snapshots gallery.
}

@customElement('frigate-card')
export class FrigateCard extends LitElement {
  constructor() {
    super();
    this._viewMode = FrigateCardView.LIVE;
    this._viewEvent = null;
    this._interactionTimerID = null;
  }

  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    return document.createElement('frigate-card-editor');
  }

  public static getStubConfig(): Record<string, string> {
    return {};
  }

  @property({ attribute: false })
  public hass!: HomeAssistant;

  @state()
  public config!: FrigateCardConfig;

  @property({ attribute: false })
  protected _viewMode: FrigateCardView;

  @property({ attribute: false })
  protected _viewEvent: FrigateEvent | null;

  protected _interactionTimerID: number | null;

  public setConfig(inputConfig: FrigateCardConfig): void {
    if (!inputConfig) {
      throw new Error(localize('common.invalid_configuration:'));
    }
    // inputConfig is not extensible, need to make a copy to allow
    // modifications.
    const cardConfig = Object.assign({
      name: 'Frigate'
    }, inputConfig);

    if (cardConfig.test_gui) {
      getLovelace().setEditMode(true);
    }

    if (!cardConfig.frigate_url) {
      throw new Error(localize('common.invalid_configuration_missing') + ": frigate_url");
    }

    if (!cardConfig.frigate_camera_name) {
      // No camera name specified, so just assume it's the same as the entity name.
      if (cardConfig.camera_entity.includes(".")) {
        cardConfig.frigate_camera_name = cardConfig.camera_entity.split('.', 2)[1]
      } else {
        throw new Error(localize('common.invalid_configuration_missing') + ": camera");
      }
    }

    if (cardConfig.view_timeout) {
      if (isNaN(Number(cardConfig.view_timeout))) {
        throw new Error(localize('common.invalid_configuration') + ": view_timeout");
      }
    }

    if (cardConfig.view_default) {
      if (!["live", "clips", "clip", "snapshots", "snapshot"].includes(cardConfig.view_default)) {
        throw new Error(localize('common.invalid_configuration') + ": view_default");
      }
    }

    this.config = cardConfig;
    this._setViewModeToDefault();
  }

  protected _setViewModeToDefault(): void {
    if (this.config.view_default == "live") {
      this._viewMode = FrigateCardView.LIVE;
    } else if (this.config.view_default == "clips") {
      this._viewMode = FrigateCardView.CLIPS;
    } else if (this.config.view_default == "clip") {
        this._viewMode = FrigateCardView.CLIP;
    } else if (this.config.view_default == "snapshots") {
      this._viewMode = FrigateCardView.SNAPSHOTS;
    } else if (this.config.view_default == "snapshot") {
      this._viewMode = FrigateCardView.SNAPSHOT;
    }
  }

  // == RTC experimentation ==
  // const div = document.createElement("div");
  // const webrtcElement = customElements.get('webrtc-camera');
  // const webrtc = new webrtcElement();
  // webrtc.setConfig({ "entity": "camera.landing_rtsp" });
  // webrtc.hass = this.hass;
  // div.appendChild(webrtc);
  // this.renderRoot.appendChild(div);
  // ==

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (!this.config || !this.hass) {
      return false;
    }

    const cameraEntity = this.config.camera_entity;
    const motionEntity = this.config.motion_entity;

    if (!cameraEntity) {
      return false;
    }

    if (changedProps.has('config')) {
      return true;
    }
    
    const oldHass = changedProps.get('hass') as HomeAssistant | undefined;
  
    if (oldHass) {
      if (oldHass.states[cameraEntity] !== this.hass.states[cameraEntity]) {
        return true;
      }
      if (motionEntity && oldHass.states[motionEntity] !== this.hass.states[motionEntity]) {
        return true;
      }
      return false;
    }
    return true;
  }

  protected async _getEvents({
    has_clip = false,
    has_snapshot = false,
    limit = 100,
  }: GetEventsParameters): Promise<FrigateEvent[]> {
    let url = `${this.config.frigate_url}/api/events?camera=${this.config.frigate_camera_name}`;
    if (has_clip) {
      url += `&has_clip=1`
    }
    if (has_snapshot) {
      url += `&has_snapshot=1`
    }
    if (limit > 0) {
      url += `&limit=${limit}`
    }

    if (this.config.label) {
      url += `&label=${this.config.label}`;
    }

    const response = await fetch(url);
    if (response.ok) {
      return await response.json();
    } else {
      // TODO: Catch when json decoding fails.
      throw new Error(`Frigate API request failed with status: ${response.status}`);
    }
  }

  protected async _renderEvents() : Promise<TemplateResult> {
    const want_clips = this._viewMode == FrigateCardView.CLIPS;

    const events = await this._getEvents({
      has_clip: want_clips,
      has_snapshot: !want_clips,
    });

    if (!events.length) {
      return html`
        <div class="frigate-card-exception">
          <ha-icon
            icon="${want_clips ? "mdi:filmstrip-off" : "mdi:camera-off"}"
          ></ha-icon>
        </div>`
    }

    return html`
      <ul class= "mdc-image-list frigate-card-image-list">
      ${events.map(event => html`
          <li class="mdc-image-list__item">
            <div class="mdc-image-list__image-aspect-container">
              <img
                class="mdc-image-list__image"
                src="data:image/png;base64,${event.thumbnail}"
                @click=${() => {
                  this._viewEvent = event;
                  this._viewMode = want_clips ?
                      FrigateCardView.CLIP : FrigateCardView.SNAPSHOT
                }}
              >
            </div>
          </li>`)}
      </ul>`;
  }

  protected _renderProgressIndicator(): TemplateResult {
    return html`
      <div class="frigate-card-exception">
        <ha-circular-progress
          active="true"
          size="large"
        ></ha-circular-progress>
      </div>`
  }

  protected _renderNavigationBar(): TemplateResult {
    return html`
      <div class="frigate-card-navbar" >
        <ha-icon-button
          class="button"
          icon="mdi:cctv"
          @click=${() => this._viewMode = FrigateCardView.LIVE}
        ></ha-icon-button>
        <ha-icon-button
          class="button"
          icon = "mdi:filmstrip"
          @click=${() => this._viewMode = FrigateCardView.CLIPS}
        ></ha-icon-button>
        <ha-icon-button
          class="button"
          icon = "mdi:camera"
          @click=${() => this._viewMode = FrigateCardView.SNAPSHOTS}
        ></ha-icon-button>
      </div>`
  }

  protected async _renderClipPlayer(): Promise<TemplateResult> {
    let event: FrigateEvent;
    if (!this._viewEvent) {
      const events = await this._getEvents({
        has_clip: true,
        limit: 1
      });
      if (!events.length) {
        return html`
          <div class="frigate-card-exception">
            <ha-icon
              icon="mdi:camera-off"
            ></ha-icon>
          </div>`
      }
      event = events[0];
    } else {
      event = this._viewEvent;
    }

    const url = `${this.config.frigate_url}/clips/` +
        `${event.camera}-${event.id}.mp4`;
    return html`
      <video class="frigate-card-viewer" autoplay controls>
        <source src="${url}" type="video/mp4">
      </video>`
  }

  protected _renderSnapshotViewer(): TemplateResult {
    if (!this._viewEvent) {
      return html``
    }
    const url = `${this.config.frigate_url}/clips/` +
        `${this._viewEvent.camera}-${this._viewEvent.id}.jpg`;
    return html`<img class="frigate-card-viewer" src="${url}">`
  }

  protected _renderStatusBar(): TemplateResult {
    if (!this.config.motion_entity || !(this.config.motion_entity in this.hass.states)) {
      return html``;
    }
    const icon = this.hass.states[this.config.motion_entity].state == "on" ?
        "mdi:motion-sensor" : "mdi:walk"
    return html`
      <div class="frigate-card-statusbar ${
        this._viewMode == FrigateCardView.LIVE ? 'visible' : 'invisible'}
      ">
        <ha-icon-button
          class="button"
          icon="${icon}"
        ></ha-icon-button>
      </div>`
    }

  protected _renderLiveViewer(): TemplateResult {
    return html`
      <ha-camera-stream
        .hass=${this.hass}
        .stateObj=${this.hass.states[this.config.camera_entity]}
        .controls=${true}
        .muted=${true}
        class=${this._viewMode == FrigateCardView.LIVE ? 'visible' : 'invisible'}
      >
      </ha-camera-stream>`;
  }

  protected _interactionHandler(): void {
    if (!this.config.view_timeout) {
      return;
    }
    if (this._interactionTimerID) {
      window.clearTimeout(this._interactionTimerID);
    }
    this._interactionTimerID = window.setTimeout(() => {
      this._interactionTimerID = null;
      this._setViewModeToDefault();
    }, this.config.view_timeout * 1000);
  }

  protected render(): TemplateResult | void {
    if (this.config.show_warning) {
      return this._showWarning(localize('common.show_warning'));
    }
    if (this.config.show_error) {
      return this._showError(localize('common.show_error'));
    }

    // TODO: Add latest snapshot fetch functionality.
    return html`
      <div 
        class="frigate-card-container"
        @click=${this._interactionHandler}
      >
        ${this._renderNavigationBar()}
        ${this._viewMode == FrigateCardView.CLIPS ?
          html`<div class="frigate-card-gallery">
            ${until(this._renderEvents(), this._renderProgressIndicator())}
          </div>` : ``
        }
        ${this._viewMode == FrigateCardView.SNAPSHOTS ?
          html`<div class="frigate-card-gallery">
            ${until(this._renderEvents(), this._renderProgressIndicator())}
          </div>` : ``
        }
        ${this._viewMode == FrigateCardView.CLIP ?
          html`<div class="frigate-card-viewer">
            ${until(this._renderClipPlayer(), this._renderProgressIndicator())}
          </div>` : ``
        }
        ${this._viewMode == FrigateCardView.SNAPSHOT ?
          this._renderSnapshotViewer() : ``
        }
        ${this._renderStatusBar()}
        ${this._renderLiveViewer()}
      </div>`;
  }

  // private _handleAction(ev: ActionHandlerEvent): void {
  //   if (this.hass && this.config && ev.detail.action) {
  //     handleAction(this, this.hass, this.config, ev.detail.action);
  //   }
  // }

  private _showWarning(warning: string): TemplateResult {
    return html`
      <hui-warning> ${warning} </hui-warning>
        `;
  }

  private _showError(error: string): TemplateResult {
    const errorCard = document.createElement('hui-error-card');
    errorCard.setConfig({
      type: 'error',
      error,
      origConfig: this.config,
    });

    return html`
    ${errorCard}
    `;
  }

  static get styles(): CSSResult {
    // CSS is compiled from frigate-card.scss, so this is safe.
    return unsafeCSS(style);
  }

  static getCardSize(): number {
    return 5;
  }
}