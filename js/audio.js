// SFX are synthesized at runtime. Music beds that have a soundtrack file
// (shop, fight, game over) play those; the map still uses a generative pad.
//
// One mixer feeds two buses: SFX (the wooden knocks, captures and stingers) and
// music. Both run through a procedurally-generated convolution reverb and a bus
// compressor, and the music ducks under the bigger stingers so a checkmate lands
// cleanly.

const MUSIC_DIR = 'Music/';
const TRACK = {
  shop: 'Wildfrost OST - The Wooly Snail.mp3',
  gameover: 'Wildfrost OST - Trapped Spirits.mp3',
  fightSetup: 'Wildfrost OST - Spirit Call.mp3',
  combat: [
    "Wildfrost OST - Winter's Wrath.mp3",
    'Wildfrost OST - Tundra Heart.mp3',
    'Wildfrost OST - March of the Pengoons.mp3',
    'Wildfrost OST - Luminice Dance.mp3',
  ],
};
const trackUrl = (file) => MUSIC_DIR + encodeURIComponent(file);
const FILE_STYLES = new Set(['shop', 'fight', 'gameover']);
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
    this.musicStyle = 'ambient';
    this.stems = new Map();
    this.combatHot = false;
    this.combatOrder = [];
    this.combatIndex = 0;
    this.preloadStarted = false;
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

    // Fight-bed bus. Kicks duck it so the glitch-pop pumps instead of washing.
    this.pumpGain = this.ctx.createGain();
    this.pumpGain.gain.value = 1;
    this.pumpGain.connect(this.musicGain);

    this.crushCurve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = i / 128 - 1;
      this.crushCurve[i] = Math.tanh(Math.round(x * 6) / 6 * 2.2);
    }

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
    this.preloadMusic();
    if (FILE_STYLES.has(this.musicStyle)) {
      this.stopScheduler();
      this.startFileStyle(this.musicStyle);
      return;
    }
    if (this.musicTimer) return;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.step = 0;
    // Look ahead by a few beats and schedule precisely on the audio clock; the
    // timer only has to be roughly on time.
    this.musicTimer = setInterval(() => this.scheduleMusic(), 50);
    this.scheduleMusic();
  }

  stopMusic() {
    this.stopScheduler();
    this.stopAllStems(0.2);
  }

  stopScheduler() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  /**
   * Crossfade between the wilderness bed, the town, the shop, the fight, and
   * the game-over dirge.
   * @param {'ambient'|'fight'|'shop'|'town'|'gameover'} style
   */
  setMusicStyle(style) {
    // A new fight always restarts on Spirit Call even if we were already in
    // a fight — otherwise the previous combat playlist would keep running.
    if (this.musicStyle === style && style !== 'fight') return;
    const prev = this.musicStyle;
    this.musicStyle = style;
    this.combatHot = false;
    if (!this.ctx || this.muted.music || !this.musicGain) return;

    if (FILE_STYLES.has(prev) || FILE_STYLES.has(style)) {
      this.stopAllStems(0.7);
      if (FILE_STYLES.has(style)) {
        this.stopScheduler();
        this.startFileStyle(style);
        return;
      }
      this.startMusic();
      return;
    }

    const t = this.ctx.currentTime;
    const g = this.musicGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(0.0001, t + 0.16);
    this.step = 0;
    this.nextNoteTime = t + 0.18;
    g.linearRampToValueAtTime(this.musicVolume, t + 0.5);
    if (this.musicTimer) this.scheduleMusic();
  }

  scheduleMusic() {
    if (!this.ctx || this.muted.music) return;
    if (FILE_STYLES.has(this.musicStyle)) return;
    if (this.musicStyle === 'town') this.scheduleTown();
    else this.scheduleAmbient();
  }

  // ---- soundtrack files -------------------------------------------------
  //
  // Shop, fight setup, combat, and game over play the Wildfrost beds. Fight
  // starts on the quiet Spirit Call loop; the first capture or hit crossfades
  // that out and walks a playlist of the full combat tracks.

  preloadMusic() {
    if (this.preloadStarted || !this.ctx) return;
    this.preloadStarted = true;
    this.stem('shop', TRACK.shop, true);
    this.stem('gameover', TRACK.gameover, true);
    this.stem('fight-setup', TRACK.fightSetup, true);
    TRACK.combat.forEach((file, i) => this.stem(`combat-${i}`, file, false));
  }

  stem(id, file, loop) {
    if (this.stems.has(id)) return this.stems.get(id);
    this.ensureContext();
    const el = new Audio();
    el.src = trackUrl(file);
    el.loop = Boolean(loop);
    el.preload = 'auto';
    el.crossOrigin = 'anonymous';
    const gain = this.ctx.createGain();
    gain.gain.value = 0.0001;
    const src = this.ctx.createMediaElementSource(el);
    src.connect(gain).connect(this.musicGain);
    const node = { id, el, gain, src, file };
    this.stems.set(id, node);
    return node;
  }

  fadeStem(id, to, seconds = 1.1) {
    const node = this.stems.get(id);
    if (!node || !this.ctx) return;
    const t = this.ctx.currentTime;
    const g = node.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(0.0001, g.value), t);
    g.linearRampToValueAtTime(Math.max(0.0001, to), t + seconds);
  }

  async startStem(id, { volume = 1, fade = 0.9, reset = true } = {}) {
    const node = this.stems.get(id);
    if (!node) return;
    node.gen = (node.gen || 0) + 1;
    if (reset) {
      try { node.el.currentTime = 0; } catch { /* some browsers refuse before metadata */ }
    }
    this.fadeStem(id, volume, fade);
    try { await node.el.play(); } catch { /* gesture / autoplay — resume() already ran */ }
  }

  stopStem(id, fade = 0.8) {
    const node = this.stems.get(id);
    if (!node) return;
    node.gen = (node.gen || 0) + 1;
    const gen = node.gen;
    this.fadeStem(id, 0.0001, fade);
    const el = node.el;
    setTimeout(() => {
      if (this.stems.get(id) !== node || node.gen !== gen) return;
      try { el.pause(); } catch { /* already stopped */ }
    }, fade * 1000 + 80);
  }

  stopAllStems(fade = 0.6) {
    for (const id of this.stems.keys()) this.stopStem(id, fade);
    this.combatHot = false;
  }

  startFileStyle(style) {
    if (this.muted.music) return;
    this.preloadMusic();
    if (style === 'shop') this.startStem('shop', { volume: 0.92, fade: 0.8 });
    else if (style === 'gameover') this.startStem('gameover', { volume: 0.95, fade: 1.2 });
    else if (style === 'fight') {
      this.combatHot = false;
      this.startStem('fight-setup', { volume: 0.88, fade: 0.7 });
    }
  }

  /**
   * First enemy piece taken: Spirit Call ducks out and the combat playlist
   * (Winter's Wrath, Tundra Heart, the Pengoons, Luminice Dance) takes over.
   */
  engageCombat() {
    if (this.muted.music || this.musicStyle !== 'fight' || this.combatHot) return;
    this.combatHot = true;
    this.stopStem('fight-setup', 1.6);
    this.combatOrder = TRACK.combat
      .map((_, i) => i)
      .sort(() => Math.random() - 0.5);
    this.combatIndex = 0;
    this.playCombatTrack(this.combatIndex, 1.5);
  }

  playCombatTrack(index, fade = 0.9) {
    if (!this.combatHot || this.musicStyle !== 'fight') return;
    const order = this.combatOrder;
    if (!order.length) return;
    const which = order[((index % order.length) + order.length) % order.length];
    const id = `combat-${which}`;
    for (let i = 0; i < TRACK.combat.length; i++) {
      if (i !== which) this.stopStem(`combat-${i}`, 0.4);
    }
    const node = this.stems.get(id);
    if (node) {
      node.el.loop = false;
      node.el.onended = () => {
        if (!this.combatHot || this.musicStyle !== 'fight') return;
        this.combatIndex = (this.combatIndex + 1) % order.length;
        this.playCombatTrack(this.combatIndex, 0.4);
      };
    }
    this.startStem(id, { volume: 0.95, fade, reset: true });
  }

  scheduleAmbient() {
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

  // ---- fight bed --------------------------------------------------------
  //
  // A battle walk: pulsing fifths, a tight kick, and short horns. Faster and
  // harder than the old reed-and-frame-drum bed so a clash actually sounds
  // like one.

  static get FIGHT() {
    return [
      { bass: 38, fifth: 45, scale: [62, 65, 67, 70, 74], stab: [62, 65, 70] },
      { bass: 36, fifth: 43, scale: [60, 63, 67, 70, 72], stab: [60, 63, 67] },
      { bass: 41, fifth: 48, scale: [65, 68, 72, 75, 77], stab: [65, 68, 72] },
      { bass: 34, fifth: 41, scale: [58, 62, 65, 70, 74], stab: [58, 65, 70] },
    ];
  }

  scheduleFight() {
    const ctx = this.ctx;
    const beat = 60 / 118;
    while (this.nextNoteTime < ctx.currentTime + 0.7) {
      const step = this.step % 8;
      const bar = Math.floor(this.step / 8) % AudioEngine.FIGHT.length;
      const slot = AudioEngine.FIGHT[bar];
      const t = this.nextNoteTime;

      if (step === 0) this.drone([slot.bass, slot.fifth], t, beat * 8);
      if (step === 0 || step === 4) this.kick(t, step === 0 ? 0.22 : 0.16);
      if (step === 2 || step === 6) this.frameDrum(t, 0.1);
      if (step === 4) this.noise(ctx, this.musicGain, t, {
        type: 'bandpass', freq: 1800, q: 1.4, level: 0.055, dur: 0.06,
      });
      if (step === 0 || step === 3) {
        this.horn(slot.stab[step === 0 ? 0 : 1], t, beat * 1.4);
      }
      if (step === 5 && Math.random() < 0.65) {
        this.horn(slot.stab[2], t, beat * 0.9);
      }
      if (step % 2 === 1 && Math.random() < 0.45) {
        this.reed(slot.scale[Math.floor(Math.random() * slot.scale.length)], t, beat * 1.1);
      }

      this.nextNoteTime += beat;
      this.step++;
    }
  }

  kick(time, level) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, time);
    osc.frequency.exponentialRampToValueAtTime(48, time + 0.12);
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.22);
    osc.connect(gain).connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.24);
    this.noise(ctx, this.musicGain, time, {
      type: 'lowpass', freq: 280, q: 0.8, level: level * 0.35, dur: 0.05,
    });
  }

  horn(note, time, dur) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(900, time);
    filter.frequency.linearRampToValueAtTime(1400, time + dur * 0.3);
    filter.frequency.exponentialRampToValueAtTime(500, time + dur);
    filter.Q.value = 2.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.06, time + 0.03);
    gain.gain.linearRampToValueAtTime(0.035, time + dur * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    for (const [type, detune] of [['sawtooth', -6], ['square', 8]]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = mtof(note);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    }
    filter.connect(gain).connect(this.musicGain);
    const send = ctx.createGain();
    send.gain.value = 0.32;
    gain.connect(send).connect(this.reverb);
  }

  // ---- town bed ---------------------------------------------------------
  //
  // A hamlet: a slow major drone, a recorder, and a harp. Brighter than the
  // wilderness, quieter than the shop, no drums of war.

  static get TOWN() {
    return [
      { drone: [50, 57], scale: [69, 71, 74, 76, 78, 81], harp: [62, 66, 69] },
      { drone: [45, 52], scale: [64, 69, 71, 73, 76, 81], harp: [57, 64, 69] },
      { drone: [47, 54], scale: [66, 71, 73, 74, 78, 81], harp: [59, 66, 71] },
      { drone: [43, 50], scale: [62, 67, 71, 74, 78, 79], harp: [55, 62, 67] },
    ];
  }

  scheduleTown() {
    const ctx = this.ctx;
    const beat = 60 / 84;
    while (this.nextNoteTime < ctx.currentTime + 0.7) {
      const step = this.step % 8;
      const bar = Math.floor(this.step / 8) % AudioEngine.TOWN.length;
      const slot = AudioEngine.TOWN[bar];
      const t = this.nextNoteTime;

      if (step === 0) this.pad(slot.drone.concat(slot.harp), t, beat * 8);
      if (step === 0 || step === 4) this.harp(slot.harp[step === 0 ? 0 : 2], t);
      if (step === 2 || step === 6) this.harp(slot.harp[1], t);
      if (step === 1 || (step === 5 && Math.random() < 0.7)) {
        const note = slot.scale[(bar * 2 + step) % slot.scale.length];
        this.flute(note, t, beat * (2.2 + Math.random() * 0.8));
      }
      if (step === 7 && Math.random() < 0.4) {
        this.flute(slot.scale[slot.scale.length - 1], t, beat * 1.6);
      }
      if ((step === 0 || step === 4) && Math.random() < 0.5) this.jingle(t, 0.018);

      this.nextNoteTime += beat;
      this.step++;
    }
  }

  harp(note, time) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4200, time);
    filter.frequency.exponentialRampToValueAtTime(900, time + 0.8);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.055, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.15);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = mtof(note);
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = mtof(note) * 2;
    osc2.detune.value = 4;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(this.musicGain);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    gain.connect(send).connect(this.reverb);
    osc.start(time);
    osc2.start(time);
    osc.stop(time + 1.2);
    osc2.stop(time + 1.2);
  }

  flute(note, time, dur) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = mtof(note) * 1.6;
    filter.Q.value = 3.2;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.048, time + 0.08);
    gain.gain.linearRampToValueAtTime(0.03, time + dur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = mtof(note);
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.value = mtof(note);
    osc2.detune.value = 5;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(this.musicGain);
    this.noise(ctx, gain, time, {
      type: 'bandpass', freq: mtof(note) * 2, q: 2, level: 0.012, dur: Math.min(0.2, dur * 0.2),
    });
    const send = ctx.createGain();
    send.gain.value = 0.48;
    gain.connect(send).connect(this.reverb);
    osc.start(time);
    osc2.start(time);
    osc.stop(time + dur + 0.05);
    osc2.stop(time + dur + 0.05);
  }

  // ---- shop bed ---------------------------------------------------------
  //
  // A market walk: lute plucks over a warm major pad, light jingle, no drums
  // of war. Brighter and busier than the menu, never the fight.

  static get SHOP() {
    return [
      { chord: [50, 57, 62, 66], scale: [62, 64, 66, 69, 71, 74, 78] },
      { chord: [53, 60, 65, 69], scale: [65, 67, 69, 72, 74, 77, 81] },
      { chord: [48, 55, 60, 64], scale: [60, 64, 67, 69, 72, 76, 79] },
      { chord: [55, 62, 67, 71], scale: [62, 67, 69, 71, 74, 79, 83] },
    ];
  }

  scheduleShop() {
    const ctx = this.ctx;
    const beat = 60 / 104;
    while (this.nextNoteTime < ctx.currentTime + 0.7) {
      const step = this.step % 8;
      const bar = Math.floor(this.step / 8) % AudioEngine.SHOP.length;
      const slot = AudioEngine.SHOP[bar];
      const t = this.nextNoteTime;

      if (step === 0) this.pad(slot.chord, t, beat * 8);
      if (step === 0 || step === 3 || step === 5 || (step === 7 && Math.random() < 0.45)) {
        const note = slot.scale[(step + (this.step >> 3)) % slot.scale.length];
        this.lute(note, t);
      }
      if (step === 2 && Math.random() < 0.55) {
        this.lute(slot.scale[Math.floor(Math.random() * slot.scale.length)] + 12, t);
      }
      if (step === 0 || step === 4) this.jingle(t, step === 0 ? 0.045 : 0.03);
      if (step === 6 && Math.random() < 0.4) this.jingle(t, 0.025);

      this.nextNoteTime += beat;
      this.step++;
    }
  }

  lute(note, time) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2800, time);
    filter.frequency.exponentialRampToValueAtTime(620, time + 0.45);
    filter.Q.value = 1.6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.07, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.55);
    for (const detune of [-8, 5]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = mtof(note);
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(time);
      osc.stop(time + 0.6);
    }
    filter.connect(gain).connect(this.musicGain);
    const send = ctx.createGain();
    send.gain.value = 0.42;
    gain.connect(send).connect(this.reverb);
  }

  jingle(time, level) {
    this.noise(this.ctx, this.musicGain, time, {
      type: 'highpass', freq: 5400, q: 0.8, level: level * 0.7, dur: 0.06,
    });
    this.tone(this.ctx, this.musicGain, time, 1568, {
      type: 'sine', level: level, attack: 0.004, dur: 0.18, send: 0.25,
    });
    this.tone(this.ctx, this.musicGain, time + 0.02, 2093, {
      type: 'sine', level: level * 0.55, attack: 0.004, dur: 0.14, send: 0.2,
    });
  }

  drone(notes, time, duration) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, time);
    filter.frequency.linearRampToValueAtTime(700, time + duration * 0.5);
    filter.frequency.linearRampToValueAtTime(380, time + duration);
    filter.Q.value = 1.4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.07, time + 0.4);
    gain.gain.linearRampToValueAtTime(0.0001, time + duration);
    filter.connect(gain).connect(this.musicGain);
    const send = ctx.createGain();
    send.gain.value = 0.45;
    gain.connect(send).connect(this.reverb);
    for (const note of notes) {
      for (const detune of [-5, 5]) {
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

  frameDrum(time, level) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(92, time);
    osc.frequency.exponentialRampToValueAtTime(46, time + 0.18);
    gain.gain.setValueAtTime(level, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);
    osc.connect(gain).connect(this.musicGain);
    osc.start(time);
    osc.stop(time + 0.3);
    this.noise(ctx, this.musicGain, time, {
      type: 'bandpass', freq: 380, q: 2.2, level: level * 0.45, dur: 0.07,
    });
  }

  reed(note, time, dur) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = mtof(note) * 2.2;
    filter.Q.value = 4;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.055, time + 0.06);
    gain.gain.linearRampToValueAtTime(0.03, time + dur * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = mtof(note);
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = mtof(note);
    osc2.detune.value = 7;
    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain).connect(this.musicGain);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    gain.connect(send).connect(this.reverb);
    osc.start(time);
    osc2.start(time);
    osc.stop(time + dur + 0.05);
    osc2.stop(time + dur + 0.05);
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
