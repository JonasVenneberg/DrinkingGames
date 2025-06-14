// Pong_game/lobby_router.js

import { getLobbyId, getPlayerId } from "./lobby_core.js";

export function handleLobbyRouting(lobbyData) {
  const playerId = getPlayerId();
  const players = lobbyData.players || {};
  const seating = lobbyData.seatingOrder || [];

  const seatedPlayers = seating.filter(pid => pid !== null);
  const allNamed = seatedPlayers.every(pid => players[pid]?.name?.trim());

  if (seatedPlayers.length >= 2 && allNamed) {
    // Redirect to pong game
    const lobbyId = getLobbyId();
    window.location.href = `/pong.html?code=${lobbyId}`;
  }
}
