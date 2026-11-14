const EPSILON = 1e-8;
const MAX_SOUNDS = 20;
const SOUND_COOLDOWN = .065;
const MAX_SOUND_LATENESS = .3;
const MUSIC_RELEASE = .12;

function cueFrames(value) {
  const values = Array.isArray(value) ? value : value == null ? [0] : [value];
  return [...new Set(values.filter(n => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b);
}

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.manifest = { events: {} };
    this.buffers = new Map();
    this.volume = .45;
    this.muted = false;
    this.mode = 'ambient';
    this.tracks = new Map();
    this.lastPlayed = new Map();
    this._lastStarted = new Map();
    this.unlocked = false;
    this.suspended = false;
    this.activeSounds = 0;
    this.pending = [];
    this._attacks = new WeakMap();
    this._observedStates = new WeakMap();
    this._thawing = new WeakMap();
    this._sounds = new Set();
    this._loadingSounds = new Set();
    this._retiringTracks = new Set();
    this._musicReadyAt = 0;
    this._soundEpoch = 0;
    this._lifecycle = 0;
  }

  async load() {
    const res = await fetch('./assets/audio/manifest.json');
    if (!res.ok) throw new Error('音频素材尚未载入');
    this.manifest = await res.json();
  }

  async unlock() {
    const lifecycle = this._lifecycle;
    const needsSync = !this.unlocked || this.suspended;
    try {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.applyVolume();
      }
      await this.ctx.resume();
      // A pause issued while resume was pending must win over that resume.
      if (lifecycle !== this._lifecycle) return false;
      this.unlocked = true;
      this.suspended = false;
      if (needsSync) this.setMode(this.mode, true);
      return true;
    } catch (error) {
      console.warn('Audio unlock:', error);
      return false;
    }
  }

  setVolume(volume) {
    if (Number.isFinite(volume)) this.volume = Math.max(0, Math.min(1, volume));
    this.applyVolume();
  }

  applyVolume() {
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, .08);
  }

  async buffer(src) {
    if (!this.buffers.has(src)) {
      const promise = fetch(src).then(r => {
        if (!r.ok) throw new Error(src);
        return r.arrayBuffer();
      }).then(b => this.ctx.decodeAudioData(b));
      this.buffers.set(src, promise);
      promise.catch(() => { if (this.buffers.get(src) === promise) this.buffers.delete(src); });
    }
    return this.buffers.get(src);
  }

  _finishSound(record) {
    if (record.finished) return;
    record.finished = true;
    this._sounds.delete(record);
    this.activeSounds = Math.max(0, this.activeSounds - 1);
    record.source.onended = null;
    record.source.disconnect();
    record.gain.disconnect();
  }

  _invalidateSounds() {
    this._soundEpoch++;
    this._loadingSounds.clear();
    for (const record of [...this._sounds]) {
      try { record.source.stop(); } catch { /* Already ended. */ }
      this._finishSound(record);
    }
  }

  async play(key, volume = 1, isValid = () => true, options = {}) {
    if (!this.unlocked || this.suspended || this.muted || !isValid() ||
        this.activeSounds + this._loadingSounds.size >= MAX_SOUNDS) return false;
    const entry = this.manifest.events[key];
    if (!entry?.files?.length) return false;
    const now = this.ctx.currentTime;
    const cooldown = options.cooldown ?? SOUND_COOLDOWN;
    if (now - (this.lastPlayed.get(key) ?? -Infinity) < cooldown) return false;
    this.lastPlayed.set(key, now);
    const src = entry.files[Math.floor(Math.random() * entry.files.length)];
    const ticket = { epoch: this._soundEpoch };
    this._loadingSounds.add(ticket);
    try {
      const buffer = await this.buffer(src);
      if (ticket.epoch !== this._soundEpoch || this.suspended || this.muted || !isValid() ||
          this.ctx.currentTime - now > MAX_SOUND_LATENESS ||
          this.ctx.currentTime - (this._lastStarted.get(key) ?? -Infinity) < cooldown) return false;
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      source.buffer = buffer;
      source.loop = options.loop ?? false;
      gain.gain.value = (entry.volume ?? .7) * volume;
      source.connect(gain);
      gain.connect(this.master);
      const record = { source, gain, finished: false, isValid, loop: source.loop };
      this._sounds.add(record);
      this.activeSounds++;
      source.onended = () => this._finishSound(record);
      try { source.start(); }
      catch (error) { this._finishSound(record); throw error; }
      this._lastStarted.set(key, this.ctx.currentTime);
      return true;
    } catch (error) {
      console.warn('Audio:', key, error);
      return false;
    } finally {
      this._loadingSounds.delete(ticket);
    }
  }

  _finishTrack(record) {
    if (record.finished) return;
    record.finished = true;
    this._retiringTracks.delete(record);
    if (this.tracks.get(record.key) === record) this.tracks.delete(record.key);
    record.source.onended = null;
    record.source.disconnect();
    record.gain.disconnect();
  }

  _retireTrack(key, fade = 0) {
    const record = this.tracks.get(key);
    if (!record) return this.ctx.currentTime;
    this.tracks.delete(key); // Also invalidates an in-flight decode reservation.
    if (record.pending) return this.ctx.currentTime;
    const now = this.ctx.currentTime;
    const end = record.startAt > now ? now : now + fade;
    record.gain.gain.cancelScheduledValues(now);
    record.gain.gain.setValueAtTime(record.gain.gain.value, now);
    record.gain.gain.linearRampToValueAtTime(0, end);
    this._retiringTracks.add(record);
    record.source.stop(end);
    return end;
  }

  async track(key, volume, fade = 1.2) {
    if (!this.unlocked || this.suspended) return;
    if (volume <= 0) { this._retireTrack(key, MUSIC_RELEASE); return; }
    const current = this.tracks.get(key);
    if (current) {
      current.targetVolume = volume;
      if (current.pending) return;
      const at = Math.max(this.ctx.currentTime, current.startAt);
      current.gain.gain.cancelScheduledValues(at);
      current.gain.gain.setTargetAtTime(volume * (this.manifest.events[key]?.volume ?? .5), at, Math.max(.01, fade / 3));
      return;
    }
    const entry = this.manifest.events[key];
    if (!entry?.files?.length) return;
    const record = { key, pending: true, targetVolume: volume };
    this.tracks.set(key, record);
    try {
      const buffer = await this.buffer(entry.files[0]);
      if (this.tracks.get(key) !== record || this.suspended) {
        if (this.tracks.get(key) === record) this.tracks.delete(key);
        return;
      }
      const source = this.ctx.createBufferSource();
      const gain = this.ctx.createGain();
      const startAt = key === 'ambient' ? this.ctx.currentTime : Math.max(this.ctx.currentTime, this._musicReadyAt);
      source.buffer = buffer;
      source.loop = entry.loop ?? true;
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.master);
      Object.assign(record, { source, gain, pending: false, startAt });
      source.onended = () => this._finishTrack(record);
      gain.gain.setValueAtTime(0, startAt);
      gain.gain.setTargetAtTime(record.targetVolume * (entry.volume ?? .5), startAt, Math.max(.01, fade / 3));
      source.start(startAt);
    } catch (error) {
      if (this.tracks.get(key) === record) this.tracks.delete(key);
      if (record.source) this._finishTrack(record);
      console.warn('Music:', key, error);
    }
  }

  setMode(mode, force = false) {
    this.mode = mode;
    if (!this.unlocked || this.suspended) return;
    const desired = mode === 'boss' ? 'boss' : mode === 'combat' ? 'combat' : 'calm';
    this.track('ambient', .6, .8);
    for (const key of [...this.tracks.keys()]) {
      if (key === 'ambient' || key === desired) continue;
      // Fade the previous music out before the next music starts. Environmental
      // ambience is independent; two music tracks never overlap audibly.
      this._musicReadyAt = Math.max(this._musicReadyAt, this._retireTrack(key, MUSIC_RELEASE));
    }
    this.track(desired, .8, force ? .6 : 1.2);
  }

  pause() {
    this.suspended = true;
    this._lifecycle++;
    this._invalidateSounds();
    for (const [key, record] of this.tracks) if (record.pending) this.tracks.delete(key);
    return this.ctx?.suspend();
  }

  resume() { return this.unlock(); }

  _validCue(token, world) {
    const entity = token.entity;
    return (token.kind === 'reaction' || this._attacks.get(entity) === token) && world.entities.includes(entity) && (!entity.dead || token.allowDead) &&
      entity.state === token.state && entity.stateStarted === token.started &&
      (token.kind === 'state' || token.kind === 'reaction' || entity.attackActive || entity.state === 'attack' || token.state === 'taunt');
  }

  _stateToken(entity) {
    const token = { entity, state: entity.state, started: entity.stateStarted, kind: 'state' };
    this._attacks.set(entity, token);
    return token;
  }

  _queueCues(token, key, at, volume = .65, frames) {
    const entry = this.manifest.events[key];
    if (!entry?.files?.length) return;
    for (const frame of cueFrames(frames ?? entry.triggerFrames)) this.pending.push({ token, key, at: at + frame / 30, volume });
  }

  _watchStates(world) {
    for (const entity of world.entities) {
      if (!entity.dead && entity.state === 'thaw') {
        const before = this._thawing.get(entity);
        if (before?.started !== entity.stateStarted || before.epoch !== this._soundEpoch) {
          const marker = { started: entity.stateStarted, epoch: this._soundEpoch };
          this._thawing.set(entity, marker);
          this.play('thaw', .6, () => world.entities.includes(entity) && !entity.dead && entity.state === 'thaw' && entity.stateStarted === marker.started, { loop: true, cooldown: 0 }).then(played => {
            if (!played && this._thawing.get(entity) === marker) this._thawing.delete(entity);
          });
        }
      }
      if (!['tentacle', 'slurtle', 'spider_hider'].includes(entity.type)) continue;
      const before = this._observedStates.get(entity);
      if (before?.state === entity.state && before.started === entity.stateStarted) continue;
      this._observedStates.set(entity, { state: entity.state, started: entity.stateStarted });
      if (entity.dead) continue;
      // The breach/taunt is only a warning. Actual emerge audio starts with
      // atk_pre; the voice is its frame-20 cue, not the first lash's cue.
      let keys = [];
      let frames;
      if (entity.type === 'tentacle') keys = entity.state === 'attack_pre' ? ['tentacle_emerge', 'tentacle_emerge_voice'] :
        entity.state === 'retract' ? ['tentacle_disappear'] : [];
      else if (entity.type === 'slurtle') keys = entity.state === 'shield' && entity.animation === 'hide' ? ['slurtle_hide'] :
        entity.state === 'shield_end' ? ['slurtle_emerge'] : [];
      else if (entity.state === 'shield' && entity.animation === 'hide') {
        keys = ['spider_hider_attack', 'spider_hider_swipe']; frames = 2;
      }
      if (!keys.length) continue;
      const token = this._stateToken(entity);
      for (const key of keys) this._queueCues(token, key, entity.stateStarted, .6, frames);
    }
  }

  update(world) {
    if (this.suspended || world.paused) return;
    for (const record of [...this._sounds]) if (record.loop && !record.isValid()) {
      try { record.source.stop(); } catch { /* Already stopped. */ }
      this._finishSound(record);
    }
    this._watchStates(world);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const cue = this.pending[i];
      if (!this._validCue(cue.token, world)) { this.pending.splice(i, 1); continue; }
      if (world.time + EPSILON < cue.at) continue;
      this.pending.splice(i, 1);
      this.play(cue.key, cue.volume, () => this._validCue(cue.token, world));
    }
  }

  event(event, world) {
    const entity = world.entities.find(e => e.id === event.id) ??
      (['dashstart', 'dash', 'dashend', 'dashcancel'].includes(event.type) ? world.player : null);
    const source = world.entities.find(e => e.id === event.sourceId);
    if (event.type === 'reset') {
      this.pending.length = 0;
      this._attacks = new WeakMap();
      this._observedStates = new WeakMap();
      this._thawing = new WeakMap();
      this.lastPlayed.clear();
      this._lastStarted.clear();
      this._invalidateSounds();
    } else if (event.type === 'equip' || event.type === 'unequip') {
      // A hand swap emits both; the shared short cooldown makes one stock cue.
      this.play('inventory_equip', .65);
    } else if (event.type === 'inventorychange') {
      if (['slot', 'return'].includes(event.reason)) this.play('inventory_click', .65);
    } else if (event.type === 'pickup') {
      const item = world.inventory?.slots?.[event.slot];
      const type = event.itemType ?? item?.type;
      this.play(['cutgrass', 'grass'].includes(type) ? 'inventory_pickup_grass' : 'inventory_pickup', .65);
    } else if (event.type === 'itemdrop') {
      this.play('inventory_drop', .6);
    } else if (event.type === 'icespike' && event.sound) {
      // These are independent spawned hazards; an interrupted swing must not
      // mute already spawned ice. The native field marks six audible spikes.
      const hazard = world.hazards?.find(h => h.id === event.hazardId);
      if (hazard) this.play('deerclops_ice', .5, () => world.hazards?.includes(hazard), { cooldown: 0 });
    } else if (event.type === 'freeze' && entity) {
      this.play('freeze', .65, () => world.entities.includes(entity) && entity.state === 'frozen' && !entity.dead);
    } else if (event.type === 'unfreeze' && entity) {
      this.play('breakfreeze', .65, () => world.entities.includes(entity));
    } else if (event.type === 'burst' && entity?.type === 'mosquito') {
      this.play('mosquito_burst', .7, () => world.entities.includes(entity));
    } else if (event.type === 'charged' && entity?.type === 'lightninggoat') {
      if (entity.state !== 'shocked') return;
      const token = this._stateToken(entity);
      for (const key of ['lightninggoat_charged', 'lightninggoat_charge_voice', 'lightninggoat_horn']) this._queueCues(token, key, entity.stateStarted, .6, 0);
    } else if (event.type === 'attack' && entity) {
      // A frame can consume several simulation steps. Do not resurrect an old
      // attack that has already been cancelled or replaced.
      if (Number.isFinite(event.time) && Math.abs(entity.stateStarted - event.time) > EPSILON) return;
      const token = { entity, state: entity.state, started: entity.stateStarted };
      this._attacks.set(entity, token);
      if (!this._validCue(token, world)) return;
      const type = entity.type;
      const variant = event.attackVariant ?? entity._attackMotion;
      let keys = entity === world.player ? ['player_swing'] : [`${type}_attack`];
      if (['pigman', 'pigguard', 'merm', 'mermguard'].includes(type)) keys.push('punch_whoosh');
      if (type === 'bunnyman') keys.push('bunnyman_bite');
      if (['spider_warrior', 'spider_hider', 'spider_dropper'].includes(type)) keys = variant === 'spider' ?
        [`${type}_pounce`, `${type}_jump`, `${type}_pounce_swipe`] : [`${type}_attack`, `${type}_swipe`];
      if (type === 'bat') keys.push('bat_flap');
      if (type === 'frog') keys.push('frog_spit');
      if (type === 'catcoon') keys = variant === 'cat' ? ['catcoon_pounce', 'catcoon_jump'] : ['catcoon_attack', 'catcoon_swipe'];
      if (type === 'krampus') keys.push('krampus_swipe');
      if (type === 'lightninggoat' && entity.charged) keys.push('lightninggoat_horn');
      if (type === 'deerclops') keys.push('deerclops_swipe');
      if (type === 'werepig') keys.push('werepig_swing');
      const at = Number.isFinite(event.time) ? event.time : world.time;
      for (const key of keys) this._queueCues(token, key, at, entity === world.player ? .8 : .65);
    } else if ((event.type === 'dashstart' || event.type === 'dash') && entity) {
      const expected = event.type === 'dashstart' ? 'dash_pre' : 'dash_recover';
      if (entity.state !== expected || (Number.isFinite(event.time) && Math.abs(entity.stateStarted - event.time) > EPSILON)) return;
      const token = this._stateToken(entity);
      const at = Number.isFinite(event.time) ? event.time : world.time;
      if (event.type === 'dashstart') this._queueCues(token, 'player_dash_prepare', at, .7);
      else {
        this._queueCues(token, 'player_swing', at, .7);
        // Native charged spear replaces the ordinary lunge event with thunder;
        // it does not play both events on top of each other.
        const charged = event.charged || world.weapon?.charged || world.weapon?.id?.endsWith('_charged');
        this._queueCues(token, charged ? 'player_dash_thunder' : 'player_dash', at, .8);
      }
    } else if (['attackcancel', 'dashcancel', 'dashend'].includes(event.type) && entity) {
      this._attacks.delete(entity);
      this.pending = this.pending.filter(cue => cue.token.entity !== entity);
    } else if (event.type === 'hit') {
      if (entity === world.player) this.play('player_hurt', .7);
      else if (entity) {
        const key = `${entity.type}_hurt`;
        const frames = cueFrames(this.manifest.events[key]?.triggerFrames);
        const token = { entity, state: entity.state, started: entity.stateStarted, kind: 'reaction' };
        for (const frame of frames) {
          if (frame === 0) this.play(key, .55, () => world.entities.includes(entity));
          else this._queueCues(token, key, event.time ?? world.time, .55, frame);
        }
        if (source === world.player) {
          const impact = entity.type === 'leif' ? 'player_hit_wood' :
            ['spider', 'spider_warrior', 'spider_hider', 'spider_dropper', 'killerbee', 'bee', 'mosquito'].includes(entity.type) ? 'player_hit_insect' : entity.type === 'knight' ? 'player_hit_metal' : 'player_hit';
          this.play(impact, .65);
        }
      }
      if (entity && event.electric) this.play('player_electric_hit', .6, () => world.entities.includes(entity));
    } else if (event.type === 'death' && entity) {
      this._attacks.delete(entity);
      this.pending = this.pending.filter(cue => cue.token.entity !== entity);
      // Overfed mosquitoes have an explosion at frame 11, not the ordinary
      // killed-by-weapon death voice. The simulation emits that burst exactly.
      if (entity.type === 'mosquito' && event.cause === 'overfed') return;
      const key = entity === world.player ? 'player_death' : `${entity.type}_death`;
      const token = this._stateToken(entity); token.allowDead = true;
      for (const frame of cueFrames(this.manifest.events[key]?.triggerFrames)) {
        if (frame === 0) this.play(key, .8, () => world.entities.includes(entity));
        else this._queueCues(token, key, event.time ?? world.time, .8, frame);
      }
    } else if ((event.type === 'taunt' || event.type === 'howl') && entity) {
      if (entity.state !== event.type || (Number.isFinite(event.time) && Math.abs(entity.stateStarted - event.time) > EPSILON)) return;
      const keys = entity.type === 'hound' ? ['hound_bark'] : entity.type === 'knight' ? ['knight_taunt', 'knight_paw'] :
        entity.type === 'deerclops' ? ['deerclops_taunt', 'deerclops_howl'] :
        entity.type === 'werepig' && event.type === 'howl' ? ['werepig_howl'] :
        this.manifest.events[`${entity.type}_taunt`] ? [`${entity.type}_taunt`] : [`${entity.type}_idle`];
      const token = this._stateToken(entity);
      for (const key of keys) this._queueCues(token, key, entity.stateStarted, .6);
    }
  }
}
