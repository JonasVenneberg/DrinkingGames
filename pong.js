import { db } from './firebase-config.js';
import {
  ref,
  get,
  set,
  update,
  onValue,
  onDisconnect,
  remove,
  runTransaction
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

const canvas   = document.getElementById("gameCanvas");
const ctx      = canvas.getContext("2d");
const msg      = document.getElementById("message");
const returnBtn = document.getElementById("returnBtn");

const ROUND_MS      = 60_000;
const PUNISHMENT_MS = 5_000;

const lobbyId  = new URLSearchParams(window.location.search).get("code");
const playerId = localStorage.getItem("playerId");

const gameRef  = ref(db, `games/${lobbyId}`);
const lobbyRef = ref(db, `lobbies/${lobbyId}`);

/* ──────────────────────────── presence handling (fixed) ──────────────────────────── */

const presenceRef      = ref(db, `presence/${lobbyId}/${playerId}`);
const presenceLobbyRef = ref(db, `presence/${lobbyId}`);

set(presenceRef, true);
onDisconnect(presenceRef).remove();

const CLEANUP_DELAY_MS = 10_000;   // 10 s grace period
let cleanupTimer = null;

onValue(presenceLobbyRef, snap => {
  const active = snap.exists() ? Object.keys(snap.val()).length : 0;

  // schedule deletion if everyone is gone
  if (active === 0 && !cleanupTimer) {
    cleanupTimer = setTimeout(async () => {
      const verify = await get(presenceLobbyRef);
      if (!verify.exists()) {
        await remove(gameRef);      // safe delete of /games/<lobbyId>
      }
      cleanupTimer = null;
    }, CLEANUP_DELAY_MS);
  }

  // abort deletion if someone came back
  if (active > 0 && cleanupTimer) {
    clearTimeout(cleanupTimer);
    cleanupTimer = null;
  }
});

/* ───────────────────────────────── game state ───────────────────────────────── */

let isCurrentPlayer  = false;
let currentPlayerId  = null;
let seatingOrder     = [];
let players          = {};
let seats            = {};
let startTime        = null;
let gameOver         = false;
let localResetTime   = 0;
let messageTimeout;
let punishmentShown  = false;

const paddle  = { x: 120, y: 470, width: 60, height: 10, prevX: 120 };
const ball    = { x: 150, y: 100, radius: 8, dx: 0, dy: 5 };
const gapSize = 50;

let keyPressed  = {};
let lastInputX  = null;

/* ──────────────────────────── utility: messages ────────────────────────────── */

function showMessage(text) {
  msg.textContent = text;
}

function setTemporaryMessage(text, fallback) {
  clearTimeout(messageTimeout);
  showMessage(text);
  messageTimeout = setTimeout(() => showMessage(fallback), 2500);
}

/* ───────────────────────────── game initialisation ─────────────────────────── */

function tryStartGame() {
  if (seatingOrder.length === 0) return;

  runTransaction(gameRef, current => {
    if (!current || !current.startTime) {
      const now = Date.now();
      startTime = now;
      return {
        ...(current || {}),
        currentPlayer: seatingOrder[0],
        ballResetTime: now,
        startTime: now
      };
    }
    return;                  // leave existing game untouched
  });
}

function updateStatusMessage() {
  const name = players[currentPlayerId]?.name;
  if (gameOver) return;

  if (isCurrentPlayer) {
    showMessage("🎯 Your turn!");
  } else if (name) {
    showMessage(`⏳ ${name} is playing...`);
  } else {
    showMessage("⏳ A player is playing...");
  }
}

/* ─────────────────────────────── Firebase listeners ────────────────────────── */

onValue(gameRef, snap => {
  const data = snap.val();
  if (!data) return;

  currentPlayerId = data.currentPlayer;
  isCurrentPlayer = currentPlayerId === playerId;
  if (data.startTime) startTime = data.startTime;

  if (data.gameOver && !gameOver) {
    gameOver = true;
    returnBtn.style.display = "block";
    if (isCurrentPlayer) {
      showMessage("💀 Time's up! You lost the game!");
    } else {
      const name = players[currentPlayerId]?.name || "Someone";
      showMessage(`🎉 ${name} lost the game!`);
    }
  }

  updateStatusMessage();

  if (data.ballResetTime && data.ballResetTime !== localResetTime) {
    localResetTime = data.ballResetTime;
    resetBall(data.ballState || null);
  }
});

onValue(lobbyRef, snap => {
  const data = snap.val();
  if (!data) return;

  players = data.players || {};
  seats   = data.seats   || {};

  seatingOrder = Object.entries(seats)
    .filter(([_, pid]) => pid && pid !== 0)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([_, pid]) => pid);

  tryStartGame();
  updateStatusMessage();
});

/* ─────────────────────────────── controls ─────────────────────────────────── */

document.addEventListener("keydown", e => (keyPressed[e.key.toLowerCase()] = true));
document.addEventListener("keyup",   e => (keyPressed[e.key.toLowerCase()] = false));

canvas.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  lastInputX = e.clientX - rect.left;
});
canvas.addEventListener("touchmove", e => {
  const touch = e.touches[0];
  const rect  = canvas.getBoundingClientRect();
  lastInputX  = touch.clientX - rect.left;
});

function updatePaddle() {
  if (gameOver) return;

  paddle.prevX = paddle.x;
  const speed  = 5;

  if (keyPressed["arrowleft"] || keyPressed["a"]) paddle.x -= speed;
  if (keyPressed["arrowright"] || keyPressed["d"]) paddle.x += speed;
  if (lastInputX !== null) paddle.x = lastInputX - paddle.width / 2;

  paddle.x = Math.max(0, Math.min(paddle.x, canvas.width - paddle.width));
}

/* ─────────────────────────────── drawing ──────────────────────────────────── */

function drawPaddle() {
  ctx.fillStyle = "white";
  ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
}

function drawBall() {
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fillStyle = "cyan";
  ctx.fill();
  ctx.closePath();
}

function drawGaps() {
  ctx.fillStyle = "lime";
  ctx.fillRect(0, 0, gapSize, 10);
  ctx.fillRect(canvas.width - gapSize, 0, gapSize, 10);
  ctx.fillStyle = "white";
  ctx.fillRect(gapSize, 0, canvas.width - 2 * gapSize, 10);
}

/* ───────────────────────────── ball handling ──────────────────────────────── */

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
      ball.x  = 150;
      ball.y  = 100;
      ball.dx = 0;
      ball.dy = isCurrentPlayer ? 5 : 0;
    }
    punishmentShown = false;
  };

  isPass ? apply() : setTimeout(apply, PUNISHMENT_MS);
}

function getNextPlayer(direction) {
  const index = seatingOrder.indexOf(playerId);
  if (index === -1) return playerId;

  const nextIndex = direction === "left"
    ? (index + 1) % seatingOrder.length
    : (index - 1 + seatingOrder.length) % seatingOrder.length;

  return seatingOrder[nextIndex];
}

function triggerNextTurn(direction, passMessage) {
  const nextPlayer = getNextPlayer(direction);
  const fallback   = players[nextPlayer]?.name
    ? `⏳ ${players[nextPlayer].name} is playing...`
    : "⏳ A player is playing...";

  setTemporaryMessage(passMessage, fallback);
  localResetTime = Date.now();

  update(gameRef, {
    currentPlayer: nextPlayer,
    ballResetTime: localResetTime,
    ballState: {
      x: ball.x,
      dx: ball.dx,
      entrySide: direction
    }
  });

  resetBall();
}

function endGame() {
  gameOver = true;
  update(gameRef, { gameOver: true });
  returnBtn.style.display = "block";

  if (isCurrentPlayer) {
    showMessage("💀 Time's up! You lost the game!");
  } else {
    const name = players[currentPlayerId]?.name || "Someone";
    showMessage(`🎉 ${name} lost the game!`);
  }
}

/* ───────────────────────────── game loop updates ──────────────────────────── */

function updateGame() {
  if (gameOver || punishmentShown || !isCurrentPlayer) return;

  if (startTime && Date.now() - startTime >= ROUND_MS) {
    endGame();
    return;
  }

  ball.x += ball.dx;
  ball.y += ball.dy;

  // bounce off side walls
  if (ball.x - ball.radius < 0 || ball.x + ball.radius > canvas.width) ball.dx *= -1;

  // top collisions and passes
  if (ball.y - ball.radius <= 10) {
    if (ball.x > gapSize && ball.x < canvas.width - gapSize) {
      ball.dy *= -1;                             // hit the bar
    } else if (ball.x < gapSize) {
      triggerNextTurn("left", "⬅️ Passed to the left!");
    } else if (ball.x > canvas.width - gapSize) {
      triggerNextTurn("right", "➡️ Passed to the right!");
    }
  }

  // paddle collision
  const paddleMoved = paddle.x - paddle.prevX;
  if (
    ball.y + ball.radius >= paddle.y &&
    ball.x > paddle.x &&
    ball.x < paddle.x + paddle.width &&
    ball.dy > 0
  ) {
    ball.dy *= -1;
    ball.y  = paddle.y - ball.radius;
    ball.dx += paddleMoved * 0.3;
    ball.dx  = Math.max(-5, Math.min(5, ball.dx));
  }

  // missed the paddle
  if (ball.y - ball.radius > canvas.height) {
    setTemporaryMessage("💥 You missed! Try again soon!", "🎯 Your turn!");
    resetBall();
  }
}

/* ───────────────────────────── drawing loop ───────────────────────────────── */

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGaps();
  drawPaddle();
  if (isCurrentPlayer) drawBall();
}

function loop() {
  updatePaddle();
  if (isCurrentPlayer && !punishmentShown) updateGame();
  draw();
  requestAnimationFrame(loop);
}

/* ───────────────────────────── navigation ─────────────────────────────────── */

returnBtn.onclick = () => {
  window.location.href = `lobby.html?code=${lobbyId}`;
};

/* ───────────────────────────── kick‑off ───────────────────────────────────── */

loop();
