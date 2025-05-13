// [top imports + setup... identical]
import { db } from "./firebase-config.js";
import {
  ref, get, set, update, onValue, onDisconnect, remove, runTransaction
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const msg = document.getElementById("message");
const returnBtn = document.getElementById("returnBtn");

const ROUND_MS = 60_000;
const PUNISHMENT_MS = 5_000;
const STEP_MS = 16.667;
const PASS_COOLDOWN_MS = 300;

const lobbyId = new URLSearchParams(window.location.search).get("code");
const playerId = localStorage.getItem("playerId");

const gameRef = ref(db, `games/${lobbyId}`);
const lobbyRef = ref(db, `lobbies/${lobbyId}`);

/* ───── presence ───── */
const presenceRef = ref(db, `presence/${lobbyId}/${playerId}`);
const presenceLobbyRef = ref(db, `presence/${lobbyId}`);
set(presenceRef, true);
onDisconnect(presenceRef).remove();

const CLEANUP_DELAY_MS = 10_000;
let cleanupTimer = null;

onValue(presenceLobbyRef, snap => {
  const active = snap.exists() ? Object.keys(snap.val()).length : 0;
  if (active === 0 && !cleanupTimer) {
    cleanupTimer = setTimeout(async () => {
      const verify = await get(presenceLobbyRef);
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

/* ───── state ───── */
let isCurrentPlayer = false;
let currentPlayerId = null;
let seatingOrder = [];
let players = {};
let seats = {};
let startTime = null;
let gameOver = false;
let localResetTime = 0;
let messageTimeout;
let punishmentShown = false;

const paddle = { x: 120, y: 470, width: 60, height: 10, prevX: 120 };
const ball = { x: 150, y: 100, radius: 8, dx: 0, dy: 5 };
const gapSize = 50;

let keyPressed = {};
let lastInputX = null;
let lastPassTime = 0;

/* ───── helpers ───── */
const showMessage = txt => msg.textContent = txt;

function setTemporaryMessage(txt, fallback) {
  clearTimeout(messageTimeout);
  showMessage(txt);
  messageTimeout = setTimeout(() => showMessage(fallback), 2500);
}

/* ───── startup ───── */
function tryStartGame() {
  if (seatingOrder.length === 0) return;
  runTransaction(gameRef, cur => {
    if (!cur || cur.gameOver === true) {
      const now = Date.now();
      startTime = now;
      return {
        currentPlayer: seatingOrder[0],
        ballResetTime: now,
        startTime: now,
        gameOver: false
      };
    }
    return;
  });
}

/* ───── Firebase listeners ───── */
onValue(gameRef, snap => {
  const d = snap.val();
  if (!d) return;

  currentPlayerId = d.currentPlayer;
  isCurrentPlayer = currentPlayerId === playerId;
  if (d.startTime) startTime = d.startTime;

  if (d.gameOver && !gameOver) {
    gameOver = true;
    returnBtn.style.display = "block";
    const loser = players[currentPlayerId]?.name || "Someone";
    showMessage(isCurrentPlayer ? "💀 Time's up! You lost the game!" : `🎉 ${loser} lost the game!`);
  }

  if (!gameOver) {
    const name = players[currentPlayerId]?.name;
    showMessage(isCurrentPlayer ? "🎯 Your turn!" : name ? `⏳ ${name} is playing...` : "⏳ A player is playing...");
  }

  if (d.ballResetTime && d.ballResetTime !== localResetTime) {
    localResetTime = d.ballResetTime;
    resetBall(d.ballState || null);
  }
});

onValue(lobbyRef, async snap => {
  const d = snap.val();
  if (!d || !d.players || !d.seats) return;

  players = d.players;
  seats = d.seats;

  seatingOrder = Object.entries(seats)
    .filter(([_, pid]) => pid && pid !== 0)
    .sort(([a], [b]) => +a - +b)
    .map(([_, pid]) => pid);

  tryStartGame();

  // NEW: Post-game cleanup once all players click Return
  const seatedIds = Object.values(seats).filter(id => id && id !== 0);
  const allDone = seatedIds.every(pid => d.players[pid]?.done);
  if (allDone) {
    await update(lobbyRef, { gameStarted: false });
    await remove(gameRef);
    for (const pid of Object.keys(d.players)) {
      await update(ref(db, `lobbies/${lobbyId}/players/${pid}`), { done: null });
    }
  }
});

/* ───── controls ───── */
document.addEventListener("keydown", e => keyPressed[e.key.toLowerCase()] = true);
document.addEventListener("keyup", e => keyPressed[e.key.toLowerCase()] = false);
canvas.addEventListener("mousemove", e => {
  const r = canvas.getBoundingClientRect();
  lastInputX = e.clientX - r.left;
});
canvas.addEventListener("touchmove", e => {
  const r = canvas.getBoundingClientRect();
  lastInputX = e.touches[0].clientX - r.left;
});
function updatePaddle(dt) {
  if (gameOver) return;
  paddle.prevX = paddle.x;
  const speed = 5 * dt / STEP_MS;
  if (keyPressed["arrowleft"] || keyPressed["a"]) paddle.x -= speed;
  if (keyPressed["arrowright"] || keyPressed["d"]) paddle.x += speed;
  if (lastInputX !== null) paddle.x = lastInputX - paddle.width / 2;
  paddle.x = Math.max(0, Math.min(canvas.width - paddle.width, paddle.x));
}

/* ───── drawing ───── */
function drawPaddle() { ctx.fillStyle = "#fff"; ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height); }
function drawBall() {
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fillStyle = "cyan";
  ctx.fill();
}
function drawGaps() {
  ctx.fillStyle = "lime";
  ctx.fillRect(0, 0, gapSize, 10);
  ctx.fillRect(canvas.width - gapSize, 0, gapSize, 10);
  ctx.fillStyle = "#fff";
  ctx.fillRect(gapSize, 0, canvas.width - 2 * gapSize, 10);
}

/* ───── ball logic ───── */
function resetBall(state = null) {
  const isPass = !!state;
  if (!isPass) punishmentShown = true;
  const apply = () => {
    if (state && isCurrentPlayer) {
      ball.x = state.entrySide === "left" ? canvas.width - gapSize / 2 : gapSize / 2;
      ball.y = 20;
      ball.dx = state.dx || 0;
      ball.dy = 5;
    } else {
      ball.x = 150; ball.y = 100; ball.dx = 0; ball.dy = isCurrentPlayer ? 5 : 0;
    }
    punishmentShown = false;
  };
  isPass ? apply() : setTimeout(apply, PUNISHMENT_MS);
}

function getNextPlayer(dir) {
  const idx = seatingOrder.indexOf(playerId);
  if (idx === -1) return playerId;
  return seatingOrder[(dir === "left" ? idx + 1 : idx - 1 + seatingOrder.length) % seatingOrder.length];
}

function triggerNextTurn(dir, msg) {
  const now = Date.now();
  if (now - lastPassTime < PASS_COOLDOWN_MS) return;
  lastPassTime = now;
  const next = getNextPlayer(dir);
  const fallback = players[next]?.name ? `⏳ ${players[next].name} is playing...` : "⏳ A player is playing...";
  setTemporaryMessage(msg, fallback);
  localResetTime = now;
  update(gameRef, {
    currentPlayer: next,
    ballResetTime: localResetTime,
    ballState: { dx: ball.dx, entrySide: dir }
  });
  resetBall();
}

/* ───── game update ───── */
function updateGame(dt) {
  if (gameOver || punishmentShown || !isCurrentPlayer) return;
  if (startTime && Date.now() - startTime >= ROUND_MS) { endGame(); return; }

  const step = dt / STEP_MS;
  ball.x += ball.dx * step;
  ball.y += ball.dy * step;

  if (ball.x - ball.radius < 0 || ball.x + ball.radius > canvas.width) {
    ball.dx *= -1;
    ball.x = Math.max(ball.radius, Math.min(canvas.width - ball.radius, ball.x));
  }

  if (ball.y - ball.radius <= 10) {
    if (ball.x > gapSize && ball.x < canvas.width - gapSize) {
      ball.dy *= -1;
      ball.y = 10 + ball.radius;
    } else if (ball.x < gapSize) {
      triggerNextTurn("left", "⬅️ Passed to the left!");
    } else {
      triggerNextTurn("right", "➡️ Passed to the right!");
    }
  }

  const paddleMoved = paddle.x - paddle.prevX;
  if (
    ball.y + ball.radius >= paddle.y &&
    ball.x > paddle.x && ball.x < paddle.x + paddle.width && ball.dy > 0
  ) {
    ball.dy *= -1;
    ball.y = paddle.y - ball.radius;
    ball.dx = Math.max(-5, Math.min(5, ball.dx + paddleMoved * 0.3));
  }

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
  showMessage(isCurrentPlayer ? "💀 Time's up! You lost the game!" : `🎉 ${loser} lost the game!`);
}

/* ───── loop ───── */
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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

/* ───── navigation ───── */
returnBtn.onclick = async () => {
  await update(ref(db, `lobbies/${lobbyId}/players/${playerId}`), { done: true });
  window.location.href = `lobby.html?code=${lobbyId}`;
};
