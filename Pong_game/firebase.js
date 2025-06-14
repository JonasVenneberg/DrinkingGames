// Pong_game/firebase.js
import { db } from "./firebase-config.js";
import {
  ref, get, set, update, remove, runTransaction,
  onValue, onDisconnect
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

let lobbyId = null;
let playerId = null;
let serverOffset = 0;

export function initializeFirebaseState(lobbyCode, localPlayerId) {
  lobbyId = lobbyCode;
  playerId = localPlayerId;

  // Track server time offset
  onValue(ref(db, ".info/serverTimeOffset"), snap => {
    serverOffset = snap.val() || 0;
  });

  // Set presence and auto-remove on disconnect
  const presenceRef = ref(db, `presence/${lobbyId}/${playerId}`);
  set(presenceRef, true);
  onDisconnect(presenceRef).remove();
}

export function serverNow() {
  return Date.now() + serverOffset;
}

// ─── References ─────────────────────────────────────────────
function gameRef()   { return ref(db, `games/${lobbyId}`); }
function lobbyRef()  { return ref(db, `lobbies/${lobbyId}`); }
function playerRef() { return ref(db, `lobbies/${lobbyId}/players/${playerId}`); }
function presenceRootRef() { return ref(db, `presence/${lobbyId}`); }

// ─── Presence Cleanup ───────────────────────────────────────
let cleanupTimer = null;
export function monitorPresence() {
  onValue(presenceRootRef(), snap => {
    const active = snap.exists() ? Object.keys(snap.val()).length : 0;

    if (active === 0 && !cleanupTimer) {
      cleanupTimer = setTimeout(async () => {
        const verify = await get(presenceRootRef());
        if (!verify.exists()) {
          await remove(gameRef());
          await update(lobbyRef(), { gameStarted: false });
        }
        cleanupTimer = null;
      }, 10000);
    }

    if (active > 0 && cleanupTimer) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
  });
}

// ─── Game & Lobby Access ─────────────────────────────────────
export async function getLobbyData() {
  const snap = await get(lobbyRef());
  return snap.exists() ? snap.val() : null;
}

export async function getGameData() {
  const snap = await get(gameRef());
  return snap.exists() ? snap.val() : null;
}

export function listenToLobby(callback) {
  onValue(lobbyRef(), snap => {
    const val = snap.val();
    if (val) callback(val);
  });
}

export function listenToGame(callback) {
  onValue(gameRef(), snap => {
    const val = snap.val();
    if (val) callback(val);
  });
}

// ─── Game Control ────────────────────────────────────────────
export function startNewGame(initialState) {
  return runTransaction(gameRef(), current => {
    if (!current || current.gameOver) {
      return initialState;
    }
    return; // Do not overwrite active games
  });
}

export function updateGame(data) {
  return update(gameRef(), data);
}

export function clearGame() {
  return remove(gameRef());
}

export function markPlayerDone() {
  return update(playerRef(), { done: true });
}
