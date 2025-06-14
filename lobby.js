// lobby.js

import { initLobby, setLobbyUpdateCallback } from "./Pong_game/lobby_core.js";
import { renderLobbyUI } from "./Pong_game/lobby_ui.js";
import { registerLobbyEventHandlers } from "./Pong_game/lobby_events.js";
import { handleLobbyRouting } from "./Pong_game/lobby_router.js";

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
  }
};

async function startLobbyFlow(code, isCreating) {
  // Hide entry, show lobby
  document.getElementById("createJoin").style.display = "none";
  document.getElementById("lobbyView").style.display = "block";

  // Replace URL
  window.history.replaceState({}, "", `?code=${code}`);

  // Setup live sync
  registerLobbyEventHandlers();

  setLobbyUpdateCallback((lobbyData) => {
    renderLobbyUI(lobbyData);
    handleLobbyRouting(lobbyData);
  });

  await initLobby(code, isCreating);
}
