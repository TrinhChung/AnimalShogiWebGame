import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  draw,
  getAction,
  getInitialState,
  getLegalActions,
  getNextState,
  initSync,
  lost,
  won,
} from '../src/wasm/quantum_animal_shogi_wasm.js'

const wasmBytes = readFileSync(
  new URL('../src/wasm/quantum_animal_shogi_wasm_bg.wasm', import.meta.url),
)
initSync({ module: wasmBytes })

const isTerminal = (state) => won(state) || lost(state) || draw(state)
const assertLegal = (state, action) => {
  assert(
    getLegalActions(state).some(
      (legalAction) => legalAction[0] === action[0] && legalAction[1] === action[1],
    ),
    `Expected [${action.join(', ')}] to be legal`,
  )
}

const advance = (state, action) => {
  const nextState = getNextState(state, action)
  state.free()
  return nextState
}

let humanMatchState = getInitialState()
const humanAction = getLegalActions(humanMatchState)[0]
assert(humanAction, 'The human must have an opening move')
humanMatchState = advance(humanMatchState, humanAction)
assert.equal(humanMatchState.turn, 1)

const reply = getAction(humanMatchState, 2)
assertLegal(humanMatchState, reply)
humanMatchState = advance(humanMatchState, reply)
assert.equal(humanMatchState.turn, 2)
humanMatchState.free()

let engineMatchState = getInitialState()
for (let turn = 0; turn < 6 && !isTerminal(engineMatchState); turn += 1) {
  const action = getAction(engineMatchState, turn % 2 === 0 ? 1 : 2)
  assertLegal(engineMatchState, action)
  engineMatchState = advance(engineMatchState, action)
}

assert(engineMatchState.turn >= 2, 'The engine match must advance both sides')
engineMatchState.free()

console.log('Web solo smoke test passed: human-engine and engine-engine flows are legal.')
