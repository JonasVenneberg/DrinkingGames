import { db } from './firebase-config.js';
import {
  ref, set, get, update, onValue, child
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

let lobbyId = null;
let localPlayerId = null;
let isHost = false;

const nicknameInput = document.getElementById("nicknameInput");
const lobbyCodeInput = document.getElementById("lobbyCodeInput");
const tableDiv = document.getElementById("table");
const unseatedDiv = document.getElementById("unseatedPlayers");
const hostControls = document.getElementById("hostControls");
const startGameButton = document.getElementById("startGameButton");

function generateCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

window.createLobby = async function () {
  lobbyId = generateCode();
  localPlayerId = crypto.randomUUID();
  isHost = true;

  const initialName = prompt("Enter your name:") || "Host";
  const seatCount = parseInt(prompt("How many seats? (3–10)")) || 4;

  const players = {};
  players[localPlayerId] = { name: initialName, joinedAt: Date.now(), seat: 0 };

  const seats = {};
  for (let i = 1; i <= seatCount; i++) seats[i] = null;

  await set(ref(db, `lobbies/${lobbyId}`), {
    hostId: localPlayerId,
    players,
    seats
  });

  enterLobbyUI();
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
    joinedAt: Date.now(),
    seat: null
  });

  const data = snapshot.val();
  isHost = data.hostId === localPlayerId;

  enterLobbyUI();
  listenToLobby();
};

function enterLobbyUI() {
  document.getElementById("createJoin").style.display = "none";
  document.getElementById("lobbyView").style.display = "block";
  document.getElementById("lobbyCodeDisplay").textContent = lobbyId;

  if (isHost) {
    hostControls.innerHTML = `
      <label>Edit name: <input id="hostNameInput" /></label>
      <button onclick="updateHostName()">Save</button>
    `;
    document.getElementById("hostNameInput").addEventListener("keydown", e => {
      if (e.key === "Enter") updateHostName();
    });
  }
}

window.updateHostName = async function () {
  const newName = document.getElementById("hostNameInput").value.trim();
  if (newName) {
    await update(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`), { name: newName });
  }
};

function listenToLobby() {
  const lobbyRef = ref(db, `lobbies/${lobbyId}`);

  onValue(lobbyRef, snapshot => {
    const data = snapshot.val();
    const players = data.players || {};
    const seats = data.seats || {};
    const entries = Object.entries(seats);

    tableDiv.innerHTML = "";
    unseatedDiv.innerHTML = "";

    // Draw table seats
    entries.forEach(([seatNum, playerId]) => {
      const div = document.createElement("div");
      div.className = "seat";
      div.textContent = `Seat ${seatNum}`;

      if (playerId) {
        const player = players[playerId];
        if (player) {
          div.textContent = player.name;
          div.classList.add("taken");
          if (playerId === localPlayerId) div.classList.add("self");
        }
      } else {
        div.addEventListener("click", () => {
          if (!Object.values(seats).includes(localPlayerId)) {
            update(ref(db, `lobbies/${lobbyId}/seats/${seatNum}`), localPlayerId);
            update(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`), { seat: parseInt(seatNum) });
          }
        });
      }

      tableDiv.appendChild(div);
    });

    // Draw unseated players
    Object.entries(players).forEach(([id, player]) => {
      if (!player.seat) {
        const chip = document.createElement("div");
        chip.className = "player";
        chip.textContent = player.name;
        unseatedDiv.appendChild(chip);
      }
    });

    // Show start button only if all seats are filled and host is viewing
    const allSeated = Object.values(seats).every(val => val !== null);
    startGameButton.style.display = isHost && allSeated ? "inline-block" : "none";
  });
}
