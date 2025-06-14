// lobby.js

import { initLobby, setLobbyUpdateCallback } from "./Pong_game/lobby_core.js";
import { renderLobbyUI } from "./Pong_game/lobby_ui.js";
import { registerLobbyEventHandlers } from "./Pong_game/lobby_events.js";
import { handleLobbyRouting } from "./Pong_game/lobby_router.js";

// Wait for DOM to load before accessing elements
document.addEventListener("DOMContentLoaded", () => {
  const createBtn = document.getElementById("createLobbyBtn");
  const joinBtn = document.getElementById("joinLobbyBtn");

  createBtn.onclick = () => {
    const newCode = crypto.randomUUID().slice(0, 6).toUpperCase();
    startLobbyFlow(newCode, true);
  };

  joinBtn.onclick = () => {
    const code = document.getElementById("lobbyCodeInput").value.trim().toUpperCase();
    if (code) {
      startLobbyFlow(code, false);
    } else {
      alert("Please enter a valid lobby code.");
    }
  };
});

async function startLobbyFlow(code, isCreating) {
  document.getElementById("createJoin").style.display = "none";
  document.getElementById("lobbyView").style.display = "block";

  history.replaceState({}, "", `?code=${code}`);

  registerLobbyEventHandlers();

  setLobbyUpdateCallback((lobbyData) => {
    renderLobbyUI(lobbyData);
    handleLobbyRouting(lobbyData);
  });

  await initLobby(code, isCreating);
}
