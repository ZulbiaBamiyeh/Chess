// Every sound in the game is synthesized at runtime — no audio files ship.
//
// One mixer feeds two buses: SFX (the wooden knocks, captures and stingers) and
// music (a generative ambient bed that never repeats exactly). Both run through
// a procedurally-generated convolution reverb and a bus compressor, and the
// music ducks under the bigger stingers so a checkmate lands cleanly.
//
// The board sounds are built from the same three ingredients a real piece makes
// when it meets a board: a wooden *body* resonance, a *click* of lacquer on
// lacquer, and a low *thump* through the table.

const mtof = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = { music: false, sfx: false };
    this.musicVolume = 0.34;
    this.sfxVolume = 0.6;
    this.musicTimer = null;
    this.nextNoteTime = 0;
    this.step = 0;
  }

  // ---- graph -------------------------------------------------------------

  ensureContext() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;

    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 26;
    this.comp.ratio.value = 3.2;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.24;
    this.master.connect(this.comp).connect(this.ctx.destination);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.master);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;
    this.sfxGain.connect(this.master);

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.6, 2.4);
    this.reverbGain = this.ctx.createGain();
    this.reverbGain.gain.value = 0.85;
    this.reverb.connect(this.reverbGain).connect(this.master);

    this.noiseBuffer = this.makeNoiseBuffer();
  }

  makeNoiseBuffer() {
    const len = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Decaying stereo noise, used as the reverb's impulse response. */
  makeImpulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const impulse = this.ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
      // A one-pole smooth darkens the tail so it sits behind everything else.
      for (let i = 1; i < len; i++) data[i] = (data[i] + data[i - 1]) * 0.5;
    }
    return impulse;
  }

  async resume() {
    this.ensureContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  setMusicVolume(v) {
    this.musicVolume = v;
    if (this.musicGain) this.musicGain.gain.value = v;
  }

  setSfxVolume(v) {
    this.sfxVolume = v;
    if (this.sfxGain) this.sfxGain.gain.value = v;
  }

  toggleMusic(on) {
    this.muted.music = !on;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  toggleSfx(on) {
    this.muted.sfx = !on;
  }

  /** Pull the music down briefly so a stinger cuts through. */
  duck(amount = 0.35, seconds = 1.4) {
    if (!this.musicGain) return;
    const t = this.ctx.currentTime;
    const g = this.musicGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(this.musicVolume * amount, t + 0.05);
    g.linearRampToValueAtTime(this.musicVolume, t + seconds);
  }

  // ---- generative ambient bed -------------------------------------------
  //
  // A slow chord cycle on a filtered pad, with sparse plucked notes drawn from
  // the chord's own scale. Nothing is sequenced ahead of time, so the bed drifts
  // rather than looping.

  static get PROGRESSION() {
    // A minor -> F major7 -> C major -> E minor, voiced low and open.
    return [
      { root: 45, chord: [45, 52, 60, 64], scale: [57, 60, 62, 64, 67, 69, 72] },
      { root: 41, chord: [41, 48, 57, 64], scale: [53, 57, 60, 62, 65, 69, 72] },
      { root: 48, chord: [48, 55, 64, 67], scale: [55, 60, 64, 67, 69, 72, 76] },
      { root: 40, chord: [40, 47, 55, 62], scale: [55, 59, 62, 64, 67, 71, 74] },
    ];
  }

  startMusic() {
    if (this.muted.music) return;
    this.ensureContext();
    if (this.musicTimer) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    // Look ahead by a few beats and schedule precisely on the audio clock; the
    // timer only has to be roughly on time.
    this.musicTimer = setInterval(() => this.scheduleMusic(), 120);
    this.scheduleMusic();
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  scheduleMusic() {
    const ctx = this.ctx;
    const beat = 0.75;                    // seconds per step
    while (this.nextNoteTime < ctx.currentTime + 0.6) {
      const bar = Math.floor(this.step / 8) % AudioEngine.PROGRESSION.length;
      const slot = AudioEngine.PROGRESSION[bar];

      if (this.step % 8 === 0) this.pad(slot.chord, this.nextNoteTime, beat * 8);
      // Plucks land on a sparse, slightly random subset of the grid.
      if (this.step % 2 === 1 && Math.random() < 0.4) {
        const note = slot.scale[Math.floor(Math.random() * slot.scale.length)];
        this.pluck(note, this.nextNoteTime);
      }

      this.nextNoteTime += beat;
      this.step++;
    }
  }

  pad(notes, time, duration) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(340, time);
    filter.frequency.linearRampToValueAtTime(900, time + duration * 0.45);
    filter.frequency.linearRampToValueAtTime(300, time + duration);
    filter.Q.value = 3;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.09, time + duration * 0.3);
    gain.gain.linearRampToValueAtTime(0.0001, time + duration);

    filter.connect(gain).connect(this.musicGain);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    gain.connect(send).connect(this.reverb);

    for (const note of notes) {
      // Two slightly detuned voices per note give the pad its slow beating.
      for (const detune of [-6, 6]) {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = mtof(note);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration + 0.1);
      }
    }
  }

  pluck(note, time) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.value = mtof(note);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200, time);
    filter.frequency.exponentialRampToValueAtTime(700, time + 0.5);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.055, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.1);
    osc.connect(filter).connect(gain).connect(this.musicGain);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    gain.connect(send).connect(this.reverb);
    osc.start(time);
    osc.stop(time + 1.2);
  }

  // ---- sound effect helpers ---------------------------------------------

  sfx(fn) {
    if (this.muted.sfx) return;
    this.ensureContext();
    if (this.ctx.state === 'suspended') return;
    fn(this.ctx, this.sfxGain, this.ctx.currentTime);
  }

  /** Filtered noise burst — the transient half of every board sound. */
  noise(ctx, out, t, { type = 'bandpass', freq = 2000, q = 1, level = 0.2, dur = 0.06, sweep = null }) {
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.75 + Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    if (sweep) filter.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(out);
    src.start(t);
    src.stop(t + dur + 0.05);
    return gain;
  }

  /** Damped sine — the wooden body of a piece meeting the board. */
  body(ctx, out, t, { freq = 180, drop = 70, level = 0.3, dur = 0.16, type = 'sine' }) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(drop, t + dur);
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return gain;
  }

  tone(ctx, out, t, freq, { type = 'triangle', level = 0.16, attack = 0.012, dur = 0.4, send = 0.3 }) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(level, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(out);
    if (send > 0 && this.reverb) {
      const bus = ctx.createGain();
      bus.gain.value = send;
      gain.connect(bus).connect(this.reverb);
    }
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  // ---- the board -------------------------------------------------------

  /** Fingertips closing on a piece: a small dry tick, no body. */
  lift() {
    this.sfx((ctx, out, t) => {
      this.noise(ctx, out, t, { type: 'highpass', freq: 2600, level: 0.09, dur: 0.035 });
      this.body(ctx, out, t, { freq: 620, drop: 420, level: 0.05, dur: 0.05 });
    });
  }

  /** A piece set down on an empty square. */
  place() {
    this.sfx((ctx, out, t) => {
      this.body(ctx, out, t, { freq: 210, drop: 62, level: 0.34, dur: 0.15 });
      this.noise(ctx, out, t, { type: 'bandpass', freq: 2400, q: 1.2, level: 0.16, dur: 0.05, sweep: 900 });
      this.noise(ctx, out, t + 0.004, { type: 'lowpass', freq: 700, level: 0.1, dur: 0.09 });
    });
  }

  /** A piece taken: the same knock, plus the scrape of the loser leaving. */
  capture() {
    this.duck(0.7, 0.5);
    this.sfx((ctx, out, t) => {
      this.body(ctx, out, t, { freq: 260, drop: 48, level: 0.4, dur: 0.22 });
      this.noise(ctx, out, t, { type: 'bandpass', freq: 1800, q: 0.8, level: 0.3, dur: 0.11, sweep: 420 });
      this.noise(ctx, out, t + 0.055, { type: 'highpass', freq: 1500, level: 0.14, dur: 0.13 });
      this.body(ctx, out, t + 0.05, { freq: 120, drop: 40, level: 0.18, dur: 0.2, type: 'triangle' });
    });
  }

  /** Castling: king first, then the rook swinging past it. */
  castle() {
    this.sfx((ctx, out, t) => {
      this.body(ctx, out, t, { freq: 200, drop: 60, level: 0.3, dur: 0.14 });
      this.noise(ctx, out, t, { type: 'bandpass', freq: 2200, q: 1.2, level: 0.15, dur: 0.05, sweep: 800 });
      this.body(ctx, out, t + 0.12, { freq: 240, drop: 70, level: 0.28, dur: 0.14 });
      this.noise(ctx, out, t + 0.12, { type: 'bandpass', freq: 2600, q: 1.2, level: 0.14, dur: 0.05, sweep: 900 });
      this.tone(ctx, out, t + 0.14, 523.25, { level: 0.07, dur: 0.5, send: 0.4 });
    });
  }

  /** Check: a tense tritone stab that resolves nowhere. */
  check() {
    this.duck(0.5, 1.0);
    this.sfx((ctx, out, t) => {
      this.body(ctx, out, t, { freq: 240, drop: 60, level: 0.3, dur: 0.16 });
      [mtof(52), mtof(58)].forEach((f) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(f, t);
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(500, t);
        filter.frequency.exponentialRampToValueAtTime(2400, t + 0.18);
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.linearRampToValueAtTime(0.12, t + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
        osc.connect(filter).connect(gain).connect(out);
        const send = ctx.createGain();
        send.gain.value = 0.4;
        gain.connect(send).connect(this.reverb);
        osc.start(t);
        osc.stop(t + 0.75);
      });
    });
  }

  /** Promotion: the pawn's knock blooms into a rising sparkle. */
  promote() {
    this.duck(0.5, 1.6);
    this.sfx((ctx, out, t) => {
      this.body(ctx, out, t, { freq: 220, drop: 70, level: 0.26, dur: 0.14 });
      [0, 4, 7, 12, 16, 19].forEach((semi, i) => {
        this.tone(ctx, out, t + 0.05 + i * 0.06, mtof(60 + semi), {
          type: i > 3 ? 'sine' : 'triangle',
          level: 0.13,
          dur: 0.7,
          send: 0.5,
        });
      });
    });
  }

  /** A move the rules do not allow: a dull, damped knock. */
  illegal() {
    this.sfx((ctx, out, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(96, t + 0.18);
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
      osc.connect(filter).connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  }

  select() {
    this.sfx((ctx, out, t) => {
      this.body(ctx, out, t, { freq: 900, drop: 700, level: 0.05, dur: 0.04 });
    });
  }

  hover() {
    this.sfx((ctx, out, t) => {
      this.tone(ctx, out, t, 1180, { type: 'sine', level: 0.035, attack: 0.004, dur: 0.06, send: 0 });
    });
  }

  click() {
    this.sfx((ctx, out, t) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(480, t);
      osc.frequency.exponentialRampToValueAtTime(980, t + 0.05);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      osc.connect(gain).connect(out);
      osc.start(t);
      osc.stop(t + 0.1);
    });
  }

  /** Rising major fanfare over a swell. */
  victory() {
    this.duck(0.2, 3.2);
    this.sfx((ctx, out, t) => {
      [60, 64, 67, 72, 76, 79].forEach((note, i) => {
        const start = t + i * 0.12;
        this.tone(ctx, out, start, mtof(note), { level: 0.17, dur: 0.9, send: 0.5 });
        this.tone(ctx, out, start, mtof(note + 12), { type: 'sine', level: 0.07, dur: 0.9, send: 0.5 });
      });
      this.noise(ctx, out, t, { type: 'highpass', freq: 5000, level: 0.1, dur: 0.9 });
    });
  }

  /** The same shape falling, in the minor. */
  defeat() {
    this.duck(0.2, 3.2);
    this.sfx((ctx, out, t) => {
      [67, 63, 60, 55, 51, 48].forEach((note, i) => {
        const start = t + i * 0.15;
        this.tone(ctx, out, start, mtof(note), { level: 0.15, dur: 1.1, send: 0.55 });
      });
    });
  }

  /** Neither win nor loss: an unresolved suspended chord. */
  drawn() {
    this.duck(0.3, 2.4);
    this.sfx((ctx, out, t) => {
      [55, 60, 62, 67].forEach((note, i) => {
        this.tone(ctx, out, t + i * 0.05, mtof(note), { level: 0.13, dur: 1.6, send: 0.5 });
      });
    });
  }
}

export const audio = new AudioEngine();
