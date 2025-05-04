const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const msg = document.getElementById("message");

const paddle = {
  x: 120,
  y: 470,
  width: 60,
  height: 10,
  prevX: 120
};

const ball = {
  x: 150,
  y: 100,
  radius: 8,
  dx: 0,
  dy: 5
};

const gapSize = 50;
let punishmentShown = false;

// Track key state
let keyPressed = {};

// Touch input (mobile)
canvas.addEventListener("touchmove", e => {
  const touch = e.touches[0];
  const rect = canvas.getBoundingClientRect();
  const touchX = touch.clientX - rect.left;

  paddle.prevX = paddle.x;
  paddle.x = Math.max(0, Math.min(touchX - paddle.width / 2, canvas.width - paddle.width));
});

// Mouse input (desktop)
canvas.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;

  paddle.prevX = paddle.x;
  paddle.x = Math.max(0, Math.min(mouseX - paddle.width / 2, canvas.width - paddle.width));
});

// Keyboard input (desktop)
document.addEventListener("keydown", e => {
  keyPressed[e.key.toLowerCase()] = true;
});
document.addEventListener("keyup", e => {
  keyPressed[e.key.toLowerCase()] = false;
});

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
  ctx.fillRect(0, 0, gapSize, 10); // Left pass
  ctx.fillRect(canvas.width - gapSize, 0, gapSize, 10); // Right pass

  // Draw center wall
  const wallStart = gapSize;
  const wallEnd = canvas.width - gapSize;
  ctx.fillStyle = "white";
  ctx.fillRect(wallStart, 0, wallEnd - wallStart, 10);
}

function showMessage(text) {
  msg.textContent = text;
}

function resetBall(message) {
    showMessage(message + " ⏳");
    punishmentShown = true;
  
    setTimeout(() => {
      ball.x = 150;
      ball.y = 100;
      ball.dx = 0;
      ball.dy = 5; // faster ball
      punishmentShown = false;
      showMessage("");
    }, 5000); // 5 second delay
  }
  

function update() {
  if (punishmentShown) return;

  // Keyboard controls
  paddle.prevX = paddle.x;
  const moveSpeed = 5;
  if (keyPressed["arrowleft"] || keyPressed["a"]) {
    paddle.x -= moveSpeed;
  }
  if (keyPressed["arrowright"] || keyPressed["d"]) {
    paddle.x += moveSpeed;
  }

  // Clamp paddle
  paddle.x = Math.max(0, Math.min(paddle.x, canvas.width - paddle.width));

  // Ball movement
  ball.x += ball.dx;
  ball.y += ball.dy;

  // Wall bounce
  if (ball.x - ball.radius < 0 || ball.x + ball.radius > canvas.width) ball.dx *= -1;

  // Top bounce or pass
  if (ball.y - ball.radius <= 10) {
    if (ball.x > gapSize && ball.x < canvas.width - gapSize) {
      ball.dy *= -1; // center wall
    } else if (ball.x < gapSize) {
      resetBall("⬅️ Passed to the left!");
    } else if (ball.x > canvas.width - gapSize) {
      resetBall("➡️ Passed to the right!");
    }
  }

  // Paddle bounce
  const paddleMoved = paddle.x - paddle.prevX;
  if (
    ball.y + ball.radius >= paddle.y &&
    ball.x > paddle.x &&
    ball.x < paddle.x + paddle.width &&
    ball.dy > 0
  ) {
    ball.dy *= -1;
    ball.y = paddle.y - ball.radius;
    ball.dx += paddleMoved * 0.2;
    ball.dx = Math.max(-5, Math.min(5, ball.dx));
  }

  // Bottom miss
  if (ball.y - ball.radius > canvas.height) {
    resetBall("💥 You missed! Punishment time!");
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBall();
  drawPaddle();
  drawGaps();
}

function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

loop();
