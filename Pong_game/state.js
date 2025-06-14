// Pong_game/state.js

let state = {
  playerId: localStorage.getItem("playerId"),
  lobbyId: new URLSearchParams(window.location.search).get("code"),
  players: {},
  seats: {},
  hostId: null,
  game: null
};

// ─── Update Functions ───────────────────────────────────────
export function updateLocalState({ lobbyData = null, gameData = null }) {
  if (lobbyData) {
    state.players = lobbyData.players || {};
    state.seats = lobbyData.seats || {};
    state.hostId = lobbyData.hostId || null;
  }
  if (gameData) {
    state.game = gameData;
  }
}

// ─── Read-Only Accessor ─────────────────────────────────────
export function getState() {
  const seatingOrder = Object.entries(state.seats)
    .filter(([_, pid]) => pid && pid !== 0)
    .sort(([a], [b]) => +a - +b)
    .map(([_, pid]) => pid);

  const currentPlayerId = state.game?.currentPlayer || null;
  const isCurrentPlayer = currentPlayerId === state.playerId;
  const isHost = state.hostId === state.playerId;
  const roundDuration = state.game?.roundDuration || null;
  const startTime = state.game?.startTime || null;
  const gameOver = state.game?.gameOver || false;

  return {
    playerId: state.playerId,
    lobbyId: state.lobbyId,
    players: state.players,
    seats: state.seats,
    hostId: state.hostId,
    seatingOrder,
    currentPlayerId,
    isCurrentPlayer,
    isHost,
    roundDuration,
    startTime,
    gameOver
  };
}

// ─── Initial Game State Builder ─────────────────────────────
export function createInitialGameState(seatingOrder, startTime, roundDuration) {
  return {
    currentPlayer: seatingOrder[0],
    ballResetTime: startTime,
    startTime,
    roundDuration,
    gameOver: false
  };
}
