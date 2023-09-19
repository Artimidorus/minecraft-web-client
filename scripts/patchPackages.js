//@ts-check
const path = require('path')
const dataPath = path.join(require.resolve('minecraft-data'), '../data.js')

const fs = require('fs')

const lines = fs.readFileSync(dataPath, 'utf8').split('\n')

function removeLinesBetween (start, end) {
  let startIndex = lines.findIndex(line => line === start)
  if (startIndex === -1) return
  let endIndex = startIndex + lines.slice(startIndex).findIndex(line => line === end)
  const linesToRemove = endIndex - startIndex + 1
  lines.splice(startIndex, linesToRemove)
}

// todo removing bedrock support for now, will optiimze in future instead
removeLinesBetween("  'bedrock': {", '  }')

fs.writeFileSync(dataPath, lines.join('\n'), 'utf8')
