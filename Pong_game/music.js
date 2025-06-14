// Pong_game/music.js
import { Howl } from "https://cdnjs.cloudflare.com/ajax/libs/howler/2.2.4/howler.min.js";

let music;
let unlocked = false;
let started = false;

export function initMusic(src = "Music/bg_music.mp3") {
  music = new Howl({
    src: [src],
    loop: true,
    volume: 0.3,
    rate: 0.5
  });
}

export function unlockMusic() {
  if (unlocked || !music) return;
  const id = music.play();
  music.stop(id);
  unlocked = true;
}

export async function resumeIfNeeded() {
  if (typeof Howler.ctx !== "undefined" && Howler.ctx.state === "suspended") {
    await Howler.ctx.resume();
  }
}

export function syncToGame(startTime, roundDuration, serverNowFn) {
  if (!unlocked || !startTime || !roundDuration) return;
  const elapsed = (serverNowFn() - startTime) / 1000;
  const offset = elapsed % music.duration();

  music.seek(offset);
  music.rate(0.5 + Math.min(1, elapsed / roundDuration));
  music.play();
  started = true;
}

export function updateRate(startTime, roundDuration, serverNowFn) {
  if (!started || !startTime || !roundDuration) return;
  const elapsed = serverNowFn() - startTime;
  const progress = Math.min(1, elapsed / roundDuration);
  music.rate(0.5 + progress);
}

export function stopMusic() {
  if (music) music.stop();
  started = false;
}

export function isPlaying() {
  return music?.playing() || false;
}
