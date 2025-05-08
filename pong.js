import { db } from './firebase-config.js';
import {
  ref, get, set, update, onValue
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-database.js";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const msg = document.getElementById("message");

const lobbyId = new URLSearchParams(window.location.search).get("code");
const playerId = localStorage.getItem("playerId");
const gameRef = ref(db, `games/${lobbyId}`);
const lobbyRef = ref(db, `lobbies/${lobbyId}`);

let isCurrentPlayer = false;
let currentPlayerId = null;
let seatingOrder = [];
let seats = {};
let players = {};
let localResetTime = 0;
let messageTimeout;

function showMessage(text) {
  msg.textContent = text;
}

function setTemporaryMessage(text, fallback) {
  clearTimeout(messageTimeout);
  showMessage(text);
  messageTimeout = setTimeout(() => {
    showMessage(fallback);
  }, 2500);
}

function tryStartGame() {
  if (seatingOrder.length === 0) return;
  get(gameRef).then(snap => {
    if (!snap.exists()) {
      set(gameRef, {
        currentPlayer: seatingOrder[0],
        ballResetTime: Date.now()
      });
    }
  });
}

function updateStatusMessage() {
  const name = players[currentPlayerId]?.name;
  if (isCurrentPlayer) {
    showMessage("🎯 Your turn!");
  } else if (name) {
    showMessage(`⏳ ${name} is playing...`);
  } else {
    showMessage("⏳ A player is playing...");
  }
}


onValue(gameRef, snapshot => {
  const data = snapshot.val();
  if (!data) return;

  currentPlayerId = data.currentPlayer;
  isCurrentPlayer = currentPlayerId === playerId;

  updateStatusMessage();

  if (data.ballResetTime && data.ballResetTime !== localResetTime) {
    localResetTime = data.ballResetTime;
    resetBall();
  }
});

onValue(lobbyRef, snapshot => {
  const data = snapshot.val();
  if (!data) return;

  players = data.players || {};
  seats = data.seats || {};

  seatingOrder = Object.entries(seats)
    .filter(([_, pid]) => pid && pid !== 0)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([_, pid]) => pid);

  tryStartGame();
  updateStatusMessage();
});

const paddle = { x: 120, y: 470, width: 60, height: 10, prevX: 120 };
const ball = { x: 150, y: 100, radius: 8, dx: 0, dy: 5 };

const gapSize = 50;
let punishmentShown = false;
let keyPressed = {};
let lastInputX = null;

document.addEventListener("keydown", e => keyPressed[e.key.toLowerCase()] = true);
document.addEventListener("keyup", e => keyPressed[e.key.toLowerCase()] = false);

canvas.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  lastInputX = e.clientX - rect.left;
});
canvas.addEventListener("touchmove", e => {
  const touch = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  lastInputX = touch.clientX - rect.left;
});

function updatePaddle() {
  paddle.prevX = paddle.x;
  const moveSpeed = 5;

  if (keyPressed["arrowleft"] || keyPressed["a"]) paddle.x -= moveSpeed;
  if (keyPressed["arrowright"] || keyPressed["d"]) paddle.x += moveSpeed;

  if (lastInputX !== null) {
    paddle.x = lastInputX - paddle.width / 2;
  }

  paddle.x = Math.max(0, Math.min(paddle.x, canvas.width - paddle.width));
}

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

function resetBall() {
  punishmentShown = true;
  setTimeout(() => {
    ball.x = 150;
    ball.y = 100;
    ball.dx = 0;
    ball.dy = isCurrentPlayer ? 5 : 0;
    punishmentShown = false;
  }, 5000);
}

function getNextPlayer(direction) {
  const index = seatingOrder.indexOf(playerId);
  if (index === -1) return playerId;
  const nextIndex = direction === "left"
    ? (index + 1 + seatingOrder.length) % seatingOrder.length
    : (index - 1 + seatingOrder.length) % seatingOrder.length;
  return seatingOrder[nextIndex];
}

function triggerNextTurn(direction, passMessage) {
  const nextPlayer = getNextPlayer(direction);
  update(gameRef, {
    currentPlayer: nextPlayer,
    ballResetTime: Date.now()
  });

  const fallback = `⏳ ${players[nextPlayer]?.name || "A player"} is playing...`;
  setTemporaryMessage(passMessage, fallback);
  resetBall();
}

function updateGame() {
  if (punishmentShown || !isCurrentPlayer) return;

  ball.x += ball.dx;
  ball.y += ball.dy;

  if (ball.x - ball.radius < 0 || ball.x + ball.radius > canvas.width) {
    ball.dx *= -1;
  }

  if (ball.y - ball.radius <= 10) {
    if (ball.x > gapSize && ball.x < canvas.width - gapSize) {
      ball.dy *= -1;
    } else if (ball.x < gapSize) {
      triggerNextTurn("left", "⬅️ Passed to the left!");
    } else if (ball.x > canvas.width - gapSize) {
      triggerNextTurn("right", "➡️ Passed to the right!");
    }
  }

  const paddleMoved = paddle.x - paddle.prevX;
  if (
    ball.y + ball.radius >= paddle.y &&
    ball.x > paddle.x &&
    ball.x < paddle.x + paddle.width &&
    ball.dy > 0
  ) {
    ball.dy *= -1;
    ball.y = paddle.y - ball.radius;
    ball.dx += paddleMoved * 0.3;
    ball.dx = Math.max(-5, Math.min(5, ball.dx));
  }

  if (ball.y - ball.radius > canvas.height) {
    setTemporaryMessage("💥 You missed! Try again in 5 seconds!", "🎯 Your turn!");
    resetBall();
  }
}

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

loop();
