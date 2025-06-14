// Pong_game/lobby_ui.js

import { getPlayerId } from "./lobby_core.js";

export function renderLobbyUI(lobbyData) {
  const playerId = getPlayerId();
  const player = lobbyData.players?.[playerId];
  const playerName = player?.name || "Unnamed";
  document.getElementById("playerName").textContent = playerName;

  renderSeats(lobbyData);
  renderUnseatedPlayers(lobbyData);
}

function renderSeats(lobbyData) {
  const seatContainer = document.getElementById("seatContainer");
  seatContainer.innerHTML = "";

  const totalSeats = lobbyData.seatingOrder.length;
  const angleStep = (2 * Math.PI) / totalSeats;
  const radius = 120; // px

  lobbyData.seatingOrder.forEach((pid, index) => {
    const seat = document.createElement("div");
    seat.className = "seat";

    const player = lobbyData.players?.[pid];
    if (pid) {
      seat.textContent = player?.name || "Player";
      if (pid === getPlayerId()) seat.classList.add("you");
    } else {
      seat.textContent = "Empty";
      seat.classList.add("empty");
    }

    // Circular position
    const angle = angleStep * index - Math.PI / 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    seat.style.position = "absolute";
    seat.style.left = `calc(50% + ${x}px - 40px)`; // adjust for width
    seat.style.top = `calc(50% + ${y}px - 20px)`;  // adjust for height

    // Click to try sit
    if (!pid) {
      seat.style.cursor = "pointer";
      seat.onclick = () => {
        const trySit = window.trySit || (() => alert("Seating logic not bound"));
        trySit(index);
      };
    }

    seatContainer.appendChild(seat);
  });
}

function renderUnseatedPlayers(lobbyData) {
  const unseatedContainer = document.getElementById("unseatedContainer");
  if (!unseatedContainer) return;

  unseatedContainer.innerHTML = "";

  const seatedSet = new Set(lobbyData.seatingOrder.filter(pid => pid));
  const playerId = getPlayerId();
  const isHost = Object.keys(lobbyData.players || {})[0] === playerId;

  Object.entries(lobbyData.players || {}).forEach(([pid, info]) => {
    if (!seatedSet.has(pid)) {
      const div = document.createElement("div");
      div.className = "unseated";
      div.textContent = info.name || "Unnamed";

      if (isHost && pid !== playerId) {
        div.style.cursor = "pointer";
        div.title = "Click to kick";
        div.onclick = () => {
          const confirmKick = confirm(`Kick ${info.name}?`);
          if (confirmKick && window.kickPlayer) {
            window.kickPlayer(pid);
          }
        };
      }

      unseatedContainer.appendChild(div);
    }
  });
}

