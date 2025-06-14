// Pong_game/ui.js

let messageEl;
let returnBtnEl;
let messageTimeout = null;

export function initUI() {
  messageEl = document.getElementById("message");
  returnBtnEl = document.getElementById("returnBtn");

  // Hide return button until needed
  returnBtnEl.style.display = "none";
}

export function showMessage(text) {
  if (messageEl) messageEl.textContent = text;
}

export function setTemporaryMessage(text, fallbackText, duration = 2500) {
  clearTimeout(messageTimeout);
  showMessage(text);
  messageTimeout = setTimeout(() => {
    showMessage(fallbackText);
  }, duration);
}

export function showReturnButton() {
  if (returnBtnEl) returnBtnEl.style.display = "block";
}

export function hideReturnButton() {
  if (returnBtnEl) returnBtnEl.style.display = "none";
}

export function requestFrame(callback) {
  requestAnimationFrame(callback);
}
