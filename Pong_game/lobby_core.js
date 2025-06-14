// Pong_game/lobby_core.js

import {
  createLobby,
  joinLobby,
  leaveLobby,
  listenToLobby,
  updateLobby
} from "./firebase.js";

let lobbyId;
let playerId;
let onLobbyUpdate = null;

export function getLobbyId() {
  return lobbyId;
}

export function getPlayerId() {
  return playerId;
}

export function setLobbyUpdateCallback(callback) {
  onLobbyUpdate = callback;
}

export async function initLobby(code, isCreating = false) {
  lobbyId = code;

  playerId = localStorage.getItem("playerId");
  if (!playerId) {
    playerId = crypto.randomUUID();
    localStorage.setItem("playerId", playerId);
  }

  if (isCreating) {
    await createLobby(lobbyId, playerId);
  } else {
    await joinLobby(lobbyId, playerId);
  }

  listenToLobby(lobbyId, playerId, data => {
    if (typeof onLobbyUpdate === "function") {
      onLobbyUpdate(data);
    }
  });
}


export async function updatePlayerName(name) {
  if (!lobbyId || !playerId) return;
  await updateLobby(lobbyId, playerId, { name });
}

export async function exitLobby() {
  if (!lobbyId || !playerId) return;
  await leaveLobby(lobbyId, playerId);
}
