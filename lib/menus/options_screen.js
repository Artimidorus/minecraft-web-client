const { LitElement, html, css } = require('lit')
const { commonCss, isMobile } = require('./components/common')
const { showModal, hideCurrentModal } = require('../globalState')
const { CommonOptionsScreen } = require('./options_store')
const { toNumber } = require('../utils')

class OptionsScreen extends CommonOptionsScreen {
  static get styles () {
    return css`
      ${commonCss}
      .title {
        top: 4px;
      }

      main {
        display: flex;
        flex-direction: column;
        position: absolute;
        top: calc(100% / 6 - 6px);
        left: 50%;
        width: 310px;
        gap: 4px 0;
        place-items: center;
        place-content: center;
        transform: translate(-50%);
      }

      .wrapper {
        display: flex;
        flex-direction: row;
        width: 100%;
        gap: 0 10px;
        height: 20px;
      }
    `
  }

  static get properties () {
    return {
      isInsideWorld: { type: Boolean },
      mouseSensX: { type: Number },
      mouseSensY: { type: Number },
      chatWidth: { type: Number },
      chatHeight: { type: Number },
      chatScale: { type: Number },
      sound: { type: Number },
      renderDistance: { type: Number },
      fov: { type: Number },
      guiScale: { type: Number }
    }
  }

  constructor () {
    super()
    this.isInsideWorld = false

    this.defineOptions({
      mouseSensX: { defaultValue: 50, convertFn: (v) => Math.floor(toNumber(v)) },
      mouseSensY: { defaultValue: 50, convertFn: (v) => Math.floor(toNumber(v)) },
      chatWidth: { defaultValue: 320, convertFn: (v) => toNumber(v) },
      chatHeight: { defaultValue: 180, convertFn: (v) => toNumber(v) },
      chatScale: { defaultValue: 100, convertFn: (v) => toNumber(v) },
      sound: { defaultValue: 50, convertFn: (v) => toNumber(v) },
      renderDistance: { defaultValue: 6, convertFn: (v) => toNumber(v) },
      fov: { defaultValue: 75, convertFn: (v) => toNumber(v) },
      guiScale: { defaultValue: 3, convertFn: (v) => toNumber(v) },
      mouseRawInput: { defaultValue: false, convertFn: (v) => v === 'true' },
      autoFullscreen: { defaultValue: false, convertFn: (v) => v === 'true' }
    })

    document.documentElement.style.setProperty('--chatScale', `${this.chatScale / 100}`)
    document.documentElement.style.setProperty('--chatWidth', `${this.chatWidth}px`)
    document.documentElement.style.setProperty('--chatHeight', `${this.chatHeight}px`)
    document.documentElement.style.setProperty('--guiScale', `${this.guiScale}`)
  }

  render () {
    return html`
      <div class="${this.isInsideWorld ? 'bg' : 'dirt-bg'}"></div>

      <p class="title">Options</p>

      <main>
        <div class="wrapper">
          <pmui-slider pmui-label="Mouse Sensitivity X" pmui-value="${this.mouseSensX}" pmui-min="1" pmui-max="100" @input=${(e) => {
        this.changeOption('mouseSensX', e.target.value)
      }}></pmui-slider>
          <pmui-slider pmui-label="Mouse Sensitivity Y" pmui-value="${this.mouseSensY}" pmui-min="1" pmui-max="100" @input=${(e) => {
        this.changeOption('mouseSensY', e.target.value)
      }}></pmui-slider>
        </div>
        <div class="wrapper">
          <pmui-slider pmui-label="Chat Width" pmui-value="${this.chatWidth}" pmui-min="0" pmui-max="320" pmui-type="px" @input=${(e) => {
        this.changeOption('chatWidth', e.target.value)
        document.documentElement.style.setProperty('--chatWidth', `${this.chatWidth}px`)
      }}></pmui-slider>
          <pmui-slider pmui-label="Chat Height" pmui-value="${this.chatHeight}" pmui-min="0" pmui-max="180" pmui-type="px" @input=${(e) => {
        this.changeOption('chatHeight', e.target.value)
        document.documentElement.style.setProperty('--chatHeight', `${this.chatHeight}px`)
      }}></pmui-slider>
        </div>
        <div class="wrapper">
          <pmui-slider pmui-label="Chat Scale" pmui-value="${this.chatScale}" pmui-min="0" pmui-max="100" @input=${(e) => {
        this.changeOption('chatScale', e.target.value)
        document.documentElement.style.setProperty('--chatScale', `${this.chatScale / 100}`)
      }}></pmui-slider>
          <pmui-slider pmui-label="Sound Volume" pmui-value="${this.sound}" pmui-min="0" pmui-max="100" @input=${(e) => {
        this.changeOption('sound', e.target.value)
      }}></pmui-slider>
        </div>
        <div class="wrapper">
          <pmui-button pmui-width="150px" pmui-label="Key Binds" @pmui-click=${() => showModal(document.getElementById('keybinds-screen'))}></pmui-button>
          <pmui-slider pmui-label="Gui Scale" pmui-value="${this.guiScale}" pmui-min="1" pmui-max="4" pmui-type="" @change=${(e) => {
        this.changeOption('guiScale', e.target.value)
        document.documentElement.style.setProperty('--guiScale', `${this.guiScale}`)
      }}></pmui-slider>
        </div>
        <div class="wrapper">
          <pmui-slider pmui-label="Render Distance" pmui-value="${this.renderDistance}" .disabled="${this.isInsideWorld ? 'Can be changed only from main menu for now' : undefined}" pmui-min="2" pmui-max="6" pmui-type=" chunks" @input=${(e) => {
        this.changeOption('renderDistance', e.target.value)
      }}></pmui-slider>
        <pmui-slider pmui-label="Field of View" pmui-value="${this.fov}" pmui-min="30" pmui-max="110" pmui-type="" @input=${(e) => {
        this.changeOption('fov', e.target.value)

        this.dispatchEvent(new window.CustomEvent('fov_changed', { detail: { fov: this.fov }, }))
      }}></pmui-slider>
      </div>

        <div class="wrapper">
          <pmui-button pmui-width="150px" pmui-label=${'Advanced'} @pmui-click=${() => {
        showModal(document.querySelector('pmui-advanced-optionsscreen'))
      }
      }></pmui-button>
          <pmui-button pmui-width="150px" pmui-label=${'Mouse Raw Input: ' + (this.mouseRawInput ? 'ON' : 'OFF')} title="Wether to disable any mouse acceleration (MC does it by default)" @pmui-click=${() => {
        this.changeOption('mouseRawInput', !this.mouseRawInput)

        this.requestUpdate()
      }
      }></pmui-button>
        </div>
        <div class="wrapper">
          <pmui-button title="Auto Fullscreen allows you to use Ctrl+W and Escape without delays" .disabled="${!navigator['keyboard'] ? "Your browser doesn't support keyboard lock API" : undefined}" pmui-width="150px" pmui-label=${'Auto Fullscreen: ' + (this.autoFullscreen ? 'ON' : 'OFF')} title="Wether to disable any mouse acceleration (MC does it by default)" @pmui-click=${() => {
        this.changeOption('autoFullscreen', !this.autoFullscreen)

        this.requestUpdate()
      }
      }></pmui-button>
        </div>

        <pmui-button pmui-width="200px" pmui-label="Done" @pmui-click=${() => hideCurrentModal()}></pmui-button>
      </main>
    `
  }
}

window.customElements.define('pmui-optionsscreen', OptionsScreen)
