import { db } from "./firebase-config.js";
import {
  ref, get, set, update, onValue,
  onDisconnect, remove, runTransaction
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

/* ─── constants ───────────────────────────────────────────────────────── */
const ROUND_MS         = 60_000;
const PUNISHMENT_MS    = 5_000;
const STEP_MS          = 16.667;   // 60 fps frame
const PASS_COOLDOWN_MS = 300;

/* ─── DOM elements ────────────────────────────────────────────────────── */
const canvas    = document.getElementById("gameCanvas");
const ctx       = canvas.getContext("2d");
const msg       = document.getElementById("message");
const returnBtn = document.getElementById("returnBtn");

/* ─── IDs & DB refs ───────────────────────────────────────────────────── */
const lobbyId  = new URLSearchParams(window.location.search).get("code");
const playerId = localStorage.getItem("playerId");

const gameRef      = ref(db, `games/${lobbyId}`);
const lobbyRef     = ref(db, `lobbies/${lobbyId}`);
const presenceRef  = ref(db, `presence/${lobbyId}/${playerId}`);
const presenceRoot = ref(db, `presence/${lobbyId}`);

/* ─── server‑time helper ──────────────────────────────────────────────── */
let serverOffset = 0;
onValue(ref(db, ".info/serverTimeOffset"),
        snap => { serverOffset = snap.val() || 0; });
const serverNow = () => Date.now() + serverOffset;

/* ─── presence (auto‑cleanup fallback) ────────────────────────────────── */
set(presenceRef, true);
onDisconnect(presenceRef).remove();

let cleanupTimer = null;
const CLEANUP_DELAY_MS = 10_000;

onValue(presenceRoot, snap => {
  const active = snap.exists() ? Object.keys(snap.val()).length : 0;
  if (active === 0 && !cleanupTimer) {
    cleanupTimer = setTimeout(async () => {
      const verify = await get(presenceRoot);
      if (!verify.exists()) {
        await remove(gameRef);
        await update(lobbyRef, { gameStarted: false });
      }
      cleanupTimer = null;
    }, CLEANUP_DELAY_MS);
  }
  if (active > 0 && cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
});

/* ─── local state ─────────────────────────────────────────────────────── */
let isHost, isCurrentPlayer, currentPlayerId;
let players = {}, seats = {}, seatingOrder = [];

let startTime      = null;
let gameOver       = false;
let localResetTime = 0;
let punishmentShown = false;
let messageTimeout;
let lastPassTime   = 0;

/* ─── paddle & ball ───────────────────────────────────────────────────── */
const paddle = { x: 120, y: 470, width: 60, height: 10, prevX: 120 };
const ball   = { x: 150, y: 100, radius: 8, dx: 0, dy: 5 };
const gapSize = 50;

/* ─── input tracking ─────────────────────────────────────────────────── */
let keyPressed = {};
let lastInputX = null;
document.addEventListener("keydown", e => keyPressed[e.key.toLowerCase()] = true);
document.addEventListener("keyup",   e => keyPressed[e.key.toLowerCase()] = false);
canvas.addEventListener("mousemove", e => {
  const r = canvas.getBoundingClientRect();
  lastInputX = e.clientX - r.left;
});
canvas.addEventListener("touchmove", e => {
  const r = canvas.getBoundingClientRect();
  lastInputX = e.touches[0].clientX - r.left;
});

/* ─── UI helper ───────────────────────────────────────────────────────── */
const showMessage = t => { msg.textContent = t; };
function setTemporaryMessage(t, fb) {
  clearTimeout(messageTimeout);
  showMessage(t);
  messageTimeout = setTimeout(() => showMessage(fb), 2500);
}

/* ─── attempt to start a round ────────────────────────────────────────── */
function tryStartGame() {
  if (!seatingOrder.length) return;
  const now = serverNow();
  runTransaction(gameRef, cur => {
    if (!cur || cur.gameOver) {
      startTime = now;
      return {
        currentPlayer: seatingOrder[0],
        ballResetTime: now,
        startTime:     now,
        gameOver:      false
      };
    }
    return;
  });
}

/* ─── Firebase listeners ─────────────────────────────────────────────── */
onValue(gameRef, snap => {
  const g = snap.val(); if (!g) return;

  currentPlayerId = g.currentPlayer;
  isCurrentPlayer = currentPlayerId === playerId;
  if (g.startTime) startTime = g.startTime;

  if (g.gameOver && !gameOver) {
    gameOver = true;
    returnBtn.style.display = "block";
    const loser = players[currentPlayerId]?.name || "Someone";
    showMessage(isCurrentPlayer
      ? "💀 Time's up! You lost the game!"
      : `🎉 ${loser} lost the game!`);
  }

  if (!gameOver) {
    const n = players[currentPlayerId]?.name;
    showMessage(isCurrentPlayer
      ? "🎯 Your turn!"
      : n ? `⏳ ${n} is playing...` : "⏳ A player is playing...");
  }

  /* apply incoming reset from the DB */
  if (g.ballResetTime && g.ballResetTime !== localResetTime) {
    localResetTime = g.ballResetTime;
    resetBall(g.ballState || null);
  }
});

onValue(lobbyRef, async snap => {
  const d = snap.val(); if (!d || !d.players || !d.seats) return;

  players = d.players;
  seats   = d.seats;
  isHost  = d.hostId === playerId;

  seatingOrder = Object.entries(seats)
    .filter(([_, pid]) => pid && pid !== 0)
    .sort(([a],[b]) => +a - +b)
    .map(([_, pid]) => pid);

  tryStartGame();

  /* cleanup after EVERYONE clicked Return */
  const seatedIds = Object.values(seats).filter(id => id && id !== 0);
  const allDone   = seatedIds.every(pid => players[pid]?.done);
  if (allDone && seatedIds.length) {
    await remove(gameRef);
    await update(lobbyRef, { gameStarted: false });
    for (const pid of Object.keys(players)) {
      await update(ref(db, `lobbies/${lobbyId}/players/${pid}`), { done: null });
    }
  }
});

/* ─── paddle update ───────────────────────────────────────────────────── */
function updatePaddle(dt) {
  if (gameOver) return;
  paddle.prevX = paddle.x;
  const speed = 5 * dt / STEP_MS;
  if (keyPressed["arrowleft"] || keyPressed["a"]) paddle.x -= speed;
  if (keyPressed["arrowright"] || keyPressed["d"]) paddle.x += speed;
  if (lastInputX !== null) paddle.x = lastInputX - paddle.width / 2;
  paddle.x = Math.max(0, Math.min(canvas.width - paddle.width, paddle.x));
}

/* ─── drawing helpers ─────────────────────────────────────────────────── */
function drawPaddle() { ctx.fillStyle = "#fff"; ctx.fillRect(paddle.x,paddle.y,paddle.width,paddle.height); }
function drawBall()   { ctx.beginPath(); ctx.arc(ball.x,ball.y,ball.radius,0,Math.PI*2); ctx.fillStyle="cyan"; ctx.fill(); }
function drawGaps()   {
  ctx.fillStyle="lime";
  ctx.fillRect(0,0,gapSize,10);
  ctx.fillRect(canvas.width-gapSize,0,gapSize,10);
  ctx.fillStyle="#fff";
  ctx.fillRect(gapSize,0,canvas.width-2*gapSize,10);
}

/* ─── ball reset / pass logic ─────────────────────────────────────────── */
function resetBall(state = null) {
  const isPass = !!state;
  if (!isPass) punishmentShown = true;

  const apply = () => {
    if (state && isCurrentPlayer) {
      ball.x  = state.entrySide === "left" ? canvas.width - gapSize / 2 : gapSize / 2;
      ball.y  = 20;
      ball.dx = state.dx || 0;
      ball.dy = 5;
    } else {
      ball.x = 150; ball.y = 100; ball.dx = 0;
      ball.dy = isCurrentPlayer ? 5 : 0;
    }
    punishmentShown = false;
  };

  isPass ? apply() : setTimeout(apply, PUNISHMENT_MS);
}

function getNextPlayer(dir) {
  const idx = seatingOrder.indexOf(playerId);
  if (idx === -1) return playerId;
  return seatingOrder[
    (dir === "left" ? idx + 1 : idx - 1 + seatingOrder.length) % seatingOrder.length
  ];
}

function triggerNextTurn(dir, msg) {
  const now = serverNow();
  if (now - lastPassTime < PASS_COOLDOWN_MS) return;  // debounced
  lastPassTime = now;

  const next = getNextPlayer(dir);
  const fb   = players[next]?.name
    ? `⏳ ${players[next].name} is playing...`
    : "⏳ A player is playing...";
  setTemporaryMessage(msg, fb);

  localResetTime = now;
  update(gameRef, {
    currentPlayer : next,
    ballResetTime : localResetTime,
    ballState     : { dx: ball.dx, entrySide: dir }
  });

  /*  ⚠️  No local resetBall() call here anymore.
      That call was scheduling a "miss" reset after 5 s,
      which caused the mid‑screen drop. */
}

/* ─── main physics loop ──────────────────────────────────────────────── */
function updateGame(dt) {
  if (gameOver || punishmentShown || !isCurrentPlayer) return;
  if (isHost && startTime && serverNow() - startTime >= ROUND_MS) { endGame(); return; }

  const step = dt / STEP_MS;
  ball.x += ball.dx * step;
  ball.y += ball.dy * step;

  /* walls */
  if (ball.x - ball.radius < 0 || ball.x + ball.radius > canvas.width) {
    ball.dx *= -1;
    ball.x = Math.max(ball.radius, Math.min(canvas.width - ball.radius, ball.x));
  }

  /* top bar / gaps */
  if (ball.y - ball.radius <= 10) {
    if (ball.x > gapSize && ball.x < canvas.width - gapSize) {
      ball.dy *= -1;
      ball.y = 10 + ball.radius;
    } else if (ball.x < gapSize) {
      triggerNextTurn("left",  "⬅️ Passed to the left!");
    } else {
      triggerNextTurn("right", "➡️ Passed to the right!");
    }
  }

  /* paddle */
  const move = paddle.x - paddle.prevX;
  if (
    ball.y + ball.radius >= paddle.y &&
    ball.x > paddle.x && ball.x < paddle.x + paddle.width &&
    ball.dy > 0
  ) {
    ball.dy *= -1;
    ball.y  = paddle.y - ball.radius;
    ball.dx = Math.max(-5, Math.min(5, ball.dx + move * 0.3));
  }

  /* miss */
  if (ball.y - ball.radius > canvas.height) {
    setTemporaryMessage("💥 You missed! Try again soon!", "🎯 Your turn!");
    resetBall();
  }
}

function endGame() {
  gameOver = true;
  update(gameRef, { gameOver: true });
  returnBtn.style.display = "block";
  const loser = players[currentPlayerId]?.name || "Someone";
  showMessage(isCurrentPlayer
    ? "💀 Time's up! You lost the game!"
    : `🎉 ${loser} lost the game!`);
}

/* ─── rendering loop ─────────────────────────────────────────────────── */
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);
  drawGaps(); drawPaddle(); if (isCurrentPlayer) drawBall();
}
let last = performance.now();
function loop(now) {
  const dt = Math.min(32, now - last); last = now;
  updatePaddle(dt);
  if (isCurrentPlayer) updateGame(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

/* ─── Return to Lobby ─────────────────────────────────────────────────── */
returnBtn.onclick = async () => {
  await update(ref(db, `lobbies/${lobbyId}/players/${playerId}`), { done: true });
  window.location.href = `lobby.html?code=${lobbyId}`;
};
