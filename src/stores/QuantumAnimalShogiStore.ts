import { defineStore } from "pinia";
import { computed, nextTick, ref, shallowRef } from "vue";
import initializeWasm, {
  State as WasmState,
  draw as hasDraw,
  getAction,
  getBotObservation,
  getInitialState,
  getLegalActions,
  getNextState,
  getTurnedState,
  lost as hasLost,
  won as hasWon,
} from "@/wasm/quantum_animal_shogi_wasm";
import {
  decodeProtocolAction,
  encodeProtocolAction,
  packagedBots,
  type BotDefinition,
} from "@/game/bots";
import chickUrl from "@/assets/chick.bmp";
import chickenUrl from "@/assets/chicken.bmp";
import elephantUrl from "@/assets/elephant.bmp";
import giraffeUrl from "@/assets/giraffe.bmp";
import lionUrl from "@/assets/lion.bmp";

export type Action = [number, number];
export type GameMode = "human-vs-engine" | "engine-vs-engine";
type GameResult = "playing" | "player-one-win" | "player-two-win" | "draw";
type MachineMatchStatus = "idle" | "running" | "stopped";
type BotSeat = "player-one" | "player-two";

type StateSnapshot = {
  pieces: number[];
  ownership: number;
  bitBoards: number[];
  turn: number;
};

type MatchFinishStatus = "completed" | "stopped" | "failed";

const blankPiece = () => Array.from({ length: 7 }, () => 0);

function* getBits(value: number): Iterable<number> {
  let remaining = value;

  while (remaining) {
    yield 31 - Math.clz32(remaining & -remaining);
    remaining &= remaining - 1;
  }
}

const wait = (duration: number) =>
  new Promise((resolve) => window.setTimeout(resolve, duration));

const createSessionId = () => {
  const uniquePart =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `web-${uniquePart}`.replace(/[^a-zA-Z0-9._-]/g, "-");
};

export const useQuantumAnimalShogiStore = defineStore("state", () => {
  const state = shallowRef<WasmState | null>(null);
  const gameMode = ref<GameMode>("human-vs-engine");
  const humanBotId = ref("wasm-alpha-beta-4");
  const playerOneBotId = ref("alpha-beta-8");
  const playerTwoBotId = ref("uniform-random");
  const nativeBots = ref<BotDefinition[]>([]);
  const nativeBridgeAvailable = ref(false);
  const persistenceAvailable = ref(false);
  const persistenceError = ref("");
  const moveDelay = ref(350);
  const repeatCount = ref(1);
  const currentMatchNumber = ref(0);
  const completedMatchCount = ref(0);
  const playerOneWins = ref(0);
  const playerTwoWins = ref(0);
  const drawCount = ref(0);
  const isFirstPlayerTurn = ref(true);
  const isThinking = ref(false);
  const machineMatchStatus = ref<MachineMatchStatus>("idle");
  const gameResult = ref<GameResult>("playing");
  const reward = ref(0);
  const turn = ref(0);
  const action0 = ref<number | null>(null);
  const action1 = ref<number | null>(null);
  const animalImages = shallowRef<HTMLImageElement[] | null>(null);
  const initializationError = ref("");
  const botError = ref("");
  let machineMatchToken = 0;
  let botSessionId = createSessionId();
  let randomState = 0x4d595df4;
  let activeSeriesId: string | null = null;
  let activeMatchId: string | null = null;

  const botCatalog = computed(() => [...packagedBots, ...nativeBots.value]);

  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const image = new Image();

      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
      image.src = src;
    });
  };

  const loadNativeBots = async () => {
    try {
      const response = await fetch("/api/bots");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      nativeBots.value = (await response.json()) as BotDefinition[];
      nativeBridgeAvailable.value = true;
    } catch {
      nativeBots.value = [];
      nativeBridgeAvailable.value = false;
    }

    try {
      const response = await fetch("/api/health");
      const health = (await response.json()) as {
        database?: { connected?: boolean };
      };
      persistenceAvailable.value = Boolean(
        response.ok && health.database?.connected,
      );
      persistenceError.value = persistenceAvailable.value
        ? ""
        : "MySQL chưa được kết nối; ván đấu sẽ không được lưu.";
    } catch {
      persistenceAvailable.value = false;
      persistenceError.value =
        "MySQL chưa được kết nối; ván đấu sẽ không được lưu.";
    }
  };

  const initialize = async () => {
    try {
      const [, images] = await Promise.all([
        initializeWasm(),
        Promise.all(
          [chickUrl, giraffeUrl, elephantUrl, lionUrl, chickenUrl].map(
            loadImage,
          ),
        ),
      ]);
      animalImages.value = images;
      state.value = getInitialState();
      await loadNativeBots();
    } catch (error) {
      initializationError.value =
        error instanceof Error ? error.message : "Không thể khởi tạo trò chơi.";
    }
  };

  const setPieceState = (
    currentState: WasmState,
    pieceIndex: number,
    pieceState: number[],
  ) => {
    for (const bit of getBits(currentState.pieces[pieceIndex]!)) {
      pieceState[bit] = 1;
    }

    pieceState[5] = pieceIndex < 4 ? 1 : 0;
    pieceState[6] = currentState.ownership & (1 << pieceIndex) ? 1 : 0;
  };

  const getBoard = (currentState: WasmState | null) => {
    const result = Array.from({ length: 12 }, blankPiece);

    if (!currentState) {
      return result;
    }

    currentState.bitBoards.forEach((bitBoard, pieceIndex) => {
      if (bitBoard === 0) {
        return;
      }

      const square = 31 - Math.clz32(bitBoard & -bitBoard);
      setPieceState(currentState, pieceIndex, result[square]!);
    });

    return result;
  };

  const getHands = (currentState: WasmState | null, isAlly: boolean) => {
    const result = Array.from({ length: 8 }, blankPiece);

    if (!currentState) {
      return result;
    }

    let handIndex = 0;
    currentState.bitBoards.forEach((bitBoard, pieceIndex) => {
      const belongsToAlly = Boolean(currentState.ownership & (1 << pieceIndex));
      if (bitBoard !== 0 || belongsToAlly !== isAlly) {
        return;
      }

      setPieceState(currentState, pieceIndex, result[handIndex]!);
      handIndex += 1;
    });

    return result;
  };

  const playableState = computed(() => {
    if (!state.value) {
      return null;
    }

    return isFirstPlayerTurn.value ? state.value : getTurnedState(state.value);
  });

  const board = computed(() => getBoard(playableState.value));
  const allyHands = computed(() => getHands(playableState.value, true));
  const enemyHands = computed(() => getHands(playableState.value, false));
  const legalActions = computed<Action[]>(() => {
    if (
      !state.value ||
      gameMode.value !== "human-vs-engine" ||
      !isFirstPlayerTurn.value ||
      isThinking.value ||
      gameResult.value !== "playing"
    ) {
      return [];
    }

    return getLegalActions(state.value) as Action[];
  });
  const isReady = computed(() =>
    Boolean(state.value && animalImages.value && !initializationError.value),
  );
  const isMachineMatchRunning = computed(
    () => machineMatchStatus.value === "running",
  );
  const currentPlayerLabel = computed(() => {
    if (gameMode.value === "human-vs-engine") {
      return isFirstPlayerTurn.value ? "Bạn" : "Máy";
    }
    return isFirstPlayerTurn.value ? "Bot 1" : "Bot 2";
  });
  const seriesScoreText = computed(
    () =>
      `${playerOneWins.value} – ${playerTwoWins.value} (hòa ${drawCount.value})`,
  );
  const statusText = computed(() => {
    if (initializationError.value) {
      return initializationError.value;
    }
    if (botError.value) {
      return botError.value;
    }
    if (!state.value) {
      return "Đang tải engine…";
    }
    if (gameResult.value === "player-one-win") {
      return gameMode.value === "human-vs-engine"
        ? "Bạn thắng."
        : "Máy 1 thắng.";
    }
    if (gameResult.value === "player-two-win") {
      return gameMode.value === "human-vs-engine"
        ? "Máy thắng."
        : "Máy 2 thắng.";
    }
    if (gameResult.value === "draw") {
      return "Hòa.";
    }
    if (gameMode.value === "engine-vs-engine") {
      if (machineMatchStatus.value === "running") {
        return `${currentPlayerLabel.value} đang tính · ván ${currentMatchNumber.value}/${repeatCount.value}…`;
      }
      return machineMatchStatus.value === "stopped"
        ? "Trận đấu đã dừng."
        : "Sẵn sàng bắt đầu.";
    }
    if (isThinking.value) {
      return "Máy đang tính…";
    }
    return "Lượt của bạn.";
  });

  const findBot = (botId: string) =>
    botCatalog.value.find(({ id }) => id === botId);
  const botDescription = (botId: string) =>
    findBot(botId)?.description ?? "Bot không khả dụng.";

  const postJson = async <T>(url: string, body: unknown): Promise<T> => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = (await response.json()) as T & { error?: string };
    if (!response.ok) {
      throw new Error(
        result.error ?? `Yêu cầu lưu dữ liệu thất bại: HTTP ${response.status}`,
      );
    }
    return result;
  };

  const stateSnapshot = (currentState: WasmState): StateSnapshot => ({
    pieces: Array.from(currentState.pieces),
    ownership: currentState.ownership,
    bitBoards: Array.from(currentState.bitBoards),
    turn: currentState.turn,
  });

  const startPersistedSeries = async () => {
    if (!persistenceAvailable.value) {
      return;
    }
    const botOne = findBot(playerOneBotId.value);
    const botTwo = findBot(playerTwoBotId.value);
    if (!botOne || !botTwo) {
      throw new Error(
        "Không thể lưu series vì bot đã chọn không còn khả dụng.",
      );
    }
    const result = await postJson<{ id: string }>("/api/series/start", {
      botOne,
      botTwo,
      repeatCount: repeatCount.value,
      settings: {
        moveDelayMs: moveDelay.value,
        firstSeat: "player-one",
        rulesetVersion: "quantum-animal-shogi-v1",
      },
    });
    activeSeriesId = result.id;
  };

  const startPersistedMatch = async (gameIndex: number) => {
    if (!activeSeriesId) {
      return;
    }
    const result = await postJson<{ id: string }>("/api/matches/start", {
      seriesId: activeSeriesId,
      gameIndex,
      settings: {
        moveDelayMs: moveDelay.value,
        firstSeat: "player-one",
      },
    });
    activeMatchId = result.id;
  };

  const finishPersistedMatch = async (
    status: MatchFinishStatus,
    result: GameResult,
    errorMessage = "",
  ) => {
    const matchId = activeMatchId;
    activeMatchId = null;
    if (!matchId) {
      return;
    }
    await postJson(`/api/matches/${matchId}/finish`, {
      status,
      outcome: result === "playing" ? null : result,
      terminationReason: status === "completed" ? "game-end" : status,
      botOneReward:
        result === "player-one-win"
          ? 1
          : result === "player-two-win"
            ? -1
            : result === "draw"
              ? 0
              : null,
      botTwoReward:
        result === "player-two-win"
          ? 1
          : result === "player-one-win"
            ? -1
            : result === "draw"
              ? 0
              : null,
      errorMessage,
    });
  };

  const finishPersistedSeries = async (status: MatchFinishStatus) => {
    const seriesId = activeSeriesId;
    activeSeriesId = null;
    if (!seriesId) {
      return;
    }
    await postJson(`/api/series/${seriesId}/finish`, { status });
  };

  const recordPersistedMove = async (
    seat: BotSeat,
    action: Action,
    observation: ReturnType<typeof getBotObservation>,
    thinkTimeMs: number,
  ) => {
    if (!activeMatchId || !state.value) {
      return;
    }
    await postJson(`/api/matches/${activeMatchId}/moves`, {
      ply: turn.value,
      seat: seat === "player-one" ? 0 : 1,
      source: action[0],
      destination: action[1],
      protocolAction: encodeProtocolAction(action),
      thinkTimeMs,
      observation: observation.observation,
      actionMask: observation.actionMask,
      observationTurn: observation.turn,
      stateAfter: stateSnapshot(state.value),
      rewardAfter: reward.value,
      isTerminal: gameResult.value !== "playing",
    });
  };

  const updateResult = () => {
    if (!state.value) {
      return;
    }

    if (hasWon(state.value)) {
      gameResult.value = isFirstPlayerTurn.value
        ? "player-one-win"
        : "player-two-win";
    } else if (hasLost(state.value)) {
      gameResult.value = isFirstPlayerTurn.value
        ? "player-two-win"
        : "player-one-win";
    } else if (hasDraw(state.value)) {
      gameResult.value = "draw";
    }

    if (gameResult.value === "player-one-win") {
      reward.value = 1;
    } else if (gameResult.value === "player-two-win") {
      reward.value = -1;
    } else if (gameResult.value === "draw") {
      reward.value = -0.5;
    }
  };

  const step = async (action: Action) => {
    if (!state.value || gameResult.value !== "playing") {
      return;
    }

    state.value = getNextState(state.value, action);
    isFirstPlayerTurn.value = !isFirstPlayerTurn.value;
    turn.value += 1;
    updateResult();
    await nextTick();
  };

  const requestNativeAction = async (
    currentState: WasmState,
    bot: BotDefinition,
    seat: BotSeat,
    sessionId: string,
  ): Promise<Action> => {
    const response = await fetch("/api/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sessionId,
        seat,
        botId: bot.id,
        observation: getBotObservation(currentState),
      }),
    });
    const result = (await response.json()) as {
      action?: number;
      error?: string;
    };
    if (!response.ok || result.action === undefined) {
      throw new Error(result.error ?? `${bot.name} không trả về nước đi.`);
    }

    return decodeProtocolAction(result.action);
  };

  const selectBotAction = async (
    currentState: WasmState,
    botId: string,
    seat: BotSeat,
    sessionId: string,
  ): Promise<Action> => {
    const bot = findBot(botId);
    if (!bot) {
      throw new Error(`Bot không khả dụng: ${botId}`);
    }

    if (bot.kind === "native") {
      return requestNativeAction(currentState, bot, seat, sessionId);
    }

    if (bot.kind === "wasm-random") {
      const actions = getLegalActions(currentState) as Action[];
      if (actions.length === 0) {
        throw new Error(`${bot.name} không có nước hợp lệ.`);
      }
      randomState = (Math.imul(randomState, 1_664_525) + 1_013_904_223) >>> 0;
      return actions[randomState % actions.length]!;
    }

    return getAction(currentState, bot.depth ?? 4) as Action;
  };

  const playEngineTurn = async (botId: string, seat: BotSeat) => {
    if (!state.value || gameResult.value !== "playing") {
      return false;
    }

    const requestedState = state.value;
    const requestedSession = botSessionId;
    const observation = getBotObservation(requestedState);
    const thinkingStartedAt = performance.now();
    isThinking.value = true;
    botError.value = "";
    await nextTick();

    try {
      const action = await selectBotAction(
        requestedState,
        botId,
        seat,
        requestedSession,
      );
      if (state.value !== requestedState || botSessionId !== requestedSession) {
        return false;
      }

      const isLegal = (getLegalActions(requestedState) as Action[]).some(
        (candidate) => candidate[0] === action[0] && candidate[1] === action[1],
      );
      if (!isLegal) {
        throw new Error(
          `${findBot(botId)?.name ?? botId} trả về nước không hợp lệ.`,
        );
      }

      await step(action);
      await recordPersistedMove(
        seat,
        action,
        observation,
        Math.max(0, Math.round(performance.now() - thinkingStartedAt)),
      );
      return true;
    } catch (error) {
      if (botSessionId === requestedSession) {
        botError.value =
          error instanceof Error ? error.message : "Bot không thể chọn nước.";
        machineMatchStatus.value = "stopped";
      }
      return false;
    } finally {
      if (botSessionId === requestedSession) {
        isThinking.value = false;
      }
    }
  };

  const executeHumanAction = async () => {
    if (
      !state.value ||
      gameMode.value !== "human-vs-engine" ||
      !isFirstPlayerTurn.value ||
      isThinking.value ||
      action0.value === null ||
      action1.value === null
    ) {
      return;
    }

    const action: Action = [action0.value, action1.value];
    action0.value = null;
    action1.value = null;
    await step(action);

    if (gameResult.value !== "playing") {
      return;
    }

    await wait(120);
    await playEngineTurn(humanBotId.value, "player-two");
  };

  const rotateBotSession = () => {
    const expiredSession = botSessionId;
    botSessionId = createSessionId();
    if (nativeBridgeAvailable.value) {
      void fetch("/api/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: expiredSession }),
      }).catch(() => undefined);
    }
  };

  const stopMachineMatch = () => {
    machineMatchToken += 1;
    if (machineMatchStatus.value === "running") {
      machineMatchStatus.value = "stopped";
    }
    isThinking.value = false;
    rotateBotSession();

    void (async () => {
      try {
        await finishPersistedMatch("stopped", gameResult.value);
        await finishPersistedSeries("stopped");
      } catch (error) {
        persistenceError.value =
          error instanceof Error
            ? error.message
            : "Không thể cập nhật ván đã dừng vào MySQL.";
      }
    })();
  };

  const resetGameState = () => {
    action0.value = null;
    action1.value = null;
    isFirstPlayerTurn.value = true;
    gameResult.value = "playing";
    botError.value = "";
    reward.value = 0;
    turn.value = 0;
    randomState = 0x4d595df4;

    if (isReady.value) {
      state.value = getInitialState();
    }
  };

  const resetSeriesStats = () => {
    currentMatchNumber.value = 0;
    completedMatchCount.value = 0;
    playerOneWins.value = 0;
    playerTwoWins.value = 0;
    drawCount.value = 0;
  };

  const reset = () => {
    stopMachineMatch();
    resetGameState();
    resetSeriesStats();
    machineMatchStatus.value = "idle";
  };

  const setGameMode = (mode: GameMode) => {
    if (gameMode.value === mode) {
      return;
    }

    gameMode.value = mode;
    reset();
  };

  const startMachineMatch = async () => {
    if (!isReady.value || gameMode.value !== "engine-vs-engine") {
      return;
    }

    stopMachineMatch();
    resetGameState();
    resetSeriesStats();
    repeatCount.value = Math.max(
      1,
      Math.min(500, Math.trunc(repeatCount.value || 1)),
    );
    machineMatchStatus.value = "running";
    const token = ++machineMatchToken;

    try {
      await startPersistedSeries();

      for (let gameIndex = 1; gameIndex <= repeatCount.value; gameIndex += 1) {
        if (token !== machineMatchToken) {
          return;
        }
        if (gameIndex > 1) {
          rotateBotSession();
          resetGameState();
        }
        currentMatchNumber.value = gameIndex;
        await startPersistedMatch(gameIndex);

        while (token === machineMatchToken && gameResult.value === "playing") {
          await wait(moveDelay.value);
          if (token !== machineMatchToken) {
            return;
          }

          const played = isFirstPlayerTurn.value
            ? await playEngineTurn(playerOneBotId.value, "player-one")
            : await playEngineTurn(playerTwoBotId.value, "player-two");
          if (!played) {
            if (token === machineMatchToken) {
              await finishPersistedMatch(
                "failed",
                gameResult.value,
                botError.value,
              );
              await finishPersistedSeries("failed");
              machineMatchStatus.value = "stopped";
            }
            return;
          }
        }

        if (token !== machineMatchToken) {
          return;
        }
        await finishPersistedMatch("completed", gameResult.value);
        completedMatchCount.value += 1;
        if (gameResult.value === "player-one-win") {
          playerOneWins.value += 1;
        } else if (gameResult.value === "player-two-win") {
          playerTwoWins.value += 1;
        } else {
          drawCount.value += 1;
        }
      }

      await finishPersistedSeries("completed");
      if (token === machineMatchToken) {
        machineMatchStatus.value = "idle";
      }
    } catch (error) {
      if (token !== machineMatchToken) {
        return;
      }
      botError.value =
        error instanceof Error ? error.message : "Không thể chạy chuỗi trận.";
      machineMatchStatus.value = "stopped";
      try {
        await finishPersistedMatch("failed", gameResult.value, botError.value);
        await finishPersistedSeries("failed");
      } catch (persistenceFailure) {
        persistenceError.value =
          persistenceFailure instanceof Error
            ? persistenceFailure.message
            : "Không thể cập nhật lỗi vào MySQL.";
      }
    }
  };

  return {
    action0,
    action1,
    allyHands,
    animalImages,
    board,
    botCatalog,
    botDescription,
    botError,
    completedMatchCount,
    currentMatchNumber,
    currentPlayerLabel,
    drawCount,
    enemyHands,
    executeHumanAction,
    gameMode,
    gameResult,
    humanBotId,
    initialize,
    initializationError,
    isFirstPlayerTurn,
    isMachineMatchRunning,
    isReady,
    isThinking,
    legalActions,
    loadNativeBots,
    moveDelay,
    nativeBridgeAvailable,
    persistenceAvailable,
    persistenceError,
    playerOneWins,
    playerOneBotId,
    playerTwoWins,
    playerTwoBotId,
    repeatCount,
    reset,
    reward,
    setGameMode,
    startMachineMatch,
    statusText,
    stopMachineMatch,
    seriesScoreText,
    turn,
  };
});
