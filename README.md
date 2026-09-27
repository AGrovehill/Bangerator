# Bangerator

A composing and sketching tool that uses **scale degrees instead of note names**. You pick a key and a scale, write melodies and basslines as numbers (1 = home), and swap scales to hear the same loop in a different mood. Tracks can also be switched to a normal chromatic piano roll. Songs can change key or scale at any bar, and a Mix & FX tab adds drive, filter, reverb, delay and sidechain-style pump per channel. It also has a chord lane with suggestions, a circle of fifths, an FL-style drum and sample step sequencer, a small synth for sound design, MIDI/WAV export, and a beginner music theory guide that assumes no prior knowledge.

## Hosting

It's a static site with no build step and no server code. All audio runs in the visitor's browser (Web Audio API).

Upload the whole folder to any static host: shared hosting, nginx, GitHub Pages, Netlify, a Raspberry Pi, and so on. Total size is about 2.5 MB. The sample files load only when an instrument is used.

Local test (ES modules need to be served over http, so opening `index.html` as a `file://` URL won't work):

```
python -m http.server 8000
# open http://localhost:8000
```

## Files

| Path | What it is |
|---|---|
| `index.html`, `css/style.css` | The app shell |
| `guide.html` | Music theory guide, also shown in the **Learn** tab |
| `js/theory.js` | Scales, degrees, chords, Roman numerals, progressions, harmonizer (pure logic) |
| `js/audio.js` | AudioContext, mixer, sampler, synth voices with ADSR and filter |
| `js/drums.js` | 808 kit synthesized in the browser (no samples) |
| `js/sequencer.js` | Look-ahead scheduler, event builder, offline WAV render |
| `js/midi.js` | Web MIDI output and `.mid` file writer |
| `js/state.js` | Project model, undo/redo, autosave (localStorage), user samples (IndexedDB) |
| `js/ui/*` | Circle of fifths, scale/piano roll, compose lanes (key, chords, tracks, drums), sidebar, mixer, sound design |
| `samples/` | Piano, acoustic guitar and electric bass multisamples (see `samples/CREDITS.txt`) |

## Data model in one sentence

A note in a Scale track is stored as `{ step, len, deg, alt }`, where `deg` is the scale-degree index (0 = degree 1, 7 = degree 1 one octave up in a 7-note scale). Its pitch is computed only at play time from the key section it's in + track octave, so changing key or scale never breaks the song. A note in a Piano track is `{ step, len, midi }` and never moves. Key sections live in `project.keyChanges` (`[{ bar, root, scale }]`, with `project.root/scale` as the first section).

## Browser support

Recent Chrome, Edge, Firefox and Safari. Live MIDI output needs Web MIDI (Chrome/Edge). File export (.mid/.wav) works everywhere.
