// Pong_game/lobby_events.js

import { updatePlayerName, exitLobby, getLobbyId } from "./lobby_core.js";

export function registerLobbyEventHandlers() {
  // Update name on input change
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
}
