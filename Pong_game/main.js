// Pong_game/main.js
import {
  initializeFirebaseState,
  serverNow,
  listenToLobby,
  listenToGame,
  updateGame,
  startNewGame,
  markPlayerDone,
  monitorPresence
} from "./firebase.js";

import { createInitialGameState, updateLocalState, getState } from "./state.js";
import { initGameLoop, resetBallWithState } from "./game.js";
import {
  initUI,
  showMessage,
  setTemporaryMessage,
  showReturnButton
} from "./ui.js";

import {
  initMusic,
  unlockMusic,
  resumeIfNeeded,
  syncToGame,
  updateRate,
  stopMusic
} from "./music.js";

// ─── DOM Setup ──────────────────────────────────────────────
const canvas = document.getElementById("gameCanvas");
const returnBtn = document.getElementById("returnBtn");

const lobbyId = new URLSearchParams(window.location.search).get("code");
const playerId = localStorage.getItem("playerId");

// ─── Initialization ─────────────────────────────────────────
initializeFirebaseState(lobbyId, playerId);
monitorPresence();
initUI();
initMusic();
initGameLoop(canvas);

// ─── Music Unlock ───────────────────────────────────────────
canvas.addEventListener("click", unlockMusic, { once: true });
canvas.addEventListener("touchstart", unlockMusic, { once: true });

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible") {
    await resumeIfNeeded();
  }
});

// ─── Lobby Listener ─────────────────────────────────────────
listenToLobby(data => {
  updateLocalState({ lobbyData: data });

  const seated = Object.values(data.seats || {}).filter(id => id && id !== 0);
  const players = data.players || {};
  const allDone = seated.every(pid => players[pid]?.done);
  if (seated.length && allDone) {
    updateGame({ gameOver: true });
  }

  const { isHost, seatingOrder } = getState();
  if (isHost && seatingOrder.length) {
    const roundMs = 60000 + Math.floor(Math.random() * 60000);
    const now = serverNow();
    startNewGame(createInitialGameState(seatingOrder, now, roundMs));
  }
});

// ─── Game Listener ──────────────────────────────────────────
listenToGame(data => {
  if (!data) return;
  updateLocalState({ gameData: data });

  const {
    currentPlayerId,
    playerId,
    startTime,
    roundDuration,
    isCurrentPlayer,
    gameOver,
    players
  } = getState();

  if (gameOver) {
    stopMusic();
    showMessage(isCurrentPlayer
      ? "💀 Time's up! You lost the game!"
      : `🎉 ${players[currentPlayerId]?.name || "Someone"} lost!`);
    showReturnButton();
    return;
  }

  showMessage(isCurrentPlayer ? "🎯 Your turn!" : "⏳ Waiting...");

  if (isCurrentPlayer && startTime && roundDuration) {
    syncToGame(startTime, roundDuration, serverNow);
  }

  if (data.ballResetTime) {
    resetBallWithState(data.ballState);
  }
});

// ─── Return to Lobby ────────────────────────────────────────
returnBtn.onclick = async () => {
  await markPlayerDone();
  window.location.href = `lobby.html?code=${lobbyId}`;
};

// ─── Music Speed Sync ───────────────────────────────────────
setInterval(() => {
  const { isCurrentPlayer, startTime, roundDuration } = getState();
  if (isCurrentPlayer && startTime && roundDuration) {
    updateRate(startTime, roundDuration, serverNow);
  }
}, 500);
