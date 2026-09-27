// MIDI: live output through Web MIDI (to a DAW or hardware synth) and Standard MIDI File export.

import { audio } from './audio.js';

export const midiOut = {
  access: null,
  output: null,
  localMute: false, // when true, only MIDI is sent and the built-in sounds are silent
  held: new Set(),

  async init() {
    if (!navigator.requestMIDIAccess) return [];
    if (!this.access) this.access = await navigator.requestMIDIAccess({ sysex: false });
    return [...this.access.outputs.values()];
  },
  select(id) {
    this.output = id && this.access ? this.access.outputs.get(id) || null : null;
  },
  // audio-clock time -> performance.now() time for Web MIDI
  toPerf(t) {
    const ctx = audio.ctx;
    return performance.now() + (t - ctx.currentTime) * 1000;
  },
  note(ch, midi, vel, t, dur) {
    if (!this.output) return;
    const on = this.toPerf(t);
    const v = Math.max(1, Math.min(127, Math.round(vel * 127)));
    this.output.send([0x90 | ch, midi, v], on);
    this.output.send([0x80 | ch, midi, 0], on + dur * 1000);
    this.held.add((ch << 8) | midi);
  },
  allOff() {
    if (!this.output) return;
    for (let ch = 0; ch < 16; ch++) this.output.send([0xb0 | ch, 123, 0]); // all notes off
    this.held.clear();
  },
};

// ---------- Standard MIDI File (type 1) ----------
const PPQ = 480;

function vlq(n) {
  const bytes = [n & 0x7f];
  while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}
const str = s => [...s].map(c => c.charCodeAt(0) & 0x7f);
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = n => [(n >>> 8) & 255, n & 255];

function trackChunk(events) {
  // events: [{ tick, data: [...] }] (absolute ticks)
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const bytes = [];
  let last = 0;
  for (const e of events) {
    bytes.push(...vlq(Math.max(0, e.tick - last)), ...e.data);
    last = e.tick;
  }
  bytes.push(0, 0xff, 0x2f, 0); // end of track
  return [...str('MTrk'), ...u32(bytes.length), ...bytes];
}

function nameEvent(name) {
  const b = [...new TextEncoder().encode(name)].slice(0, 120);
  return { tick: 0, order: -1, data: [0xff, 0x03, ...vlq(b.length), ...b] };
}

// groups: [{ name, channel, program?, notes: [{ step, dur, midi, vel }] }]
// keySigs: [{ step, sf (sharps > 0, flats < 0), minor }] (one per key section)
export function buildMidiFile({ bpm, loops, loopSteps, keySigs, groups }) {
  const stepTicks = PPQ / 4;
  const tempo = Math.round(60000000 / bpm);
  const conductor = [
    { tick: 0, order: 0, data: [0xff, 0x51, 0x03, (tempo >> 16) & 255, (tempo >> 8) & 255, tempo & 255] },
    { tick: 0, order: 0, data: [0xff, 0x58, 0x04, 4, 2, 24, 8] },                     // 4/4
    nameEvent('Bangerator'),
  ];
  for (let l = 0; l < loops; l++) {
    for (const k of keySigs) {
      conductor.push({ tick: Math.round((l * loopSteps + k.step) * (PPQ / 4)), order: 0, data: [0xff, 0x59, 0x02, k.sf & 255, k.minor ? 1 : 0] });
    }
  }
  const chunks = [trackChunk(conductor)];
  for (const g of groups) {
    const evs = [nameEvent(g.name)];
    if (g.program != null) evs.push({ tick: 0, order: 0, data: [0xc0 | g.channel, g.program] });
    for (let l = 0; l < loops; l++) {
      for (const n of g.notes) {
        const on = Math.round((l * loopSteps + n.step) * stepTicks);
        const off = Math.round((l * loopSteps + n.step + n.dur) * stepTicks) - 1;
        const v = Math.max(1, Math.min(127, Math.round(n.vel * 127)));
        evs.push({ tick: on, order: 1, data: [0x90 | g.channel, n.midi, v] });
        evs.push({ tick: Math.max(on + 1, off), order: 0, data: [0x80 | g.channel, n.midi, 0] });
      }
    }
    chunks.push(trackChunk(evs));
  }
  const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ)];
  return new Blob([new Uint8Array([...header, ...chunks.flat()])], { type: 'audio/midi' });
}

// General MIDI program numbers so the file sounds sensible in any player.
export function gmProgram(patch) {
  if (!patch) return 0;
  if (patch.kind === 'sampler') return { piano: 0, guitar: 25, bass: 33 }[patch.set] ?? 0;
  const p = patch.patch;
  if (p.attack > 0.2) return 89;           // pad
  if (p.cutoff < 1500 || p.pitchDrop) return 38; // synth bass
  return { sine: 80, square: 80, sawtooth: 81, triangle: 80 }[p.wave] ?? 80;
}
