# Bangerator

A sketch DAW in the browser that uses **scale degrees instead of note names**. You pick a key and a scale, write melodies and basslines as numbers (1 = home), and swap scales to hear the same music in a different mood. Then build patterns into a full song.

Live at **https://bangerator.darkkis.fi**. It runs entirely in your browser; nothing is uploaded.

## What it does

- **Compose**:
  - Scale-degree rolls (or a normal piano roll per track) and a chord lane with suggestions.
  - Circle of fifths, key and scale changes at any bar, and a drum step sequencer.
  - Your own samples.
  - Multi-note editing: Ctrl+drag to select, drag, arrow keys, Ctrl+C/V/D, Alt+wheel for velocity.
  - Drum fill and repeat tools.
- **Patterns and songs**:
  - Any number of patterns, placed on an FL-style playlist with section tags and loop regions.
  - Any clip can play its pattern in another key.
- **Mixer and automation**:
  - Every channel has EQ, compressor, drive, filters, sidechain-style pump, and reverb and delay sends.
  - Drums can be split into one strip per sound.
  - Automation lanes for patterns and for the whole song.
- **Sound design**:
  - Synths with unison (supersaw), FM, a 24 dB filter, mono with slide (303 acid), vibrato and pitch envelopes.
  - Sampled piano, guitar and bass.
  - A synthesized drum kit with riser, impact, downlifter and a distorted kick.
- **Theory help**:
  - The Coach points out clashes and common improvements, with one-click fixes.
  - "Next note?" suggests where a melody could go.
  - Bassline ideas are built from your chords.
- **Guides** for learning to produce and write. There are 15, and following any of them gives a finished, arranged piece:
  - Electronic: techno, trance, house, drum & bass, psytrance, midtempo, hardcore, ambient.
  - Songs & bands: 12-bar blues, basic rock, pop song, funk.
  - Moods: sad song in minor, sad bittersweet instrumental, lo-fi hip hop.
  - Each step explains the method and the theory behind it, and has a "Do it for me" that writes a typical version.
- **Undo history**: the ▾ next to undo lists your recent changes, so you can go back several steps at once.
- **Export**: MIDI and WAV (a pattern or the whole song, with a progress bar). Live MIDI output, and Novation Launchkey Mini (MK3/MK4) support for pads, knobs and transport, in Chrome or Edge.
- **Learn**: a beginner music theory guide.

## Saving

Projects are saved automatically **in your browser** (Projects… / Ctrl+O lists them). To back a project up or move it to another computer, use **File → Export project file** and **File → Import project file**. Clearing your browser's site data deletes the projects stored there, so export the ones you care about.

The app can be installed (Chrome/Edge: "Install app") and works offline after the first visit.

This is the web version. A self-hosted version with a small server adds cloud sync between devices, version history and password-protected remote access; it isn't part of this site.

## Running it locally

It's a static site with no build step. Serve the folder over http (ES modules don't load from `file://`):

```
python -m http.server 8000
# open http://localhost:8000
```

## Browser support

Recent Chrome, Edge, Firefox and Safari. Web MIDI (live MIDI output, Launchkey) needs Chrome or Edge.
