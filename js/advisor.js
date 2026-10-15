// Music-theory helpers that look at the open pattern and suggest things:
//   - basslines built from the chord lane (several styles)
//   - what note could come next in a melody
//   - a "coach" that points out clashes and common improvements, with one-click fixes
// Pure logic: it reads the project and returns data; the sidebar draws it and applies fixes.

import { STEPS_PER_BAR, keyAt, defaultFx, newTrack, TRACK_COLORS } from './state.js';
import { scaleSteps, harmonyScaleId, degToSemis, semisToNearestDeg, chordSemis, chordFunction, chordQuality, romanNumeral, mod } from './theory.js';

const BASS_PATCHES = ['sawbass', 'sub808', 'ebass'];
const patLen = p => p.bars * STEPS_PER_BAR;

// ---------- Shared ----------
export function bassTrack(p) {
  return p.tracks.find(t => /bass|sub|808/i.test(t.name))
    || p.tracks.find(t => BASS_PATCHES.includes(t.patch))
    || p.tracks.find(t => t.octave <= 2)
    || null;
}

// The chord sounding at `step`: { deg, type, start, end, key, hSteps, semis (chord tones above the key root) } or null
export function chordAt(p, step) {
  const c = p.chords;
  const i = Math.floor(step / c.slotSteps);
  const s = c.slots[i];
  if (!s) return null;
  const key = keyAt(p, i * c.slotSteps);
  const hSteps = scaleSteps(harmonyScaleId(key.scale));
  return { ...s, slot: i, start: i * c.slotSteps, end: Math.min(patLen(p), (i + 1) * c.slotSteps), key, hSteps, semis: chordSemis(hSteps, s.deg, s.type) };
}

// Semitones above the key root (at `step`) for a track's note, and back again.
export function noteSemis(p, track, note) {
  const k = keyAt(p, note.step);
  if (track.mode === 'piano') return note.midi - (12 * (track.octave + 1) + k.root);
  return degToSemis(scaleSteps(k.scale), note.deg) + (note.alt || 0);
}

export function semisToNote(p, track, semis, step) {
  const k = keyAt(p, step);
  if (track.mode === 'piano') return { midi: 12 * (track.octave + 1) + k.root + semis };
  const steps = scaleSteps(k.scale);
  const deg = semisToNearestDeg(steps, semis);
  const alt = semis - degToSemis(steps, deg);
  return alt ? { deg, alt } : { deg };
}

const pc = x => mod(x, 12);
// Fold a pitch into the octave around the key root, so basslines don't wander upward.
const fold = semis => { const r = pc(semis); return r > 7 ? r - 12 : r; };

// ---------- Basslines ----------
// Each style gets the chord spans of the pattern and returns notes as { step, len, semis, vel }.
// r/third/fifth are the chord's root, 3rd and 5th (semitones above the key root, folded low).
function span(c, next) {
  const r = fold(c.semis[0]);
  return {
    start: c.start, len: c.end - c.start, r,
    third: r + (c.semis[1] - c.semis[0]),
    fifth: r + (c.semis[2] - c.semis[0]),
    nextR: next ? fold(next.semis[0]) : r,
    c,
  };
}

const every = (sp, stepSize, fn) => {
  const out = [];
  for (let s = 0, i = 0; s < sp.len; s += stepSize, i++) {
    const n = fn(i, s);
    if (n) out.push({ step: sp.start + s, len: Math.min(n.len ?? stepSize, sp.len - s), semis: n.semis, vel: n.vel ?? 0.85 });
  }
  return out;
};

// A scale step just below or above the next root, to lead into it.
function approach(sp, from) {
  const steps = sp.c.hSteps;
  const target = sp.nextR;
  const d = semisToNearestDeg(steps, target);
  const below = degToSemis(steps, d - 1), above = degToSemis(steps, d + 1);
  return Math.abs(below - from) <= Math.abs(above - from) ? below : above;
}

export const BASS_STYLES = [
  { id: 'roots', name: 'Long roots', help: 'One long note per chord, on its root. The safest bass there is: it tells the ear which chord it is.',
    make: sp => [{ step: sp.start, len: sp.len, semis: sp.r, vel: 0.9 }] },
  { id: 'eighths', name: 'Driving 8ths', help: 'The root on every 8th note. Rock, punk, synthwave: pure forward motion.',
    make: sp => every(sp, 2, i => ({ semis: sp.r, vel: i % 2 ? 0.7 : 0.9 })) },
  { id: 'offbeat', name: 'Off-beat', help: 'The root between the kicks ("and" of every beat). Leaves the kick room. Trance, house, EDM.',
    make: sp => every({ start: sp.start + 2, len: sp.len - 2 }, 4, () => ({ semis: sp.r, len: 2 })) },
  { id: 'octaves', name: 'Octave bounce', help: 'Root, then the same note an octave up, in 8ths. The disco / Giorgio Moroder bass.',
    make: sp => every(sp, 2, i => ({ semis: sp.r + (i % 2 ? 12 : 0), vel: i % 2 ? 0.7 : 0.9 })) },
  { id: 'rootfifth', name: 'Root and fifth', help: 'Root on beat 1, the chord’s 5th on beat 3. The 5th is the most stable note after the root. Country, pop, reggae.',
    make: sp => every(sp, 8, i => (i % 2 ? { semis: sp.fifth - (sp.fifth > 7 ? 12 : 0), len: 6, vel: 0.8 } : { semis: sp.r, len: 6, vel: 0.9 })) },
  { id: 'walking', name: 'Walking', help: 'A note on every beat: root, 3rd, 5th, then a step that leads into the next chord. Jazz and blues.',
    make: sp => every(sp, 4, (i, s) => {
      const last = s + 4 >= sp.len;
      const tones = [sp.r, sp.third, sp.fifth, sp.third];
      return { semis: last && sp.nextR !== sp.r ? approach(sp, sp.fifth) : tones[i % 4], vel: i % 4 === 0 ? 0.9 : 0.75 };
    }) },
  { id: 'syncopated', name: 'Syncopated', help: 'Root on the 1, then pushes ahead of the beat, with an octave pop. Funk, garage, modern pop.',
    make: sp => {
      const cell = [[0, 3, sp.r, 0.95], [3, 2, sp.r, 0.75], [6, 2, sp.r, 0.8], [10, 1, sp.r + 12, 0.7], [11, 2, sp.fifth - (sp.fifth > 7 ? 12 : 0), 0.75], [14, 2, sp.r, 0.8]];
      const out = [];
      for (let bar = 0; bar < sp.len; bar += 16) for (const [s, len, semis, vel] of cell) {
        if (bar + s < sp.len) out.push({ step: sp.start + bar + s, len: Math.min(len, sp.len - bar - s), semis, vel });
      }
      return out;
    } },
  { id: 'arp', name: 'Chord tones', help: 'Root, 3rd, 5th, octave in 8ths: the bass spells the chord out. Synth-pop, italo.',
    make: sp => { const t = [sp.r, sp.third, sp.fifth, sp.r + 12]; return every(sp, 2, i => ({ semis: t[i % 4], vel: i % 4 ? 0.7 : 0.9 })); } },
  { id: 'pedal', name: 'Pedal note', help: 'The bass stays on the key’s home note while the chords change above it. Builds tension; great for intros and breakdowns.',
    make: sp => every(sp, 2, i => ({ semis: 0, vel: i % 2 ? 0.7 : 0.9 })) },
];

// Notes for `styleId`, in abstract form. Empty chord slots continue the previous chord (or the home chord).
export function bassLine(p, styleId) {
  const style = BASS_STYLES.find(s => s.id === styleId);
  const L = patLen(p);
  const c = p.chords;
  const chords = [];
  let prev = null;
  for (let start = 0; start < L; start += c.slotSteps) {
    let ch = chordAt(p, start);
    if (!ch) {
      const key = keyAt(p, start);
      const hSteps = scaleSteps(harmonyScaleId(key.scale));
      const deg = prev?.deg ?? 0;
      ch = { deg, type: 'triad', start, end: Math.min(L, start + c.slotSteps), key, hSteps, semis: chordSemis(hSteps, deg, 'triad') };
    }
    chords.push(ch);
    prev = ch;
  }
  const out = [];
  chords.forEach((ch, i) => out.push(...style.make(span(ch, chords[(i + 1) % chords.length]))));
  return out.filter(n => n.step < L && n.len > 0);
}

// Turn abstract notes into a track's notes.
export function toTrackNotes(p, track, abstract) {
  return abstract.map(n => ({ step: n.step, len: n.len, vel: n.vel, ...semisToNote(p, track, n.semis, n.step) }));
}

export function makeBassTrack(p) {
  return newTrack('Bass', 'sawbass', 2, TRACK_COLORS[p.tracks.length % TRACK_COLORS.length]);
}

// ---------- What note next? ----------
const DEG_NAMES = ['root', '3rd', '5th', '7th'];

// Ideas for the note after the last one in `track`: [{ semis, step, len, why, strength }]
export function nextNotes(p, track) {
  const L = patLen(p);
  const notes = [...track.notes].filter(n => n.step < L).sort((a, b) => a.step - b.step || a.len - b.len);
  const last = notes[notes.length - 1];
  const prev = notes[notes.length - 2];
  const step = last ? Math.min(L - 1, last.step + last.len) : 0;
  if (last && last.step + last.len >= L) return { step: null, ideas: [] }; // pattern is full to the end
  const len = last?.len || 2;
  const key = keyAt(p, step);
  const steps = scaleSteps(key.scale);
  const here = last ? noteSemis(p, track, last) : 0;
  const before = prev ? noteSemis(p, track, prev) : null;
  const ch = chordAt(p, step);
  const ideas = [];
  const add = (semis, why, strength) => {
    if (Math.abs(semis - here) > 12) return;
    const same = ideas.find(x => x.semis === semis);
    if (same) { if (strength > same.strength) { same.why = why; same.strength = strength; } else same.strength += 0.3; return; }
    ideas.push({ semis, why, strength });
  };
  const nearest = target => target + 12 * Math.round((here - target) / 12); // the octave of `target` closest to the last note
  const d = semisToNearestDeg(steps, here);

  // leaps like to be answered by a step back
  if (before != null && Math.abs(here - before) >= 5) {
    const back = degToSemis(steps, d + (here > before ? -1 : 1));
    add(back, `Step back ${here > before ? 'down' : 'up'}: after a leap, a step the other way sounds natural.`, 3.2);
  }
  // tendency tones
  const rel = pc(here);
  if (last && rel === 11) add(here + 1, 'The 7th note leans hard into home (1). Resolving it feels like arriving.', 3.5);
  if (last && rel === 5 && steps.includes(4) && ch && pc(ch.semis[0]) === 0) add(here - 1, 'The 4 wants to fall to the 3 over the home chord.', 3);
  if (last && rel === 1) add(here - 1, 'The ♭2 pulls down to home.', 3);
  // chord tones
  if (ch) {
    const fn = romanNumeral(ch.hSteps, ch.deg, ch.type);
    ch.semis.slice(0, 4).forEach((s, i) => {
      const t = nearest(s);
      add(t, i === 0 ? `Root of ${fn}: the strongest, most settled note over this chord.`
        : i === 1 ? `3rd of ${fn}: the note that makes the chord sound major or minor. Sweet.`
          : i === 2 ? `5th of ${fn}: open and stable.`
            : `7th of ${fn}: adds colour and a little tension.`, 2.6 - i * 0.3);
    });
  } else if (!last) {
    add(0, 'Home (1): the safest place to start.', 2.5);
    add(degToSemis(steps, 2), 'The 3rd note of the scale: a gentle start.', 2);
    add(degToSemis(steps, 4), 'The 5th: open and strong.', 2);
  }
  // steps
  if (last) {
    add(degToSemis(steps, d + 1), 'Step up: smooth, singable motion.', 1.8);
    add(degToSemis(steps, d - 1), 'Step down: smooth, singable motion.', 1.8);
    add(here, 'Same note again: let the rhythm do the talking.', 1.2);
  }
  ideas.sort((a, b) => b.strength - a.strength);
  return { step, len, ideas: ideas.slice(0, 6).map(x => ({ ...x, isChordTone: !!ch && ch.semis.some(s => pc(s) === pc(x.semis)) })) };
}

export { DEG_NAMES };

// ---------- Coach ----------
// Returns findings: { kind: 'fix' | 'tip' | 'good', title, why, fixLabel?, fix?(p), action? }
// fix(p) changes the project (the caller commits); action names something the UI does itself.
export function coach(p) {
  const out = [];
  const L = patLen(p);
  const c = p.chords;
  const slots = [];
  for (let i = 0; i * c.slotSteps < L; i++) slots.push(c.slots[i] || null);
  const filled = slots.filter(Boolean);
  const bass = bassTrack(p);
  const inPat = t => t.notes.filter(n => n.step < L);
  const melodic = p.tracks.filter(t => t !== bass && inPat(t).length);
  // In a song built from one pattern per element, the bass lives in another pattern.
  const bassElsewhere = !!bass && (p.patterns || []).some(pat => pat.id !== p.currentPattern && pat.notes?.[bass.id]?.length);
  const bar = s => Math.floor(s / STEPS_PER_BAR) + 1;
  const beat = s => Math.floor((s % STEPS_PER_BAR) / 4) + 1;

  // --- harmony
  if (!filled.length && melodic.length) {
    out.push({ kind: 'tip', title: 'No chords yet', why: 'Chords under a melody give it emotion and direction. I can pick ones that contain your melody notes.', fixLabel: 'Pick chords for my melody', action: 'harmonize' });
  }
  if (filled.length >= 4 && filled.every(s => s.deg === filled[0].deg)) {
    out.push({ kind: 'tip', title: 'One chord the whole time', why: 'Hypnotic, and fine for techno or a riff-driven track. For a sense of journey, try a progression (see Famous progressions) or change just the last chord.' });
  }
  if (filled.length >= 2) {
    const key = keyAt(p, (slots.length - 1) * c.slotSteps);
    const hSteps = scaleSteps(harmonyScaleId(key.scale));
    const lastSlot = slots[slots.length - 1];
    const first = slots[0];
    if (lastSlot && chordFunction(lastSlot.deg, hSteps) === 'tension') {
      out.push({ kind: 'good', title: 'The loop ends on a tension chord', why: `${romanNumeral(hSteps, lastSlot.deg, lastSlot.type)} pulls back to the start, so the loop keeps wanting to go round.` });
    } else if (lastSlot && first && mod(lastSlot.deg, 7) === 0 && mod(first.deg, 7) === 0 && filled.some(s => s.deg !== first.deg)) {
      const v = chordQuality(chordSemis(hSteps, 4)).quality === 'dim' ? 6 : 4;
      out.push({ kind: 'tip', title: 'The loop ends at home and starts at home', why: `Nothing pulls you back round. A tension chord in the last slot (${romanNumeral(hSteps, v)}) makes the restart feel like an arrival.`,
        fixLabel: `Put ${romanNumeral(hSteps, v)} last`, fix: q => { q.chords.slots[slots.length - 1] = { deg: v, type: lastSlot.type }; } });
    }
  }

  // --- melody against the chords
  const clashes = [];
  for (const t of melodic) {
    for (const n of inPat(t)) {
      if (n.step % 4 !== 0 || n.len < 2) continue; // only notes that land on a beat and last
      const ch = chordAt(p, n.step);
      if (!ch) continue;
      const s = noteSemis(p, t, n);
      const tones = ch.semis.map(pc);
      if (tones.includes(pc(s))) continue;
      const rub = tones.some(x => { const d = mod(pc(s) - x, 12); return d === 1 || d === 11; });
      if (rub) clashes.push({ t, n, ch, s });
    }
  }
  if (clashes.length) {
    const x = clashes[0];
    out.push({ kind: 'fix', title: `${clashes.length} melody note${clashes.length > 1 ? 's rub' : ' rubs'} against the chord`,
      why: `E.g. “${x.t.name}” bar ${bar(x.n.step)} beat ${beat(x.n.step)}: a long note on the beat, a half step from a chord note of ${romanNumeral(x.ch.hSteps, x.ch.deg, x.ch.type)}. That grinds. Fine as a quick passing note, harsh when it sits there.`,
      fixLabel: 'Move them to chord notes',
      fix: q => {
        for (const cl of clashes) {
          const t = q.tracks.find(y => y.id === cl.t.id);
          const n = t?.notes.find(y => y.step === cl.n.step && y.len === cl.n.len && noteSemis(q, t, y) === cl.s);
          if (!n) continue;
          let best = null;
          for (const tone of cl.ch.semis) for (const o of [-12, 0, 12]) {
            const cand = tone + 12 * Math.round((cl.s - tone) / 12) + o;
            if (best == null || Math.abs(cand - cl.s) < Math.abs(best - cl.s)) best = cand;
          }
          const nn = semisToNote(q, t, best, n.step);
          delete n.deg; delete n.alt; delete n.midi; delete n.src;
          Object.assign(n, nn);
        }
      } });
  } else if (melodic.length && filled.length) {
    out.push({ kind: 'good', title: 'Melody and chords agree', why: 'Every long note that lands on a beat fits its chord (or sits a comfortable distance from it).' });
  }

  // --- bass
  if (filled.length && !bassElsewhere && !p.chordsGuide && (!bass || !inPat(bass).length)) {
    out.push({ kind: 'tip', title: 'No bassline', why: 'The bass tells the ear what each chord is and glues drums to harmony. See Bassline ideas below for ones built from your chords.' });
  }
  if (bass && inPat(bass).length && filled.length) {
    const off = [];
    for (let i = 0; i < slots.length; i++) {
      if (!slots[i]) continue;
      const ch = chordAt(p, i * c.slotSteps);
      const n = inPat(bass).find(x => x.step === ch.start);
      if (!n) continue;
      const s = pc(noteSemis(p, bass, n));
      if (!ch.semis.map(pc).includes(s)) off.push({ n, ch });
    }
    if (off.length) {
      const x = off[0];
      out.push({ kind: 'fix', title: `Bass misses the chord on ${off.length} chord change${off.length > 1 ? 's' : ''}`,
        why: `E.g. bar ${bar(x.n.step)}: when the chord changes to ${romanNumeral(x.ch.hSteps, x.ch.deg, x.ch.type)}, the bass plays a note that isn’t in it. The first bass note under a new chord defines how the chord is heard; the root is the solid choice.`,
        fixLabel: 'Put the root there',
        fix: q => {
          const b = bassTrack(q);
          for (const o of off) {
            const n = b.notes.find(y => y.step === o.n.step);
            if (!n) continue;
            const nn = semisToNote(q, b, fold(o.ch.semis[0]), n.step);
            delete n.deg; delete n.alt; delete n.midi; delete n.src;
            Object.assign(n, nn);
          }
        } });
    }
    if (bass.octave >= 4) {
      out.push({ kind: 'tip', title: 'The bass sits high', why: `“${bass.name}” is at octave ${bass.octave}, in the melody’s range. Basses usually live at octave 1–2, leaving the middle for chords and lead.`,
        fixLabel: 'Drop it to octave 2', fix: q => { bassTrack(q).octave = 2; } });
    }
    const kick = p.drums.rows.find(r => r.kind === 'kick');
    const kickSteps = new Set((kick?.steps || []).map((v, i) => (v ? i : -1)).filter(i => i >= 0 && i < L));
    if (kickSteps.size && !bass.fx.pump && inPat(bass).some(n => kickSteps.has(n.step))) {
      out.push({ kind: 'tip', title: 'Bass and kick hit together', why: 'Both fill the same low frequencies, so they blur into each other. Ducking the bass on each beat (“pump”, sidechain) lets the kick punch through. Or try an off-beat bassline.',
        fixLabel: 'Add pump to the bass', fix: q => { bassTrack(q).fx.pump = 0.45; } });
    }
  }

  // --- notes
  const outOfScale = p.tracks.reduce((a, t) => a + inPat(t).filter(n => t.mode !== 'piano' && n.alt).length, 0);
  if (outOfScale) {
    out.push({ kind: 'tip', title: `${outOfScale} note${outOfScale > 1 ? 's are' : ' is'} outside the scale`, why: 'Deliberate ♯/♭ notes add spice (blue notes, leading tones). If they were accidents, snap them back.', fixLabel: 'Snap to scale', action: 'snap' });
  }
  for (const t of melodic) {
    const ns = inPat(t).sort((a, b) => a.step - b.step);
    let leaps = 0;
    for (let i = 1; i < ns.length; i++) if (ns[i].step > ns[i - 1].step && Math.abs(noteSemis(p, t, ns[i]) - noteSemis(p, t, ns[i - 1])) > 12) leaps++;
    if (leaps) out.push({ kind: 'tip', title: `“${t.name}” jumps more than an octave ${leaps} time${leaps > 1 ? 's' : ''}`, why: 'Huge jumps are hard to follow and to sing. Most memorable melodies move mostly by step, with the odd leap of a 3rd–6th.' });
    if (ns.length >= 8 && ns.every(n => (n.vel ?? 0.85) === (ns[0].vel ?? 0.85))) {
      out.push({ kind: 'tip', title: `“${t.name}”: every note is equally loud`, why: 'Real players lean on the beats. Accenting notes on the beat and softening the ones between makes a part groove.',
        fixLabel: 'Accent the beats', fix: q => { for (const n of q.tracks.find(y => y.id === t.id).notes) n.vel = n.step % 4 === 0 ? 0.95 : n.step % 2 === 0 ? 0.8 : 0.65; } });
      break; // one of these is enough
    }
  }

  // --- mix
  if (bass && (inPat(bass).length || bassElsewhere)) {
    const muddy = [...melodic, ...(filled.length ? [p.chords] : [])].filter(x => (x.fx.hpCut || 10) <= 11 && (x.fx.eqLow || 0) >= 0);
    if (muddy.length) {
      out.push({ kind: 'tip', title: 'Everything shares the low end', why: `${muddy.map(x => x.name || 'Chords').join(', ')} still carry bass frequencies. Cutting everything except bass and kick below ~120 Hz is the single most effective clean-up in a mix.`,
        fixLabel: 'High-pass them at 120 Hz', fix: q => {
          const b = bassTrack(q);
          for (const x of [...q.tracks.filter(t => t !== b), q.chords]) if ((x.fx.hpCut || 10) <= 11) x.fx = defaultFx({ ...x.fx, hpCut: 120 });
        } });
    }
  }

  // --- song
  const clips = p.song.clips;
  if (clips.length >= 3) {
    const end = clips.reduce((m, x) => Math.max(m, x.bar + x.len), 0);
    if (end >= 24 && !clips.some(x => x.key)) {
      out.push({ kind: 'tip', title: 'The song stays in one key', why: 'Lifting the last section up a whole tone is the classic “final chorus” trick. In Arrange, select the last clip and raise its Key by two: your melodies follow automatically.' });
    }
    if (new Set(clips.map(x => x.pat)).size === 1) {
      out.push({ kind: 'tip', title: 'The whole song is one pattern', why: 'Contrast keeps a listener: clone the pattern and strip it down (no drums, or just bass and drums) for an intro or breakdown, then bring everything back.' });
    }
  }
  const order = { fix: 0, tip: 1, good: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]);
}
