// Pong_game/lobby_events.js

import {
  updatePlayerName,
  exitLobby,
  getLobbyId,
  getPlayerId
} from "./lobby_core.js";

import { updateLobby } from "./firebase.js";

export function registerLobbyEventHandlers() {
  // Name input
  const nameInput = document.getElementById("nameInput");
  nameInput.addEventListener("change", async (e) => {
    const name = e.target.value.trim();
    if (name) await updatePlayerName(name);
  });

  // Leave button
  const leaveBtn = document.getElementById("leaveBtn");
  leaveBtn.addEventListener("click", async () => {
    await exitLobby();
    window.location.href = "index.html";
  });

  // Share button
  const shareBtn = document.getElementById("shareBtn");
  shareBtn.addEventListener("click", () => {
    const base = location.origin + location.pathname.replace(/\/[^/]*$/, '');
    const shareUrl = `${base}/lobby.html?code=${getLobbyId()}`;
    navigator.clipboard.writeText(shareUrl);
    alert("🔗 Link copied to clipboard!");
  });

  // Make trySit globally accessible for UI click handlers
  window.trySit = async (seatIndex) => {
  const lobbyId = getLobbyId();
  const playerId = getPlayerId();

  const res = await fetch(`/lobbies/${lobbyId}.json`);
  const lobbyData = await res.json();
  if (!lobbyData || !lobbyData.seatingOrder || !lobbyData.players) return;

  const currentTime = Date.now();
  const player = lobbyData.players[playerId];
  const seatingOrder = [...lobbyData.seatingOrder];
  const clickedPid = seatingOrder[seatIndex];

  const isHost = Object.keys(lobbyData.players || {})[0] === playerId;
  const currentIndex = seatingOrder.indexOf(playerId);

  // Host unseats others
  if (clickedPid && clickedPid !== playerId && isHost) {
    seatingOrder[seatIndex] = null;
    await updateLobby(lobbyId, playerId, { seatingOrder });
    return;
  }

  // If player clicked their own seat → unseat
  if (clickedPid === playerId) {
    seatingOrder[seatIndex] = null;
    await updateLobby(lobbyId, playerId, {
      seatingOrder,
      [`players/${playerId}/blockedUntil`]: currentTime + 3000
    });
    return;
  }

  // If seat is taken and not by self
  if (clickedPid && clickedPid !== playerId) {
    alert("🚫 Seat is already taken.");
    return;
  }

  // Blocked timer
  if (player?.blockedUntil && currentTime < player.blockedUntil) {
    alert("⏳ Please wait before sitting again.");
    return;
  }

  // Unseat if already seated
  if (currentIndex !== -1) seatingOrder[currentIndex] = null;
  seatingOrder[seatIndex] = playerId;

  await updateLobby(lobbyId, playerId, { seatingOrder });
};
window.kickPlayer = async (targetId) => {
  const lobbyId = getLobbyId();
  const playerId = getPlayerId();

  const res = await fetch(`/lobbies/${lobbyId}.json`);
  const lobbyData = await res.json();
  if (!lobbyData || !lobbyData.players || !lobbyData.seatingOrder) return;

  const isHost = Object.keys(lobbyData.players)[0] === playerId;
  if (!isHost) return;

  const updates = {
    [`players/${targetId}`]: null
  };

  // Remove from seating order if present
  const seatingOrder = lobbyData.seatingOrder.map(pid => (pid === targetId ? null : pid));
  updates["seatingOrder"] = seatingOrder;

  await updateLobby(lobbyId, playerId, updates);
};


}
