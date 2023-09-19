const { LitElement, html, css } = require('lit')
const { openURL } = require('./components/common')
const { hideCurrentModal, showModal } = require('../globalState')

class PauseScreen extends LitElement {
  static get styles () {
    return css`
      .bg {
        position: absolute;
        top: 0;
        left: 0;
        background: rgba(0, 0, 0, 0.75);
        width: 100%;
        height: 100%;
      }

      .title {
        position: absolute;
        top: 40px;
        left: 50%;
        transform: translate(-50%);
        font-size: 10px;
        color: white;
        text-shadow: 1px 1px #222;
      }

      main {
        display: flex;
        flex-direction: column;
        gap: 4px 0;
        position: absolute;
        left: 50%;
        width: 204px;
        top: calc(25% + 48px - 16px);
        transform: translate(-50%);
      }

      .row {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        width: 100%;
      }
    `
  }

  constructor () {
    super()
  }

  render () {
    return html`
      <div class="bg"></div>

      <p class="title">Game Menu</p>

      <main>
        <pmui-button pmui-width="204px" pmui-label="Back to Game" @pmui-click=${this.onReturnPress}></pmui-button>
        <div class="row">
          <pmui-button pmui-width="98px" pmui-label="Github" @pmui-click=${() => openURL(process.env.GITHUB_URL)}></pmui-button>
          <pmui-button pmui-width="98px" pmui-label="Discord" @pmui-click=${() => openURL('https://discord.gg/4Ucm684Fq3')}></pmui-button>
        </div>
        <pmui-button pmui-width="204px" pmui-label="Options" @pmui-click=${() => showModal(document.getElementById('options-screen'))}></pmui-button>
        <pmui-button pmui-width="204px" pmui-label="Disconnect" @pmui-click=${() => {
      bot._client.emit('end')
        // window.location.search = ''
        // window.location.reload()
      }}></pmui-button>
      </main>
    `
  }

  show () {
    this.focus()
    // todo?
    notification.show = false
  }

  onReturnPress () {
    hideCurrentModal()
  }
}

window.customElements.define('pmui-pausescreen', PauseScreen)
