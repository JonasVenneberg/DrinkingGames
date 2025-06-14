// Pong_game/lobby_ui.js

import { getPlayerId } from "./lobby_core.js";

export function renderLobbyUI(lobbyData) {
  const playerId = getPlayerId();
  const player = lobbyData.players?.[playerId];
  const playerName = player?.name || "Unnamed";
  document.getElementById("playerName").textContent = playerName;

  renderSeats(lobbyData);
}

function renderSeats(lobbyData) {
  const seatContainer = document.getElementById("seatContainer");
  seatContainer.innerHTML = "";

  lobbyData.seatingOrder.forEach((pid, index) => {
    const seat = document.createElement("div");
    seat.className = "seat";

    if (pid) {
      const name = lobbyData.players?.[pid]?.name || "Player";
      seat.textContent = name;
      if (pid === getPlayerId()) seat.classList.add("you");
    } else {
      seat.textContent = "Empty";
      seat.classList.add("empty");
    }

    seatContainer.appendChild(seat);
  });
}
