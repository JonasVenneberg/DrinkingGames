/**************************************************************************
 *  lobby.js – multiplayer lobby for the Drinking Games project
 *  – preserves player names
 *  – prevents premature restarts
 *  – publishes presence from the lobby page, too
 **************************************************************************/

import { db } from "./firebase-config.js";
import {
  ref, set, get, update, onValue, remove, onDisconnect
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

/* ─── persistent ID for this browser ──────────────────────────────────── */
const localPlayerId =
  localStorage.getItem("playerId") || crypto.randomUUID();
localStorage.setItem("playerId", localPlayerId);

/* ─── UI handles ──────────────────────────────────────────────────────── */
const lobbyCodeInput  = document.getElementById("lobbyCodeInput");
const tableDiv        = document.getElementById("table");
const unseatedDiv     = document.getElementById("unseatedPlayers");
const hostControls    = document.getElementById("hostControls");
const startGameButton = document.getElementById("startGameButton");

/* ─── globals ─────────────────────────────────────────────────────────── */
let lobbyId   = null;
let isHost    = false;
let leftLobby = false;
let presenceRef;

/* ─── helpers ─────────────────────────────────────────────────────────── */
const generateCode = () =>
  Math.random().toString(36).slice(2, 8).toUpperCase();

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

/* ─── presence handling ──────────────────────────────────────────────── */
function initPresence() {
  if (!lobbyId) return;
  presenceRef = ref(db, `presence/${lobbyId}/${localPlayerId}`);
  set(presenceRef, true);
  onDisconnect(presenceRef).remove();
}

/* ─── helper: delete lobbies with zero players ───────────────────────── */
async function cleanEmptyLobbies() {
  const allLobbiesSnap = await get(ref(db, "lobbies"));
  if (!allLobbiesSnap.exists()) return;

  const deletions = [];
  const all = allLobbiesSnap.val();

  for (const [id, lobby] of Object.entries(all)) {
    const players = lobby.players || {};
    const hasAny  = Object.values(players).some(pid => pid && pid !== 0);

    if (!hasAny) {
      deletions.push(
        remove(ref(db, `lobbies/${id}`)),
        remove(ref(db, `games/${id}`)),
        remove(ref(db, `presence/${id}`))
      );
    }
  }
  if (deletions.length) await Promise.all(deletions);
}

/* ─── lobby creation / join ──────────────────────────────────────────── */
window.createLobby = async function () {

  await cleanEmptyLobbies();

  lobbyId = generateCode();
  isHost  = true;

  const players = {
    [localPlayerId]: { name: "Host", joinedAt: Date.now(), seat: null }
  };

  const seats = {};
  for (let i = 1; i <= 5; i++) seats[i] = 0;

  await set(ref(db, `lobbies/${lobbyId}`), {
    hostId: localPlayerId,
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

  const lobbySnap = await get(ref(db, `lobbies/${code}`));
  if (!lobbySnap.exists()) {
    alert("Lobby not found.");
    return;
  }

  lobbyId = code;
  const data = lobbySnap.val();
  isHost = data.hostId === localPlayerId;

  /* keep existing name if we already have a record */
  if (!data.players?.[localPlayerId]) {
    await set(
      ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`),
      { name: "Player", joinedAt: Date.now(), seat: null }
    );
  }

  initPresence();
  enterLobbyUI();
  listenToLobby();
};

/* ─── host / player name edits ───────────────────────────────────────── */
window.saveNewName = async function () {
  const input = document.getElementById("nameChangeInput");
  const newName = input.value.trim();
  if (newName) {
    await update(
      ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`),
      { name: newName }
    );
  }
};

window.updateHostName = async function () {
  const newName = document.getElementById("hostNameInput").value.trim();
  if (newName) {
    await update(
      ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`),
      { name: newName }
    );
  }
};

/* ─── seat‑count change (host‑only) ──────────────────────────────────── */
window.updateSeatCount = async function () {
  const input = document.getElementById("seatCountInput");
  const newCount = parseInt(input.value, 10);
  if (isNaN(newCount) || newCount < 1 || newCount > 12) return;

  const seatsRef = ref(db, `lobbies/${lobbyId}/seats`);
  const snap     = await get(seatsRef);
  const current  = snap.val() || {};

  const updates = {};

  /* add new seats */
  for (let i = 1; i <= newCount; i++) {
    if (!(i in current)) updates[`seats/${i}`] = 0;
  }

  /* remove extra seats & unseat players sitting there */
  for (let i = newCount + 1; i <= Object.keys(current).length; i++) {
    if (current[i] !== 0) {
      const pid = current[i];
      await update(
        ref(db, `lobbies/${lobbyId}/players/${pid}`),
        { seat: null }
      );
    }
    updates[`seats/${i}`] = null;
  }

  await update(ref(db, `lobbies/${lobbyId}`), updates);
};

/* ─── enter the lobby UI ─────────────────────────────────────────────── */
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
    document.getElementById("closeLobbyButton").onclick = async () => {
      await remove(ref(db, `lobbies/${lobbyId}`));
      location.reload();
    };
  } else {
    hostControls.innerHTML = `
      <label>Choose your name: <input id="nameChangeInput" /></label>
      <button onclick="saveNewName()">Save</button>
    `;
  }
}

/* ─── main realtime listener ─────────────────────────────────────────── */
function listenToLobby() {
  const lobbyRef = ref(db, `lobbies/${lobbyId}`);

  onValue(lobbyRef, async snap => {
    const data = snap.val();
    if (!data) { location.reload(); return; }

    const players = data.players || {};
    const seats   = data.seats   || {};

    /* auto‑redirect to game ONLY if this player hasn't pressed Return */
    if (data.gameStarted && !(data.players?.[localPlayerId]?.done)) {
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
    renderButtons(data, seats, players);
  });

  initShareButton();
}

/* ─── table / seating ────────────────────────────────────────────────── */
function renderTable(players, seats) {
  tableDiv.innerHTML = "";

  const entries = Object.entries(seats);
  const total   = entries.length;
  const R       = 120;
  const CX      = 140;
  const CY      = 140;

  entries.forEach(([seatNum, pid], idx) => {
    const angle = (idx / total) * 2 * Math.PI;
    const x     = CX + R * Math.cos(angle);
    const y     = CY + R * Math.sin(angle);

    const seat = document.createElement("div");
    seat.className = "seat";
    seat.style.left = `${x}px`;
    seat.style.top  = `${y}px`;
    seat.dataset.seat = seatNum;

    if (String(pid) !== "0") {
      const player = players[pid];
      seat.textContent = player ? player.name : "Taken";
      seat.classList.add("taken");
      if (pid === localPlayerId) seat.classList.add("self");

      if (isHost) {
        seat.style.cursor = "pointer";
        seat.onclick = async () => {
          await update(ref(db, `lobbies/${lobbyId}`), { [`seats/${seatNum}`]: 0 });
          await update(
            ref(db, `lobbies/${lobbyId}/players/${pid}`),
            { seat: null, blockedUntil: Date.now() + 3000 }
          );
        };
      }
    } else {
      seat.textContent = `Seat ${seatNum}`;
      seat.style.cursor = "pointer";
      seat.onclick = () => trySit(seatNum, players, seats);
    }

    tableDiv.appendChild(seat);
  });
}

async function trySit(seatNum, players, seats) {
  const me = players[localPlayerId];
  if (me?.blockedUntil && Date.now() < me.blockedUntil) return;

  const updates = {};
  for (const [num, id] of Object.entries(seats)) {
    if (String(id) === localPlayerId) updates[`seats/${num}`] = 0;
  }
  updates[`seats/${seatNum}`] = localPlayerId;

  await update(ref(db, `lobbies/${lobbyId}`), updates);
  await update(
    ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`),
    { seat: +seatNum }
  );
}

/* ─── unseated pool ──────────────────────────────────────────────────── */
function renderUnseated(players, seats) {
  unseatedDiv.innerHTML = "";

  const seatedIds =
    new Set(Object.values(seats).filter(id => id && id !== "0"));

  for (const [id, player] of Object.entries(players)) {
    if (seatedIds.has(id)) continue;

    const div = document.createElement("div");
    div.className = "player";
    div.textContent = player.name;

    if (isHost && id !== localPlayerId) {
      div.style.cursor = "pointer";
      div.onclick = async () =>
        await remove(ref(db, `lobbies/${lobbyId}/players/${id}`));
    }

    unseatedDiv.appendChild(div);
  }
}

/* ─── buttons (unseat, leave, start) ─────────────────────────────────── */
function renderButtons(data, seats, players) {
  /* unseat yourself */
  const unseatBtn = document.getElementById("unseatButton");
  if (unseatBtn) {
    const mySeat =
      Object.entries(seats).find(([_, id]) => String(id) === localPlayerId);
    unseatBtn.style.display = mySeat ? "inline-block" : "none";
    unseatBtn.onclick = async () => {
      if (!mySeat) return;
      const [num] = mySeat;
      await update(ref(db, `lobbies/${lobbyId}`), { [`seats/${num}`]: 0 });
      await update(
        ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`),
        { seat: null, blockedUntil: Date.now() + 3000 }
      );
    };
  }

  /* leave lobby (non‑host) */
  const leaveBtn = document.getElementById("leaveLobbyButton");
  if (leaveBtn) {
    if (!isHost) {
      leaveBtn.style.display = "inline-block";
      leaveBtn.onclick = async () => {
        leftLobby = true;
        await remove(
          ref(db, `lobbies/${lobbyId}/players/${localPlayerId}`)
        );
        location.reload();
      };
    } else {
      leaveBtn.style.display = "none";
    }
  }

  /* start game */
  const allFilled = Object.values(seats).every(id => id && id !== "0");
  const canStart  = isHost && allFilled && !data.gameStarted;
  startGameButton.style.display = canStart ? "inline-block" : "none";
  startGameButton.disabled      = !canStart;
  if (canStart) {
    startGameButton.onclick = async () => {
      const updates = { gameStarted: true };
      Object.keys(players).forEach(pid => {
        updates[`players/${pid}/done`] = null;
      });
      await update(ref(db, `lobbies/${lobbyId}`), updates);
    };
  }
}

/* ─── share lobby dialog (QR + copy) ─────────────────────────────────── */
function initShareButton() {
  const shareBtn = document.getElementById("shareLobbyButton");
  if (!shareBtn) return;

  shareBtn.onclick = () => {
    const url = `${location.origin}/DrinkingGames/lobby.html?code=${lobbyId}`;

    const qrCont = document.getElementById("qrCodeContainer");
    qrCont.innerHTML = "";
    const qr = new QRious({ value: url, size: 200 });
    qrCont.appendChild(
      Object.assign(new Image(), { src: qr.toDataURL() })
    );

    document.getElementById("copyLinkButton").onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        alert("Lobby link copied!");
      } catch {
        alert("Copy failed.");
      }
    };

    document.getElementById("qrModal").style.display = "block";
  };
}

/* ─── auto‑join via ?code=XYZ ─────────────────────────────────────────── */
const auto = getQueryParam("code");
if (auto) {
  window.addEventListener("DOMContentLoaded", () => {
    lobbyCodeInput.value = auto;
    joinLobby();
    history.replaceState({}, "", "/DrinkingGames/lobby.html");
  });
}
