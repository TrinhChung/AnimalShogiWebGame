/* tslint:disable */
/* eslint-disable */
export interface BotObservation {
    observation: number[][];
    actionMask: number[];
    turn: number;
}

export type Action = [number, number];


export class State {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly bitBoards: Uint16Array;
    readonly ownership: number;
    readonly pieces: Uint8Array;
    readonly turn: number;
}

export function draw(state: State): boolean;

export function getAction(state: State, depth: number): Action;

export function getBotObservation(state: State): BotObservation;

export function getInitialState(): State;

export function getLegalActions(state: State): Action[];

export function getNextState(state: State, action: Action): State;

export function getTurnedState(state: State): State;

export function lost(state: State): boolean;

export function won(state: State): boolean;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_state_free: (a: number, b: number) => void;
    readonly draw: (a: number) => number;
    readonly getAction: (a: number, b: number) => any;
    readonly getBotObservation: (a: number) => any;
    readonly getInitialState: () => number;
    readonly getLegalActions: (a: number) => [number, number];
    readonly getNextState: (a: number, b: any) => number;
    readonly getTurnedState: (a: number) => number;
    readonly lost: (a: number) => number;
    readonly state_bitBoards: (a: number) => [number, number];
    readonly state_ownership: (a: number) => number;
    readonly state_pieces: (a: number) => [number, number];
    readonly state_turn: (a: number) => number;
    readonly won: (a: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
