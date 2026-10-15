// MIDI keyboard / Launchkey dialog and the top bar chip.

import { ctl, enableMidi, disableMidi, setPadMode, setRecord, currentChannel } from '../controller.js';
import { modal, h, toast } from './common.js';

const MODES = [['steps', 'Step sequencer'], ['drums', 'Drum pads'], ['chords', 'Chords'], ['patterns', 'Patterns']];

export function syncControllerChip() {
  const el = document.getElementById('ctl-status');
  if (!el) return;
  el.hidden = !ctl.enabled;
  el.classList.toggle('rec', ctl.rec);
  const dev = ctl.lk ? ctl.lk.name : ctl.inputs.length ? 'MIDI keyboard' : 'No MIDI device';
  el.textContent = `🎹 ${dev}${ctl.rec ? ' · REC' : ''}`;
  el.title = ctl.enabled ? `Keys and knobs: ${currentChannel().name}. Click for controller settings.` : '';
}

export function showControllerDialog() {
  const close = modal('<h2>MIDI keyboard</h2><div id="ctl-body"></div>', box => box.classList.add('wide'));
  const body = document.getElementById('ctl-body');
  const render = () => {
    if (!body.isConnected) { ctl.onChange = syncControllerChip; return; }
    if (!navigator.requestMIDIAccess) {
      body.replaceChildren(h('p', {}, 'This browser has no Web MIDI. Use Chrome or Edge (desktop or Android).'));
      return;
    }
    if (!ctl.enabled) {
      body.replaceChildren(
        h('p', {}, 'Play and record with a MIDI keyboard. A Novation Launchkey Mini (MK3 or MK4) also gets its pads, knobs and buttons.'),
        h('p', { class: 'hint' }, 'The browser will ask for MIDI access. Allowing “system exclusive” messages lets Bangerator write to the Launchkey Mini MK4’s screen.'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: close }, 'Cancel'),
          h('button', { class: 'btn on', onclick: async () => {
            try { await enableMidi(); toast(ctl.lk ? `${ctl.lk.name} connected.` : 'MIDI on.'); } catch (e) { toast(e.message || 'No MIDI access.'); }
            render();
          } }, 'Connect')));
      return;
    }
    const ch = currentChannel();
    body.replaceChildren(
      h('div', { class: 'ctl-dev' },
        ctl.lk ? h('div', {}, h('b', {}, ctl.lk.name), ' in DAW mode', ctl.lk.mk4 ? (ctl.access?.sysexEnabled ? ' (screen on)' : ' (screen off: SysEx not allowed)') : '')
          : h('div', {}, ctl.inputs.length ? `Inputs: ${ctl.inputs.join(', ')}` : 'No MIDI device found. Plug one in; it’s picked up automatically.')),
      h('div', { class: 'ctl-opts' },
        h('label', { class: 'field check' }, h('input', { type: 'checkbox', checked: ctl.rec, onchange: e => { setRecord(e.target.checked); render(); } }), 'Record (Launchkey: Record button)'),
        h('label', { class: 'field check' }, h('input', { type: 'checkbox', checked: ctl.scaleKeys, onchange: e => { ctl.scaleKeys = e.target.checked; render(); } }),
          'Scale keys: white keys play the scale, C = 1 (Shift+Record)'),
        h('span', { class: 'hint' }, `Keys and knobs play: ${ch.name}. Click a track, or use ◀ ▶ on the Launchkey.`),
        ctl.lk ? h('label', { class: 'field' }, 'Pads',
          h('select', { onchange: e => setPadMode(e.target.value) }, ...MODES.map(([v, t]) => h('option', { value: v, selected: ctl.padMode === v }, t)))) : null),
      ctl.lk ? cheatSheet() : h('p', { class: 'hint' }, 'Notes on channel 10 (drum pads on most controllers) hit the drum rows. Knobs sending CC 21–28 work like the Launchkey’s.'),
      h('p', { class: 'hint ctl-mon' }, ctl.lastMsg ? `Last message: ${ctl.lastMsg}` : 'Last message: (none yet)'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', onclick: () => { disableMidi(); render(); } }, 'Disconnect'),
        h('button', { class: 'btn on', onclick: close }, 'Done')));
  };
  ctl.onChange = what => {
    syncControllerChip();
    if (what === 'msg') { const m = body.querySelector('.ctl-mon'); if (m) m.textContent = `Last message: ${ctl.lastMsg}`; return; }
    render();
  };
  render();
}

function cheatSheet() {
  const row = (k, v) => h('tr', {}, h('td', {}, h('b', {}, k)), h('td', {}, v));
  return h('table', { class: 'ctl-sheet' },
    row('Keys', 'Play the selected channel. With Record on: live recording while playing (quantized to 16ths), step input while stopped.'),
    row('▲ ▼', 'Pad mode: Step sequencer → Drum pads → Chords → Patterns'),
    row('Pads: Steps', '16 steps of one drum row for the current bar, with a running light. Shift+pad = accent. Shift+◀▶ picks the drum row, Shift+▲▼ the bar.'),
    row('Pads: Drums', 'Bottom row = first 8 drum rows (kick bottom-left), top row = the rest. Recorded when Record is on.'),
    row('Pads: Chords', 'Bottom row: triads I–VII, top row: 7th chords, coloured home / away / tension. Recorded into the chord lane.'),
    row('Pads: Patterns', 'Pick the pattern to edit. Shift+◀▶ also steps through patterns.'),
    row('Knobs 1–8', 'Filter (centre open, left low-pass, right high-pass), Resonance, Tone (darker ↔ brighter), Drive, Punch (compressor), Space (reverb), Echo (delay), Volume. Shift: 1 = Pan, 2 = Synth cutoff, 3 = Synth resonance (ride these on an acid line), 7 = Pump, 8 = Master.'),
    row('Knob tricks', 'Knobs pick up where the setting is, so nothing jumps. With Record on while playing, knob moves become automation (pattern or song, by mode). With drums split per sound, they shape the selected drum sound.'),
    row('◀ ▶', 'Select channel: each track, then chords, then drums'),
    row('Play', 'Play / stop. Shift+Play switches Pattern ↔ Song.'),
    row('Record', 'Arm recording. Shift+Record toggles scale keys.'));
}
