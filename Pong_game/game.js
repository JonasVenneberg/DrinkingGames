// Pong_game/game.js
import { getState } from "./state.js";
import { updateGame, serverNow } from "./firebase.js";
import { showMessage, setTemporaryMessage, requestFrame } from "./ui.js";

// ─── Game Objects ────────────────────────────────────────────
const paddle = { x: 120, y: 470, width: 60, height: 10, prevX: 120 };
const ball = { x: 150, y: 100, radius: 8, dx: 0, dy: 5 };
const gapSize = 50;
const STEP_MS = 16.667;
const PASS_COOLDOWN_MS = 300;
const PUNISHMENT_MS = 5000;

let canvas, ctx;
let keyPressed = {};
let lastInputX = null;

let localResetTime = 0;
let lastPassTime = 0;
let punishmentShown = false;
let ballActive = true;

// ─── Public Init ─────────────────────────────────────────────
export function initGameLoop(targetCanvas) {
  canvas = targetCanvas;
  ctx = canvas.getContext("2d");

  // Input listeners
  document.addEventListener("keydown", e => keyPressed[e.key.toLowerCase()] = true);
  document.addEventListener("keyup", e => keyPressed[e.key.toLowerCase()] = false);

  canvas.addEventListener("mousemove", e => {
    const r = canvas.getBoundingClientRect();
    lastInputX = e.clientX - r.left;
  });

  canvas.addEventListener("touchmove", e => {
    const r = canvas.getBoundingClientRect();
    lastInputX = e.touches[0].clientX - r.left;
  }, { passive: false });

  // Touch scroll disable
  canvas.addEventListener("touchstart", e => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });

  canvas.addEventListener("touchmove", e => e.preventDefault(), { passive: false });
  document.body.style.overflow = "hidden";

  requestFrame(loop);
}

// ─── Ball Reset ──────────────────────────────────────────────
export function resetBallWithState(state = null) {
  ballActive = false;
  punishmentShown = !state;

  const apply = () => {
    if (state && getState().isCurrentPlayer) {
      ball.x = state.entrySide === "left" ? canvas.width - gapSize / 2 : gapSize / 2;
      ball.y = 20;
      ball.dx = state.dx || 0;
      ball.dy = 5;
    } else {
      ball.x = 150;
      ball.y = 100;
      ball.dx = 0;
      ball.dy = getState().isCurrentPlayer ? 5 : 0;
    }
    ballActive = true;
    punishmentShown = false;
  };

  setTimeout(apply, state ? 0 : PUNISHMENT_MS);
}

// ─── Handle Miss ─────────────────────────────────────────────
export function handleMiss() {
  ballActive = false;
  punishmentShown = true;
  setTemporaryMessage("💥 You missed! Try again soon!", "🎯 Your turn!");
  setTimeout(() => resetBallWithState(), PUNISHMENT_MS);
}

// ─── Game Loop ───────────────────────────────────────────────
let last = performance.now();
function loop(now) {
  const dt = Math.min(32, now - last);
  last = now;

  if (getState().isCurrentPlayer && !punishmentShown && ballActive) {
    updatePaddle(dt);
    updateBall(dt);
  }

  draw();
  requestFrame(loop);
}

// ─── Paddle Movement ─────────────────────────────────────────
function updatePaddle(dt) {
  paddle.prevX = paddle.x;
  const speed = 5 * dt / STEP_MS;
  if (keyPressed["arrowleft"] || keyPressed["a"]) paddle.x -= speed;
  if (keyPressed["arrowright"] || keyPressed["d"]) paddle.x += speed;
  if (lastInputX !== null) paddle.x = lastInputX - paddle.width / 2;
  paddle.x = Math.max(0, Math.min(canvas.width - paddle.width, paddle.x));
}

// ─── Ball Physics ────────────────────────────────────────────
function updateBall(dt) {
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

  const move = paddle.x - paddle.prevX;
  if (
    ball.y + ball.radius >= paddle.y &&
    ball.x > paddle.x && ball.x < paddle.x + paddle.width &&
    ball.dy > 0
  ) {
    ball.dy *= -1;
    ball.y = paddle.y - ball.radius;
    ball.dx = Math.max(-5, Math.min(5, ball.dx + move * 0.3));
  }

  if (ball.y - ball.radius > canvas.height) {
    handleMiss();
  }
}

// ─── Turn Passing ────────────────────────────────────────────
function triggerNextTurn(dir, msg) {
  const now = serverNow();
  if (now - lastPassTime < PASS_COOLDOWN_MS) return;
  lastPassTime = now;

  const { playerId, players, seatingOrder } = getState();
  const idx = seatingOrder.indexOf(playerId);
  const next = seatingOrder[(dir === "left" ? idx + 1 : idx - 1 + seatingOrder.length) % seatingOrder.length];

  const fb = players[next]?.name ? `⏳ ${players[next].name} is playing...` : "⏳ A player is playing...";
  setTemporaryMessage(msg, fb);

  localResetTime = now;
  updateGame({
    currentPlayer: next,
    ballResetTime: localResetTime,
    ballState: { dx: ball.dx, entrySide: dir }
  });
}

// ─── Drawing ─────────────────────────────────────────────────
function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGaps();
  drawPaddle();
  if (getState().isCurrentPlayer) drawBall();
}

function drawPaddle() {
  ctx.fillStyle = "#fff";
  ctx.fillRect(paddle.x, paddle.y, paddle.width, paddle.height);
}

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
