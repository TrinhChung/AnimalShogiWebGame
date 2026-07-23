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
  localHumanParticipant,
  packagedBots,
  type BotDefinition,
} from "@/game/bots";
import {
  actorRewardForOutcome,
  trajectoryContract,
} from "@/game/trajectory_contract.mjs";
import { selectPairingWinner } from "@/game/seeded_tournament.mjs";
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
type TerminalReason = "try" | "catch" | "max-turn-draw";

type BotRating = {
  botId: string;
  name: string;
  version: string;
  versionKey: string;
  rank: number;
  rating: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
};

type TournamentEntry = {
  entryId: string;
  botId: string;
  name: string;
  version: string;
  versionKey: string;
  rating: number;
  seed: number;
  seedGroup: number;
  seedRating: number;
  status: "active" | "eliminated" | "champion";
};

type TournamentPairing = {
  pairingId: string;
  pairingIndex: number;
  entryOneId: string;
  entryTwoId: string | null;
  winnerEntryId: string | null;
  status: "running" | "completed";
  advanceReason: "bye" | null;
};

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
  const gamesPerPairing = ref(2);
  const currentMatchNumber = ref(0);
  const completedMatchCount = ref(0);
  const playerOneWins = ref(0);
  const playerTwoWins = ref(0);
  const drawCount = ref(0);
  const isFirstPlayerTurn = ref(true);
  const isThinking = ref(false);
  const machineMatchStatus = ref<MachineMatchStatus>("idle");
  const gameResult = ref<GameResult>("playing");
  const terminalReason = ref<TerminalReason | null>(null);
  const reward = ref(0);
  const turn = ref(0);
  const action0 = ref<number | null>(null);
  const action1 = ref<number | null>(null);
  const animalImages = shallowRef<HTMLImageElement[] | null>(null);
  const initializationError = ref("");
  const botError = ref("");
  const botRatings = ref<BotRating[]>([]);
  const tournamentEntries = ref<TournamentEntry[]>([]);
  const tournamentRound = ref(0);
  const currentPairingNumber = ref(0);
  const totalPairingsInRound = ref(0);
  const currentPairingScoreOne = ref(0);
  const currentPairingScoreTwo = ref(0);
  const championEntryId = ref<string | null>(null);
  let machineMatchToken = 0;
  let botSessionId = createSessionId();
  const createRandomSeed = () => {
    const seed = new Uint32Array(1);
    globalThis.crypto.getRandomValues(seed);
    return seed[0]!;
  };
  let activeRandomSeed = createRandomSeed();
  let randomState = activeRandomSeed;
  let activeSeriesId: string | null = null;
  let activeMatchId: string | null = null;
  let activeTournamentId: string | null = null;

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

    if (persistenceAvailable.value) {
      try {
        await refreshBotRatings(true);
      } catch (error) {
        persistenceAvailable.value = false;
        persistenceError.value =
          error instanceof Error
            ? error.message
            : "Không thể đồng bộ bảng Elo với MySQL.";
      }
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
    const botId = isFirstPlayerTurn.value
      ? playerOneBotId.value
      : playerTwoBotId.value;
    return (
      findBot(botId)?.name ?? (isFirstPlayerTurn.value ? "Bot 1" : "Bot 2")
    );
  });
  const seriesScoreText = computed(
    () =>
      `${playerOneWins.value} – ${playerTwoWins.value} (hòa ${drawCount.value})`,
  );
  const championName = computed(() => {
    const champion = tournamentEntries.value.find(
      ({ entryId }) => entryId === championEntryId.value,
    );
    return champion?.name ?? "";
  });
  const tournamentStandings = computed(() =>
    tournamentEntries.value.map((entry) => {
      const liveRating = botRatings.value.find(
        ({ versionKey }) => versionKey === entry.versionKey,
      );
      return {
        ...entry,
        liveRating: liveRating?.rating ?? entry.rating,
      };
    }),
  );
  const seedTableRows = computed(() => {
    if (tournamentStandings.value.length > 0) {
      return tournamentStandings.value;
    }
    const groupCount = Math.min(4, botRatings.value.length);
    return botRatings.value.map((rating, index) => ({
      entryId: rating.versionKey,
      botId: rating.botId,
      name: rating.name,
      version: rating.version,
      versionKey: rating.versionKey,
      rating: rating.rating,
      seed: index + 1,
      seedGroup: Math.floor((index * groupCount) / botRatings.value.length) + 1,
      seedRating: rating.rating,
      liveRating: rating.rating,
      status: "preview" as const,
    }));
  });
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
        : `${findBot(playerOneBotId.value)?.name ?? "Bot 1"} thắng ván.`;
    }
    if (gameResult.value === "player-two-win") {
      return gameMode.value === "human-vs-engine"
        ? "Máy thắng."
        : `${findBot(playerTwoBotId.value)?.name ?? "Bot 2"} thắng ván.`;
    }
    if (gameResult.value === "draw") {
      return "Hòa.";
    }
    if (gameMode.value === "engine-vs-engine") {
      if (machineMatchStatus.value === "running") {
        return `${currentPlayerLabel.value} đang tính · vòng ${tournamentRound.value}, cặp ${currentPairingNumber.value}/${totalPairingsInRound.value}, ván ${currentMatchNumber.value}/${gamesPerPairing.value}…`;
      }
      if (championName.value) {
        return `Nhà vô địch: ${championName.value}.`;
      }
      return machineMatchStatus.value === "stopped"
        ? "Giải đấu đã dừng."
        : "Sẵn sàng xếp hạt giống theo Elo.";
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

  const refreshBotRatings = async (registerCatalog = false) => {
    const response = registerCatalog
      ? await postJson<BotRating[]>("/api/ratings/register", {
          bots: botCatalog.value,
        })
      : await fetch("/api/ratings", { cache: "no-store" }).then(
          async (ratingResponse) => {
            const result = (await ratingResponse.json()) as BotRating[] & {
              error?: string;
            };
            if (!ratingResponse.ok) {
              throw new Error(
                result.error ??
                  `Không thể tải Elo: HTTP ${ratingResponse.status}`,
              );
            }
            return result;
          },
        );
    const availableVersions = new Set(
      botCatalog.value.map(({ versionKey }) => versionKey),
    );
    botRatings.value = response.filter(({ versionKey }) =>
      availableVersions.has(versionKey),
    );
  };

  const stateSnapshot = (currentState: WasmState): StateSnapshot => ({
    pieces: Array.from(currentState.pieces),
    ownership: currentState.ownership,
    bitBoards: Array.from(currentState.bitBoards),
    turn: currentState.turn,
  });

  const startPersistedSeries = async (
    tournamentPairingId: string,
    tournamentGameIndex: number,
  ) => {
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
      repeatCount: 1,
      mode: "engine-vs-engine",
      firstSeat: 0,
      tournamentPairingId,
      tournamentGameIndex,
      settings: {
        moveDelayMs: moveDelay.value,
        firstSeat: "player-one",
        rulesetVersion: "quantum-animal-shogi-v1",
        tournamentRound: tournamentRound.value,
      },
    });
    activeSeriesId = result.id;
  };

  const startHumanPersistedSeries = async () => {
    if (!persistenceAvailable.value || activeSeriesId) {
      return;
    }
    const bot = findBot(humanBotId.value);
    if (!bot) {
      throw new Error("Không thể lưu ván vì bot đã chọn không còn khả dụng.");
    }
    const result = await postJson<{ id: string }>("/api/series/start", {
      botOne: localHumanParticipant,
      botTwo: bot,
      repeatCount: 1,
      mode: "human-vs-engine",
      firstSeat: 0,
      settings: {
        firstSeat: "player-one",
        rulesetVersion: trajectoryContract.rulesetVersion,
        personalDataStored: false,
      },
    });
    activeSeriesId = result.id;
  };

  const startPersistedMatch = async (
    gameIndex: number,
    dataSource: "web-tournament" | "web-human",
  ) => {
    if (!activeSeriesId || !state.value) {
      return;
    }
    const result = await postJson<{ id: string }>("/api/matches/start", {
      seriesId: activeSeriesId,
      gameIndex,
      settings: {
        moveDelayMs: moveDelay.value,
        firstSeat: "player-one",
      },
      trajectory: {
        ...trajectoryContract,
        dataSource,
        recorderBuildDigest: __QAS_WEB_BUILD_SHA256__,
        rulesetDigest: __QAS_WASM_SHA256__,
        rngSeed: activeRandomSeed,
        initialState: stateSnapshot(state.value),
      },
    });
    activeMatchId = result.id;
  };

  const finishMatchById = async (
    matchId: string,
    status: MatchFinishStatus,
    result: GameResult,
    errorMessage = "",
  ) => {
    await postJson(`/api/matches/${matchId}/finish`, {
      status,
      outcome: result === "playing" ? null : result,
      terminationReason: status === "completed" ? terminalReason.value : status,
      errorMessage,
    });
  };

  const finishPersistedMatch = async (
    status: MatchFinishStatus,
    result: GameResult,
    errorMessage = "",
  ) => {
    const matchId = activeMatchId;
    activeMatchId = null;
    if (matchId) {
      await finishMatchById(matchId, status, result, errorMessage);
    }
  };

  const finishSeriesById = async (
    seriesId: string,
    status: MatchFinishStatus,
  ) => {
    await postJson(`/api/series/${seriesId}/finish`, { status });
  };

  const finishPersistedSeries = async (status: MatchFinishStatus) => {
    const seriesId = activeSeriesId;
    activeSeriesId = null;
    if (seriesId) {
      await finishSeriesById(seriesId, status);
    }
  };

  const recordPersistedMove = async (
    seat: BotSeat,
    action: Action,
    observation: ReturnType<typeof getBotObservation>,
    stateBefore: StateSnapshot,
    thinkTimeMs: number | null,
    actor: BotDefinition,
  ) => {
    if (!activeMatchId || !state.value) {
      return;
    }
    const seatIndex = seat === "player-one" ? 0 : 1;
    const outcomeAfter =
      gameResult.value === "playing" ? null : gameResult.value;
    await postJson(`/api/matches/${activeMatchId}/moves`, {
      ply: turn.value,
      seat: seatIndex,
      source: action[0],
      destination: action[1],
      protocolAction: encodeProtocolAction(action),
      thinkTimeMs,
      observation: observation.observation,
      actionMask: observation.actionMask,
      observationTurn: observation.turn,
      stateBefore,
      stateAfter: stateSnapshot(state.value),
      rewardAfter: actorRewardForOutcome(seatIndex, outcomeAfter),
      rewardPerspective: "actor",
      outcomeAfter,
      isTerminal: outcomeAfter !== null,
      terminalReasonKey: terminalReason.value,
      actorKind: actor.kind,
      policyMetadata: {
        botId: actor.id,
        versionKey: actor.versionKey,
        policyKey: actor.policyKey,
        depth: actor.depth ?? null,
        decisionStatsAvailable: false,
      },
      qualityFlags: [],
    });
  };

  const updateResult = () => {
    if (!state.value) {
      return;
    }

    if (hasWon(state.value)) {
      terminalReason.value = "try";
      gameResult.value = isFirstPlayerTurn.value
        ? "player-one-win"
        : "player-two-win";
    } else if (hasLost(state.value)) {
      terminalReason.value = "catch";
      gameResult.value = isFirstPlayerTurn.value
        ? "player-two-win"
        : "player-one-win";
    } else if (hasDraw(state.value)) {
      terminalReason.value = "max-turn-draw";
      gameResult.value = "draw";
    }

    if (gameResult.value === "player-one-win") {
      reward.value = 1;
    } else if (gameResult.value === "player-two-win") {
      reward.value = -1;
    } else if (gameResult.value === "draw") {
      reward.value = 0;
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
    const stateBefore = stateSnapshot(requestedState);
    const actor = findBot(botId);
    if (!actor) {
      throw new Error(`Bot không khả dụng: ${botId}`);
    }
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
        stateBefore,
        Math.max(0, Math.round(performance.now() - thinkingStartedAt)),
        actor,
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
    const requestedState = state.value;
    const observation = getBotObservation(requestedState);
    const stateBefore = stateSnapshot(requestedState);
    action0.value = null;
    action1.value = null;
    try {
      await startHumanPersistedSeries();
      if (activeSeriesId && !activeMatchId) {
        await startPersistedMatch(1, "web-human");
      }
    } catch (error) {
      persistenceError.value =
        error instanceof Error
          ? error.message
          : "Không thể bắt đầu lưu trajectory Người–Máy.";
      if (activeSeriesId && !activeMatchId) {
        try {
          await finishPersistedSeries("failed");
        } catch {
          activeSeriesId = null;
        }
      }
    }
    await step(action);
    try {
      await recordPersistedMove(
        "player-one",
        action,
        observation,
        stateBefore,
        null,
        localHumanParticipant,
      );
    } catch (error) {
      persistenceError.value =
        error instanceof Error
          ? error.message
          : "Không thể lưu nước đi của người chơi.";
      await finishPersistedMatch(
        "failed",
        gameResult.value,
        persistenceError.value,
      );
      await finishPersistedSeries("failed");
    }

    if (gameResult.value !== "playing") {
      await finishPersistedMatch("completed", gameResult.value);
      await finishPersistedSeries("completed");
      return;
    }

    await wait(120);
    const played = await playEngineTurn(humanBotId.value, "player-two");
    if (!played) {
      await finishPersistedMatch(
        "failed",
        gameResult.value,
        botError.value || "Bot không thể hoàn tất nước đi.",
      );
      await finishPersistedSeries("failed");
      return;
    }
    if (gameResult.value !== "playing") {
      await finishPersistedMatch("completed", gameResult.value);
      await finishPersistedSeries("completed");
    }
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
    const stoppedMatchId = activeMatchId;
    const stoppedSeriesId = activeSeriesId;
    const stoppedTournamentId = activeTournamentId;
    activeMatchId = null;
    activeSeriesId = null;
    activeTournamentId = null;

    void (async () => {
      try {
        if (stoppedMatchId) {
          await finishMatchById(stoppedMatchId, "stopped", gameResult.value);
        }
        if (stoppedSeriesId) {
          await finishSeriesById(stoppedSeriesId, "stopped");
        }
        if (stoppedTournamentId) {
          await postJson(`/api/tournaments/${stoppedTournamentId}/stop`, {});
        }
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
    terminalReason.value = null;
    botError.value = "";
    reward.value = 0;
    turn.value = 0;
    activeRandomSeed = createRandomSeed();
    randomState = activeRandomSeed;

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
    tournamentEntries.value = [];
    tournamentRound.value = 0;
    currentPairingNumber.value = 0;
    totalPairingsInRound.value = 0;
    currentPairingScoreOne.value = 0;
    currentPairingScoreTwo.value = 0;
    championEntryId.value = null;
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

  const playTournamentGame = async (
    token: number,
    pairingId: string,
    gameIndex: number,
  ) => {
    rotateBotSession();
    resetGameState();
    currentMatchNumber.value = gameIndex;
    await startPersistedSeries(pairingId, gameIndex);
    await startPersistedMatch(1, "web-tournament");

    while (token === machineMatchToken && gameResult.value === "playing") {
      await wait(moveDelay.value);
      if (token !== machineMatchToken) {
        return false;
      }
      const played = isFirstPlayerTurn.value
        ? await playEngineTurn(playerOneBotId.value, "player-one")
        : await playEngineTurn(playerTwoBotId.value, "player-two");
      if (!played) {
        throw new Error(botError.value || "Bot không thể hoàn tất nước đi.");
      }
    }
    if (token !== machineMatchToken) {
      return false;
    }

    await finishPersistedMatch("completed", gameResult.value);
    await finishPersistedSeries("completed");
    completedMatchCount.value += 1;
    if (gameResult.value === "player-one-win") {
      playerOneWins.value += 1;
    } else if (gameResult.value === "player-two-win") {
      playerTwoWins.value += 1;
    } else {
      drawCount.value += 1;
    }
    return true;
  };

  const addPairingScore = (entryOneStarted: boolean, result: GameResult) => {
    if (result === "draw") {
      currentPairingScoreOne.value += 0.5;
      currentPairingScoreTwo.value += 0.5;
      return;
    }
    const playerOneWon = result === "player-one-win";
    const entryOneWon = playerOneWon === entryOneStarted;
    if (entryOneWon) {
      currentPairingScoreOne.value += 1;
    } else {
      currentPairingScoreTwo.value += 1;
    }
  };

  const runTournamentPairing = async (
    token: number,
    tournamentId: string,
    pairing: TournamentPairing,
  ) => {
    const entryOne = tournamentEntries.value.find(
      ({ entryId }) => entryId === pairing.entryOneId,
    );
    const entryTwo = tournamentEntries.value.find(
      ({ entryId }) => entryId === pairing.entryTwoId,
    );
    if (!entryOne || !entryTwo) {
      throw new Error("Không tìm thấy bot trong cặp đấu.");
    }
    currentPairingScoreOne.value = 0;
    currentPairingScoreTwo.value = 0;

    for (
      let gameIndex = 1;
      gameIndex <= gamesPerPairing.value;
      gameIndex += 1
    ) {
      const entryOneStarted = gameIndex % 2 === 1;
      playerOneBotId.value = entryOneStarted ? entryOne.botId : entryTwo.botId;
      playerTwoBotId.value = entryOneStarted ? entryTwo.botId : entryOne.botId;
      const completed = await playTournamentGame(
        token,
        pairing.pairingId,
        gameIndex,
      );
      if (!completed) {
        return false;
      }
      addPairingScore(entryOneStarted, gameResult.value);
    }

    const result = selectPairingWinner({
      entryOne,
      entryTwo,
      scoreOne: currentPairingScoreOne.value,
      scoreTwo: currentPairingScoreTwo.value,
    });
    await postJson(
      `/api/tournaments/${tournamentId}/pairings/${pairing.pairingId}/finish`,
      {
        winnerEntryId: result.winner.entryId,
        entryOneScore: currentPairingScoreOne.value,
        entryTwoScore: currentPairingScoreTwo.value,
        advanceReason: result.reason,
      },
    );
    const loser =
      result.winner.entryId === entryOne.entryId ? entryTwo : entryOne;
    loser.status = "eliminated";
    await refreshBotRatings();
    return true;
  };

  const startMachineMatch = async () => {
    if (
      !isReady.value ||
      !persistenceAvailable.value ||
      gameMode.value !== "engine-vs-engine"
    ) {
      return;
    }

    stopMachineMatch();
    resetGameState();
    resetSeriesStats();
    gamesPerPairing.value = Math.max(
      1,
      Math.min(20, Math.trunc(gamesPerPairing.value || 2)),
    );
    machineMatchStatus.value = "running";
    const token = ++machineMatchToken;

    try {
      const tournament = await postJson<{
        id: string;
        entries: Array<Omit<TournamentEntry, "seedRating">>;
      }>("/api/tournaments/start", {
        name: `Bot Championship ${new Date().toISOString()}`,
        participants: botCatalog.value,
        gamesPerPairing: gamesPerPairing.value,
        settings: {
          seeding: "frozen-elo-groups",
          pairing: "highest-vs-lowest",
          moveDelayMs: moveDelay.value,
        },
      });
      if (token !== machineMatchToken) {
        await postJson(`/api/tournaments/${tournament.id}/stop`, {});
        return;
      }
      activeTournamentId = tournament.id;
      tournamentEntries.value = tournament.entries.map((entry) => ({
        ...entry,
        seedRating: entry.rating,
      }));

      while (
        token === machineMatchToken &&
        tournamentEntries.value.filter(({ status }) => status === "active")
          .length > 1
      ) {
        const round = await postJson<{
          roundNumber: number;
          pairings: TournamentPairing[];
        }>(`/api/tournaments/${tournament.id}/rounds/start`, {});
        tournamentRound.value = round.roundNumber;
        const playablePairings = round.pairings.filter(
          ({ status }) => status === "running",
        );
        totalPairingsInRound.value = playablePairings.length;
        for (const [index, pairing] of playablePairings.entries()) {
          if (token !== machineMatchToken) {
            return;
          }
          currentPairingNumber.value = index + 1;
          const completed = await runTournamentPairing(
            token,
            tournament.id,
            pairing,
          );
          if (!completed) {
            return;
          }
        }
      }

      if (token !== machineMatchToken) {
        return;
      }
      const champion = tournamentEntries.value.find(
        ({ status }) => status === "active",
      );
      if (!champion) {
        throw new Error("Giải đấu không xác định được nhà vô địch.");
      }
      await postJson(`/api/tournaments/${tournament.id}/finish`, {
        championEntryId: champion.entryId,
      });
      champion.status = "champion";
      championEntryId.value = champion.entryId;
      activeTournamentId = null;
      await refreshBotRatings();
      machineMatchStatus.value = "idle";
    } catch (error) {
      if (token !== machineMatchToken) {
        return;
      }
      botError.value =
        error instanceof Error ? error.message : "Không thể chạy giải đấu.";
      machineMatchStatus.value = "stopped";
      const failedTournamentId = activeTournamentId;
      activeTournamentId = null;
      try {
        await finishPersistedMatch("failed", gameResult.value, botError.value);
        await finishPersistedSeries("failed");
        if (failedTournamentId) {
          await postJson(`/api/tournaments/${failedTournamentId}/stop`, {});
        }
      } catch (persistenceFailure) {
        persistenceError.value =
          persistenceFailure instanceof Error
            ? persistenceFailure.message
            : "Không thể cập nhật lỗi giải đấu vào MySQL.";
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
    botRatings,
    championEntryId,
    championName,
    completedMatchCount,
    currentPairingNumber,
    currentPairingScoreOne,
    currentPairingScoreTwo,
    currentMatchNumber,
    currentPlayerLabel,
    drawCount,
    enemyHands,
    executeHumanAction,
    gameMode,
    gameResult,
    gamesPerPairing,
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
    reset,
    reward,
    setGameMode,
    startMachineMatch,
    statusText,
    stopMachineMatch,
    seriesScoreText,
    seedTableRows,
    totalPairingsInRound,
    tournamentEntries,
    tournamentRound,
    tournamentStandings,
    turn,
  };
});
