// Renders Studi's notification sounds to assets/sounds/*.wav. Soft, short, marimba-like notes,
// so they read as Dot and not as a system alert. Run after editing: node scripts/render-sounds.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const RATE = 44_100;
const note = (name) => {
  const [, letter, octave] = /^([A-G]#?)(\d)$/.exec(name);
  const steps = { C: -9, "C#": -8, D: -7, "D#": -6, E: -5, F: -4, "F#": -3, G: -2, "G#": -1, A: 0, "A#": 1, B: 2 }[letter];
  return 440 * 2 ** ((steps + (Number(octave) - 4) * 12) / 12);
};

// One struck note: a sine with two quiet overtones, a fast attack and an exponential decay.
function strike(buffer, at, frequency, { length = 0.35, volume = 0.5, glide = 0, brightness = 1 } = {}) {
  const start = Math.round(at * RATE);
  const count = Math.round(length * RATE);
  let phase = 0;
  for (let i = 0; i < count && start + i < buffer.length; i += 1) {
    const t = i / RATE;
    const f = frequency * (1 + glide * Math.min(1, t / 0.08));
    phase += (2 * Math.PI * f) / RATE;
    const attack = Math.min(1, t / 0.004);
    const decay = Math.exp(-t / (length * 0.28));
    const tone = Math.sin(phase) + 0.28 * brightness * Math.sin(2 * phase) * Math.exp(-t / 0.05) + 0.12 * brightness * Math.sin(4 * phase) * Math.exp(-t / 0.025);
    buffer[start + i] += volume * attack * decay * tone;
  }
}

function render(name, seconds, notes) {
  const buffer = new Float32Array(Math.round(seconds * RATE));
  for (const [at, pitch, options] of notes) strike(buffer, at, note(pitch), options);
  // Fade the tail and keep the peak at about -9 dB so no sound is ever loud.
  const peak = buffer.reduce((max, value) => Math.max(max, Math.abs(value)), 0) || 1;
  const fade = Math.round(0.03 * RATE);
  const pcm = Buffer.alloc(44 + buffer.length * 2);
  buffer.forEach((value, i) => {
    const tail = Math.min(1, (buffer.length - i) / fade);
    pcm.writeInt16LE(Math.round((value / peak) * 0.35 * tail * 32767), 44 + i * 2);
  });
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + buffer.length * 2, 4); pcm.write("WAVE", 8);
  pcm.write("fmt ", 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(RATE, 24); pcm.writeUInt32LE(RATE * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36); pcm.writeUInt32LE(buffer.length * 2, 40);
  writeFileSync(`assets/sounds/${name}.wav`, pcm);
}

mkdirSync("assets/sounds", { recursive: true });
// Dot needs you: two notes stepping up, a friendly "hey".
render("inky_nudge", 0.6, [[0, "E5"], [0.13, "A5", { length: 0.45 }]]);
// Done, ready to check: three notes climbing, a small "ta-da".
render("inky_done", 0.8, [[0, "C5", { length: 0.3 }], [0.1, "E5", { length: 0.3 }], [0.2, "G5", { length: 0.6, volume: 0.6 }]]);
// Soft: one round note with a little lift, for starts and finished checks.
render("inky_soft", 0.45, [[0, "G4", { length: 0.42, glide: 0.06, brightness: 0.4 }]]);
// Uh-oh: two notes stepping down, muffled.
render("inky_uh_oh", 0.7, [[0, "A4", { length: 0.3, brightness: 0.3 }], [0.16, "F4", { length: 0.5, brightness: 0.3 }]]);
