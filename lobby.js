import { db } from './firebase-config.js';
import {
  ref, set, get, update, onValue, remove
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

  const players = {};
  players[localPlayerId] = { name: "Host", joinedAt: Date.now(), seat: null };

  const seats = {};
  for (let i = 1; i <= 5; i++) {
    seats[i] = 0;
  }

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
      <button onclick="updateHostName()">Save</button><br>
      <label>Seat count: <input id="seatCountInput" type="number" min="1" max="12" value="5" /></label>
      <button onclick="updateSeatCount()">Apply</button><br>
      <button id="closeLobbyButton">Close Lobby</button>
    `;
    document.getElementById("closeLobbyButton").onclick = async () => {
      await remove(ref(db, `lobbies/${lobbyId}`));
      location.reload();
    };
  }
}

window.updateHostName = async function () {
  const newName = document.getElementById("hostNameInput").value.trim();
  if (newName) {
    await update(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`), { name: newName });
  }
};

window.updateSeatCount = async function () {
  const input = document.getElementById("seatCountInput");
  const newCount = parseInt(input.value);
  if (isNaN(newCount) || newCount < 1 || newCount > 12) return;

  const seatsRef = ref(db, `lobbies/${lobbyId}/seats`);
  const snapshot = await get(seatsRef);
  const currentSeats = snapshot.val() || {};

  const updates = {};
  for (let i = 1; i <= newCount; i++) {
    if (!(i in currentSeats)) updates[`seats/${i}`] = 0;
  }

  for (let i = newCount + 1; i <= Object.keys(currentSeats).length; i++) {
    if (currentSeats[i] !== 0) {
      const pid = currentSeats[i];
      await update(ref(db, `lobbies/${lobbyId}/players/${pid}`), { seat: null });
    }
    updates[`seats/${i}`] = null;
  }

  await update(ref(db, `lobbies/${lobbyId}`), updates);
};

function listenToLobby() {
  const lobbyRef = ref(db, `lobbies/${lobbyId}`);

  onValue(lobbyRef, async snapshot => {
    const data = snapshot.val();
    const players = data.players || {};
    const seats = data.seats || {};
    const seatEntries = Object.entries(seats);
    const totalSeats = seatEntries.length;
    const now = Date.now();

    tableDiv.innerHTML = "";
    unseatedDiv.innerHTML = "";

    const radius = 120;
    const centerX = 140;
    const centerY = 140;

    seatEntries.forEach(([seatNum, playerId], index) => {
      const angle = (index / totalSeats) * 2 * Math.PI;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);

      const seat = document.createElement("div");
      seat.className = "seat";
      seat.style.left = `${x}px`;
      seat.style.top = `${y}px`;
      seat.setAttribute("data-seat", seatNum);

      if (String(playerId) !== "0") {
        const player = players[playerId];
        seat.textContent = player ? player.name : "Taken";
        seat.classList.add("taken");
        if (playerId === localPlayerId) seat.classList.add("self");

        if (isHost) {
          seat.style.cursor = "pointer";
          seat.onclick = async () => {
            await update(ref(db, `lobbies/${lobbyId}/seats/${seatNum}`), 0);
            await update(ref(db, `lobbies/${lobbyId}/players/${playerId}`), {
              seat: null,
              blockedUntil: Date.now() + 3000
            });
          };
        }
      } else {
        seat.textContent = `Seat ${seatNum}`;
        seat.style.cursor = "pointer";
        seat.addEventListener("click", async () => {
          const playerData = players[localPlayerId];
          if (playerData?.blockedUntil && Date.now() < playerData.blockedUntil) return;

          const updates = {};
          for (const [num, id] of Object.entries(seats)) {
            if (String(id) === localPlayerId) updates[`seats/${num}`] = 0;
          }

          updates[`seats/${seatNum}`] = localPlayerId;
          await update(ref(db, `lobbies/${lobbyId}`), updates);
          await update(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`), {
            seat: parseInt(seatNum)
          });
        });
      }

      tableDiv.appendChild(seat);
    });

    Object.entries(players).forEach(([id, player]) => {
      const isSeated = Object.values(seats).includes(id);
      if (!isSeated) {
        const div = document.createElement("div");
        div.className = "player";
        div.textContent = player.name;

        if (isHost && id !== localPlayerId) {
          div.style.cursor = "pointer";
          div.onclick = async () => {
            await update(ref(db, `lobbies/${lobbyId}/players/${id}`), {
              blockedUntil: Date.now() + 3000
            });
            setTimeout(() => {
              remove(ref(db, `lobbies/${lobbyId}/players/${id}`));
            }, 100);
          };
        }

        unseatedDiv.appendChild(div);
      }
    });

    // Ensure unseat button works
    const unseatBtn = document.getElementById("unseatButton");
    const playerSeat = Object.entries(seats).find(([_, id]) => String(id) === localPlayerId);
    if (unseatBtn) {
      unseatBtn.style.display = playerSeat ? "inline-block" : "none";
      unseatBtn.onclick = async () => {
        if (playerSeat) {
          const [seatNum] = playerSeat;
          await set(ref(db, `lobbies/${lobbyId}/seats/${seatNum}`), 0);
          await update(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`), {
            seat: null,
            blockedUntil: Date.now() + 3000
          });
        }
      };
    }

    const allFilled = Object.values(seats).every(id => id !== 0 && id !== "0");
    startGameButton.style.display = isHost && allFilled ? "inline-block" : "none";
  });
}
