import { db } from './firebase-config.js';
import {
  ref, set, get, onValue
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";


let lobbyId = null;
let localPlayerId = null;

const nicknameInput = document.getElementById("nicknameInput");
const lobbyCodeInput = document.getElementById("lobbyCodeInput");
const tableDiv = document.getElementById("table");

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

window.createLobby = async function () {
  lobbyId = generateCode();
  localPlayerId = crypto.randomUUID();

  await set(ref(db, `lobbies/${lobbyId}`), {
    players: {
      [localPlayerId]: {
        name: "Host",
        joinedAt: Date.now()
      }
    }
  });

  enterLobbyUI(lobbyId);
  listenToLobby();
};

window.joinLobby = async function () {
  const code = lobbyCodeInput.value.trim().toUpperCase();
  const name = nicknameInput.value.trim() || "Player";

  const lobbyRef = ref(db, `lobbies/${code}`);
  const snapshot = await get(lobbyRef);

  if (!snapshot.exists()) {
    alert("Lobby not found.");
    return;
  }

  lobbyId = code;
  localPlayerId = crypto.randomUUID();

  await set(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`), {
    name,
    joinedAt: Date.now()
  });

  enterLobbyUI(code);
  listenToLobby();
};

function enterLobbyUI(code) {
  document.getElementById("createJoin").style.display = "none";
  document.getElementById("lobbyView").style.display = "block";
  document.getElementById("lobbyCodeDisplay").textContent = code;
}

function listenToLobby() {
  onValue(ref(db, `lobbies/${lobbyId}/players`), snapshot => {
    const players = snapshot.val() || {};
    const entries = Object.entries(players);

    tableDiv.innerHTML = "";
    const centerX = 150;
    const centerY = 150;
    const radius = 110;
    const total = entries.length;

    entries.forEach(([id, player], index) => {
      const angle = (index / total) * 2 * Math.PI;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);

      const div = document.createElement("div");
      div.className = "player";
      div.style.left = `${x}px`;
      div.style.top = `${y}px`;
      div.style.background = id === localPlayerId ? "#ffb700" : "#333";
      div.textContent = player.name;
      tableDiv.appendChild(div);
    });
  });
}
