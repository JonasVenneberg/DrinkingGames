/**************************************************************************
 *  lobby.js – multiplayer lobby for the Drinking Games project
 *  – preserves player names
 *  – prevents premature restarts
 *  – publishes presence from the lobby page, too
 **************************************************************************/

import { db } from "./firebase-config.js";
import {
  ref, set, get, update, onValue, remove,
  onDisconnect    // <‑‑ extra import for presence
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

/* ─── persistent ID for this browser ───────────────────────────────────── */

const localPlayerId = localStorage.getItem("playerId") || crypto.randomUUID();
localStorage.setItem("playerId", localPlayerId);

/* ─── UI handles ───────────────────────────────────────────────────────── */

const lobbyCodeInput   = document.getElementById("lobbyCodeInput");
const tableDiv         = document.getElementById("table");
const unseatedDiv      = document.getElementById("unseatedPlayers");
const hostControls     = document.getElementById("hostControls");
const startGameButton  = document.getElementById("startGameButton");

/* ─── globals for this file ────────────────────────────────────────────── */

let lobbyId     = null;
let isHost      = false;
let leftLobby   = false;
let presenceRef = null;     // will be set once we know the lobby

/* ─── helpers ──────────────────────────────────────────────────────────── */

const generateCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/* ─── presence handling (also used in pong.js) ─────────────────────────── */

function initPresence() {
  if (!lobbyId) return;

  presenceRef = ref(db, `presence/${lobbyId}/${localPlayerId}`);
  set(presenceRef, true);
  onDisconnect(presenceRef).remove();
}

/* ─── lobby creation / join ────────────────────────────────────────────── */

window.createLobby = async function () {
  lobbyId = generateCode();
  isHost  = true;

  const players = {
    [localPlayerId]: { name: "Host", joinedAt: Date.now(), seat: null }
  };

  const seats = {};
  for (let i = 1; i <= 5; i++) seats[i] = 0;

  await set(ref(db, `lobbies/${lobbyId}`), {
    hostId:   localPlayerId,
    players,
    seats,
    gameStarted: false
  });

  initPresence();
  enterLobbyUI();
  listenToLobby();
};

window.joinLobby = async function () {
  const code = lobbyCodeInput.value.trim().toUpperCase();
  if (!code) return;

  const lobbyRef = ref(db, `lobbies/${code}`);
  const snap     = await get(lobbyRef);

  if (!snap.exists()) { alert("Lobby not found."); return; }

  lobbyId = code;
  const data = snap.val();
  isHost     = data.hostId === localPlayerId;

  /* Preserve existing name if we were already listed */
  if (!data.players?.[localPlayerId]) {
    await set(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`), {
      name: "Player",
      joinedAt: Date.now(),
      seat: null
    });
  }

  initPresence();
  enterLobbyUI();
  listenToLobby();
};

/* ─── host / player name edits ─────────────────────────────────────────── */

window.saveNewName = async function () {
  const inp = document.getElementById("nameChangeInput");
  if (!inp) return;
  const newName = inp.value.trim();
  if (newName) {
    await update(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`), { name: newName });
  }
};

window.updateHostName = async function () {
  const newName = document.getElementById("hostNameInput").value.trim();
  if (newName) {
    await update(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`), { name: newName });
  }
};

/* ─── seat count (host‑only) ───────────────────────────────────────────── */

window.updateSeatCount = async function () {
  const input    = document.getElementById("seatCountInput");
  const newCount = parseInt(input.value, 10);
  if (isNaN(newCount) || newCount < 1 || newCount > 12) return;

  const seatsRef  = ref(db, `lobbies/${lobbyId}/seats`);
  const snap      = await get(seatsRef);
  const current   = snap.val() || {};

  const updates = {};

  /* add new seats */
  for (let i = 1; i <= newCount; i++) {
    if (!(i in current)) updates[`seats/${i}`] = 0;
  }

  /* remove extra seats, unseating anyone sitting there */
  for (let i = newCount + 1; i <= Object.keys(current).length; i++) {
    if (current[i] !== 0) {
      const pid = current[i];
      await update(ref(db, `lobbies/${lobbyId}/players/${pid}`), { seat: null });
    }
    updates[`seats/${i}`] = null;
  }

  await update(ref(db, `lobbies/${lobbyId}`), updates);
};

/* ─── UI: entering the lobby view ─────────────────────────────────────── */

function enterLobbyUI() {
  document.getElementById("createJoin").style.display = "none";
  document.getElementById("lobbyView").style.display  = "block";
  document.getElementById("lobbyCodeDisplay").textContent = lobbyId;

  if (isHost) {
    hostControls.innerHTML = `
      <label>Edit name: <input id="hostNameInput" /></label>
      <button onclick="updateHostName()">Save</button><br>
      <label>Seat count: <input id="seatCountInput" type="number" min="1" max="12" value="5" /></label>
      <button onclick="updateSeatCount()">Apply</button><br>
      <button id="closeLobbyButton">Close Lobby</button>
    `;
    document
      .getElementById("closeLobbyButton")
      .onclick = async () => { await remove(ref(db, `lobbies/${lobbyId}`)); location.reload(); };

  } else {
    hostControls.innerHTML = `
      <label>Choose your name: <input id="nameChangeInput" /></label>
      <button onclick="saveNewName()">Save</button>
    `;
  }
}

/* ─── main realtime listener ──────────────────────────────────────────── */

function listenToLobby() {
  const lobbyRef = ref(db, `lobbies/${lobbyId}`);

  onValue(lobbyRef, async snap => {
    const data = snap.val();
    if (!data) { location.reload(); return; }

    const players = data.players || {};
    const seats   = data.seats   || {};

    /* auto‑redirect when a round starts */
    if (data.gameStarted) {
      /* fetch /games to check if the round already ended */
      const gameSnap = await get(ref(db, `games/${lobbyId}`));
      if (!gameSnap.exists() || gameSnap.val().gameOver !== true) {
        window.location.href = `pong.html?code=${lobbyId}`;
        return;
      }
    }

    /* kicked? */
    if (!players[localPlayerId]) {
      if (!leftLobby) alert("You have been removed from the lobby.");
      location.reload();
      return;
    }

    renderTable(players, seats);
    renderUnseated(players, seats);
    renderButtons(data, seats);
  });

  initShareButton();
}

/* ─── rendering helpers ───────────────────────────────────────────────── */

function renderTable(players, seats) {
  tableDiv.innerHTML = "";

  const entries   = Object.entries(seats);
  const total     = entries.length;
  const radius    = 120;
  const centerX   = 140;
  const centerY   = 140;

  entries.forEach(([seatNum, pid], idx) => {
    const angle = (idx / total) * 2 * Math.PI;
    const x     = centerX + radius * Math.cos(angle);
    const y     = centerY + radius * Math.sin(angle);

    const seat  = document.createElement("div");
    seat.className = "seat";
    seat.style.left = `${x}px`;
    seat.style.top  = `${y}px`;
    seat.dataset.seat = seatNum;

    if (String(pid) !== "0") {
      /* taken seat */
      const player = players[pid];
      seat.textContent = player ? player.name : "Taken";
      seat.classList.add("taken");
      if (pid === localPlayerId) seat.classList.add("self");

      if (isHost) {
        seat.style.cursor = "pointer";
        seat.onclick = async () => {
          /* host kicks player from seat */
          await update(ref(db, `lobbies/${lobbyId}`), { [`seats/${seatNum}`]: 0 });
          await update(ref(db, `lobbies/${lobbyId}/players/${pid}`), {
            seat: null,
            blockedUntil: Date.now() + 3000
          });
        };
      }
    } else {
      /* empty seat */
      seat.textContent = `Seat ${seatNum}`;
      seat.style.cursor = "pointer";
      seat.onclick = async () => trySit(seatNum, players, seats);
    }

    tableDiv.appendChild(seat);
  });
}

async function trySit(seatNum, players, seats) {
  const me = players[localPlayerId];
  if (me?.blockedUntil && Date.now() < me.blockedUntil) return;

  const updates = {};
  /* vacate any seat we're already in */
  for (const [num, id] of Object.entries(seats)) {
    if (String(id) === localPlayerId) updates[`seats/${num}`] = 0;
  }
  /* take the new one */
  updates[`seats/${seatNum}`] = localPlayerId;

  await update(ref(db, `lobbies/${lobbyId}`), updates);
  await update(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`), { seat: +seatNum });
}

function renderUnseated(players, seats) {
  unseatedDiv.innerHTML = "";

  const seatedIds = new Set(Object.values(seats).filter(id => id !== 0 && id !== "0"));
  for (const [id, player] of Object.entries(players)) {
    if (seatedIds.has(id)) continue;

    const div = document.createElement("div");
    div.className = "player";
    div.textContent = player.name;

    if (isHost && id !== localPlayerId) {
      div.style.cursor = "pointer";
      div.onclick = async () => { await remove(ref(db, `lobbies/${lobbyId}/players/${id}`)); };
    }
    unseatedDiv.appendChild(div);
  }
}

function renderButtons(data, seats) {
  /* Unseat‑yourself button */
  const unseatBtn = document.getElementById("unseatButton");
  if (unseatBtn) {
    const mySeat = Object.entries(seats).find(([_, id]) => String(id) === localPlayerId);
    unseatBtn.style.display = mySeat ? "inline-block" : "none";
    unseatBtn.onclick = async () => {
      if (!mySeat) return;
      const [num] = mySeat;
      await update(ref(db, `lobbies/${lobbyId}`), { [`seats/${num}`]: 0 });
      await update(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`), {
        seat: null,
        blockedUntil: Date.now() + 3000
      });
    };
  }

  /* Leave lobby button (non‑host) */
  const leaveBtn = document.getElementById("leaveLobbyButton");
  if (leaveBtn) {
    if (!isHost) {
      leaveBtn.style.display = "inline-block";
      leaveBtn.onclick = async () => {
        leftLobby = true;
        await remove(ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`));
        location.reload();
      };
    } else {
      leaveBtn.style.display = "none";
    }
  }

  /* Start Game button */
  const allFilled = Object.values(seats).every(id => id !== 0 && id !== "0");
  const canStart  = isHost && allFilled && !data.gameStarted;
  startGameButton.style.display = canStart ? "inline-block" : "none";
  startGameButton.disabled      = !canStart;
  startGameButton.onclick = () => update(ref(db, `lobbies/${lobbyId}`), { gameStarted: true });
}

/* ─── share dialog (QR + copy) ────────────────────────────────────────── */

function initShareButton() {
  const shareBtn = document.getElementById("shareLobbyButton");
  if (!shareBtn) return;

  shareBtn.onclick = () => {
    const url = `${location.origin}/DrinkingGames/lobby.html?code=${lobbyId}`;

    /* QR code */
    const qrCont = document.getElementById("qrCodeContainer");
    qrCont.innerHTML = "";
    const qr = new QRious({ value: url, size: 200 });
    qrCont.appendChild(Object.assign(new Image(), { src: qr.toDataURL() }));

    /* copy button */
    document.getElementById("copyLinkButton").onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        alert("Lobby link copied to clipboard!");
      } catch { alert("Failed to copy."); }
    };

    document.getElementById("qrModal").style.display = "block";
  };
}

/* ─── auto‑join when ?code=XYZ is present ─────────────────────────────── */

const autoCode = getQueryParam("code");
if (autoCode) {
  window.addEventListener("DOMContentLoaded", () => {
    lobbyCodeInput.value = autoCode;
    joinLobby();
    history.replaceState({}, "", "/DrinkingGames/lobby.html");
  });
}
