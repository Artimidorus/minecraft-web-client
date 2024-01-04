// this should actually be moved to mineflayer / prismarine-viewer

import { fromFormattedString } from '@xmcl/text-component'

export type MessageFormatPart = {
  text: string
  color?: string
  bold?: boolean
  italic?: boolean
  underlined?: boolean
  strikethrough?: boolean
  obfuscated?: boolean
}

type MessageInput = {
  text?: string
  translate?: string
  with?: Array<MessageInput | string>
  color?: string
  bold?: boolean
  italic?: boolean
  underlined?: boolean
  strikethrough?: boolean
  obfuscated?: boolean
  extra?: MessageInput[]
  json?: any
}

// todo move to sign-renderer, replace with prismarine-chat
export const formatMessage = (message: MessageInput) => {
  let msglist: MessageFormatPart[] = []

  const readMsg = (msg: MessageInput) => {
    const styles = {
      color: msg.color,
      bold: !!msg.bold,
      italic: !!msg.italic,
      underlined: !!msg.underlined,
      strikethrough: !!msg.strikethrough,
      obfuscated: !!msg.obfuscated
    }

    if (msg.text) {
      msglist.push({
        ...msg,
        text: msg.text,
        ...styles
      })
    } else if (msg.translate) {
      const tText = window.loadedData.language[msg.translate] ?? msg.translate

      if (msg.with) {
        const splitted = tText.split(/%s|%\d+\$s/g)

        let i = 0
        for (const [j, part] of splitted.entries()) {
          msglist.push({ text: part, ...styles })

          if (j + 1 < splitted.length) {
            if (msg.with[i]) {
              const msgWith = msg.with[i]
              if (typeof msgWith === 'string') {
                readMsg({
                  ...styles,
                  text: msgWith
                })
              } else {
                readMsg({
                  ...styles,
                  ...msgWith
                })
              }
            }
            i++
          }
        }
      } else {
        msglist.push({
          ...msg,
          text: tText,
          ...styles
        })
      }
    }

    if (msg.extra) {
      for (const ex of msg.extra) {
        readMsg({ ...styles, ...ex })
      }
    }
  }

  readMsg(message)

  const flat = (msg) => {
    return [msg, msg.extra?.flatMap(flat) ?? []]
  }

  msglist = msglist.map(msg => {
    // normalize §
    if (!msg.text.includes('§')) return msg
    const newMsg = fromFormattedString(msg.text)
    return flat(newMsg)
  }).flat(Infinity)

  return msglist
}
