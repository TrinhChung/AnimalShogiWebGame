import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'

import { createNativeBotBridge } from '../server/native_bot_bridge.mjs'
import {
  getBotObservation,
  getInitialState,
  initSync,
} from '../src/wasm/quantum_animal_shogi_wasm.js'

const wasmBytes = readFileSync(
  new URL('../src/wasm/quantum_animal_shogi_wasm_bg.wasm', import.meta.url),
)
initSync({ module: wasmBytes })

const { server, closeAll } = createNativeBotBridge()
server.listen(0, '127.0.0.1')
await once(server, 'listening')

try {
  const address = server.address()
  assert(address && typeof address === 'object')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const state = getInitialState()
  const observation = getBotObservation(state)
  const catalogResponse = await fetch(`${baseUrl}/api/bots`)
  const botCatalog = await catalogResponse.json()
  assert.equal(catalogResponse.status, 200)
  assert(botCatalog.length >= 3)

  for (const { id: botId } of botCatalog) {
    const response = await fetch(`${baseUrl}/api/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: `smoke-${botId}`,
        seat: 'player-one',
        botId,
        observation,
      }),
    })
    const result = await response.json()
    assert.equal(response.status, 200, result.error)
    assert(Number.isInteger(result.action))
    assert.equal(observation.actionMask[result.action], 1)

    await fetch(`${baseUrl}/api/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: `smoke-${botId}` }),
    })
    console.log(`${botId}: legal action ${result.action}`)
  }

  state.free()
} finally {
  closeAll()
  await new Promise((resolve) => server.close(resolve))
}
