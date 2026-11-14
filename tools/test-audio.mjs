import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../dist/audio.js', import.meta.url), 'utf8');
const { GameAudio } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const manifest = JSON.parse(await fs.readFile(new URL('../dist/assets/audio/manifest.json', import.meta.url), 'utf8'));
const { CombatWorld } = await import('../dist/combat.js');

class FakeParam {
  constructor() { this.value = 0; this.operations = []; }
  cancelScheduledValues(time) { this.operations.push(['cancel', time]); }
  setValueAtTime(value, time) { this.value = value; this.operations.push(['value', value, time]); }
  setTargetAtTime(value, time, constant) { this.value = value; this.operations.push(['target', value, time, constant]); }
  linearRampToValueAtTime(value, time) { this.operations.push(['ramp', value, time]); }
}
class FakeNode {
  connect(destination) { this.destination = destination; }
  disconnect() { this.disconnected = true; }
}
class FakeContext {
  constructor() { this.currentTime = 0; this.destination = {}; this.sources = []; this.state = 'running'; }
  createGain() { return Object.assign(new FakeNode(), { gain: new FakeParam() }); }
  createBufferSource() {
    const context = this;
    const node = Object.assign(new FakeNode(), {
      startAt: Infinity, stopAt: Infinity,
      start(at = context.currentTime) { this.startAt = at; },
      stop(at = context.currentTime) { this.stopAt = at; },
      end() { this.onended?.(); },
    });
    this.sources.push(node);
    return node;
  }
  advance(time) {
    this.currentTime = time;
    for (const source of this.sources) if (source.stopAt <= time) source.end();
  }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  resume() { this.state = 'running'; return Promise.resolve(); }
  decodeAudioData(buffer) { return Promise.resolve({ id: buffer }); }
}

function setup() {
  const audio = new GameAudio();
  audio.manifest = manifest;
  audio.ctx = new FakeContext();
  audio.master = audio.ctx.createGain();
  audio.unlocked = true;
  audio.buffer = async id => ({ id });
  return audio;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function actor(type = 'hound', started = 0) {
  return { id: type + '-1', type, state: 'attack', stateStarted: started, attackActive: true, dead: false };
}
function worldWith(entity) {
  const player = actor('player'); player.id = 'player';
  return { entities: [player, entity], player, time: 0, paused: false };
}
const started = audio => audio.ctx.sources.filter(s => s.startAt !== Infinity);
const tests = [];
const test = (name, run) => tests.push([name, run]);

test('Manifest scalar and array frame cues are both timed correctly', async () => {
  for (const [type, frames] of [['hound', [14]], ['tentacle', [2, 15]], ['spider', [10]], ['leif', [5]], ['killerbee', [10]], ['knight', [14]]]) {
    const audio = setup(), entity = actor(type), world = worldWith(entity);
    audio.event({ type: 'attack', id: entity.id, time: 0 }, world);
    assert.equal(audio.pending.length, frames.length);
    for (let i = 0; i < frames.length; i++) {
      world.time = frames[i] / 30 - .0001;
      audio.ctx.currentTime = world.time;
      audio.update(world); await settle();
      assert.equal(started(audio).length, i);
      world.time = frames[i] / 30;
      audio.ctx.currentTime = world.time;
      audio.update(world); await settle();
      assert.equal(started(audio).length, i + 1);
    }
  }
});

test('Frame zero player swing is queued immediately without replacing it by a default', async () => {
  const audio = setup(), world = worldWith(actor());
  audio.event({ type: 'attack', id: 'player', time: 0 }, world);
  audio.update(world); await settle();
  assert.equal(started(audio).length, 1);
  assert(manifest.events.player_swing.files.includes(started(audio)[0].buffer.id));
});

test('Hound taunt uses two bark cues, not an immediate pant sample', async () => {
  const audio = setup(), entity = actor(), world = worldWith(entity);
  entity.state = 'taunt'; entity.attackActive = false;
  audio.event({ type: 'taunt', id: entity.id, time: 0 }, world);
  assert.equal(audio.pending.length, 2);
  world.time = 13 / 30; audio.ctx.currentTime = world.time;
  audio.update(world); await settle();
  assert.equal(started(audio).length, 1);
  assert(manifest.events.hound_bark.files.includes(started(audio)[0].buffer.id));
  entity.state = 'move'; entity.stateStarted = .5;
  world.time = 24 / 30; audio.ctx.currentTime = world.time;
  audio.update(world); await settle();
  assert.equal(started(audio).length, 1);
  assert.equal(audio.pending.length, 0);
});

test('Interruption before the cue removes it; a later new attack cannot revive it', async () => {
  const audio = setup(), entity = actor('spider'), world = worldWith(entity);
  audio.event({ type: 'attack', id: entity.id, time: 0 }, world);
  entity.state = 'hit'; entity.attackActive = false; entity.stateStarted = .1;
  world.time = .1; audio.update(world);
  assert.equal(audio.pending.length, 0);
  entity.state = 'attack'; entity.attackActive = true; entity.stateStarted = .2;
  world.time = .4; audio.update(world); await settle();
  assert.equal(started(audio).length, 0);
});

test('Async decoding cannot play a cue after its attack was cancelled or reset', async () => {
  for (const reset of [false, true]) {
    const audio = setup(), entity = actor(), world = worldWith(entity), gate = deferred();
    audio.buffer = () => gate.promise;
    audio.event({ type: 'attack', id: entity.id, time: 0 }, world);
    world.time = 14 / 30; audio.ctx.currentTime = world.time;
    audio.update(world);
    if (reset) {
      world.entities = [world.player, actor()];
      audio.event({ type: 'reset' }, world);
    } else {
      entity.state = 'hit'; entity.stateStarted = world.time; entity.attackActive = false;
    }
    gate.resolve({}); await settle();
    assert.equal(started(audio).length, 0);
    assert.equal(audio._loadingSounds.size, 0);
  }
});

test('Queued events use the simulation event time, not delayed render consumption', async () => {
  const audio = setup(), entity = actor('spider'), world = worldWith(entity);
  world.time = .2;
  audio.event({ type: 'attack', id: entity.id, time: 0 }, world);
  assert.equal(audio.pending[0].at, 10 / 30);
  entity.stateStarted = .1;
  audio.event({ type: 'attack', id: entity.id, time: 0 }, world);
  assert.equal(audio.pending.length, 1); // The stale event did not add a cue.
  world.time = .5; audio.update(world); await settle();
  assert.equal(started(audio).length, 0);
});

test('Pause invalidates loading sound effects even when resumed before decode completes', async () => {
  const audio = setup(), gate = deferred();
  audio.buffer = () => gate.promise;
  const playing = audio.play('player_hit');
  await audio.pause();
  audio.suspended = false;
  gate.resolve({});
  assert.equal(await playing, false);
  assert.equal(started(audio).length, 0);
});

test('Pending music reservations are cleared on pause and recreated successfully', async () => {
  const audio = setup(), gate = deferred();
  audio.buffer = () => gate.promise;
  audio.setMode('combat');
  assert.equal(audio.tracks.size, 2);
  await audio.pause();
  assert.equal(audio.tracks.size, 0);
  await audio.resume();
  const newRecord = audio.tracks.get('combat');
  assert(newRecord?.pending);
  gate.resolve({}); await settle();
  assert.equal(audio.tracks.get('combat'), newRecord);
  assert.equal(newRecord.pending, false);
  assert.equal(started(audio).length, 2); // One environment loop, one music loop.
});

test('Rapid mode changes do not overlap music or revive obsolete async decodes', async () => {
  const audio = setup();
  audio.setMode('ambient'); await settle();
  const oldCalm = audio.tracks.get('calm').source;
  audio.ctx.advance(1);
  audio.setMode('combat'); await settle();
  const combat = audio.tracks.get('combat').source;
  assert.equal(oldCalm.stopAt, combat.startAt);
  audio.setMode('boss'); await settle();
  assert(combat.stopAt <= combat.startAt);
  assert.deepEqual([...audio.tracks.keys()].sort(), ['ambient', 'boss']);
  const music = started(audio).filter(s => s.buffer.id !== manifest.events.ambient.files[0]);
  for (const time of [0, .5, 1, 1.06, 1.12, 1.5, 2]) {
    assert(music.filter(s => s.startAt <= time && time < s.stopAt).length <= 1, `overlap at ${time}`);
  }
  const pendingAudio = setup(), gates = new Map();
  pendingAudio.buffer = path => { if (!gates.has(path)) gates.set(path, deferred()); return gates.get(path).promise; };
  pendingAudio.setMode('ambient');
  pendingAudio.setMode('combat');
  pendingAudio.setMode('boss');
  for (const [path, gate] of gates) gate.resolve({ id: path });
  await settle();
  assert.deepEqual(started(pendingAudio).map(s => s.buffer.id).sort(), [manifest.events.ambient.files[0], manifest.events.boss.files[0]].sort());
});

test('Repeat mode sync never duplicates loops and paused playing music is retained', async () => {
  const audio = setup();
  for (let i = 0; i < 10; i++) audio.setMode('combat');
  await settle();
  assert.equal(started(audio).length, 2);
  const combat = audio.tracks.get('combat');
  await audio.pause(); await audio.resume(); await settle();
  assert.equal(audio.tracks.get('combat'), combat);
  assert.equal(started(audio).length, 2);
});

test('A stale failed music decode cannot delete a newer reservation', async () => {
  const audio = setup(), old = deferred(), next = deferred();
  let calls = 0;
  audio.buffer = () => (++calls === 1 ? old.promise : next.promise);
  const first = audio.track('combat', 1);
  await audio.pause(); audio.suspended = false;
  const second = audio.track('combat', 1);
  const replacement = audio.tracks.get('combat');
  const warn = console.warn; console.warn = () => {};
  try { old.reject(new Error('old decode')); await first; } finally { console.warn = warn; }
  assert.equal(audio.tracks.get('combat'), replacement);
  next.resolve({}); await second;
  assert.equal(replacement.pending, false);
});

test('One-shot cooldown is enforced at actual start and pending loads count against cap', async () => {
  const audio = setup(), gate = deferred();
  audio.buffer = () => gate.promise;
  const first = audio.play('player_hit');
  audio.ctx.currentTime = .1;
  const second = audio.play('player_hit');
  gate.resolve({}); await Promise.all([first, second]);
  assert.equal(started(audio).length, 1);
  assert.equal(audio.activeSounds, 1);
  const capped = setup(), capGate = deferred();
  capped.manifest = { events: Object.fromEntries(Array.from({ length: 25 }, (_, i) => ['k' + i, { files: ['file' + i] }])) };
  capped.buffer = () => capGate.promise;
  const jobs = Array.from({ length: 25 }, (_, i) => capped.play('k' + i));
  assert.equal(capped._loadingSounds.size, 20);
  capGate.resolve({}); await Promise.all(jobs);
  assert.equal(capped.activeSounds, 20);
  await capped.pause();
  assert.equal(capped.activeSounds, 0);
});

test('Very late or muted async sounds are discarded instead of bursting on load', async () => {
  for (const mute of [false, true]) {
    const audio = setup(), gate = deferred(); audio.buffer = () => gate.promise;
    const playing = audio.play('player_hit');
    if (mute) audio.muted = true; else audio.ctx.currentTime = 1;
    gate.resolve({});
    assert.equal(await playing, false);
    assert.equal(started(audio).length, 0);
  }
});

test('Pause during pending unlock wins over the stale resume completion', async () => {
  const audio = setup(), gate = deferred();
  audio.unlocked = false;
  audio.ctx.resume = () => gate.promise;
  const unlocking = audio.unlock();
  await audio.pause(); gate.resolve();
  assert.equal(await unlocking, false);
  assert.equal(audio.suspended, true);
  assert.equal(audio.tracks.size, 0);
});

test('Failed buffer fetches can retry and concurrent requests share the same decode', async () => {
  const audio = setup();
  audio.buffer = GameAudio.prototype.buffer;
  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { requests++; if (requests === 1) return { ok: false }; return { ok: true, arrayBuffer: async () => 'decoded' }; };
  try {
    await assert.rejects(audio.buffer('retry.ogg'));
    const [a, b] = await Promise.all([audio.buffer('retry.ogg'), audio.buffer('retry.ogg')]);
    assert.equal(requests, 2);
    assert.equal(a, b);
  } finally { globalThis.fetch = originalFetch; }
});

test('Actual combat events drive tentacle loop cues and cancel stunlocked spider cues', async () => {
  const audio = setup();
  const world = new CombatWorld({ spawns: [{ type: 'tentacle', count: 1, x: 3, z: 0 }] });
  world.consumeEvents();
  let firstAttackTick;
  for (let i = 0; i < 160; i++) {
    world.step(); audio.ctx.currentTime = world.time;
    for (const event of world.consumeEvents()) {
      if (event.type === 'attack' && event.monster === 'tentacle') firstAttackTick ??= event.tick;
      audio.event(event, world);
    }
    audio.update(world); await settle();
  }
  const attacks = started(audio).filter(s => manifest.events.tentacle_attack.files.includes(s.buffer.id));
  assert(Number.isFinite(firstAttackTick), 'Tentacle reaches its real attack loop');
  assert.deepEqual(attacks.slice(0, 2).map(s => Math.round(s.startAt * 30)), [firstAttackTick + 2, firstAttackTick + 15]);
  const spiderAudio = setup();
  const spider = new CombatWorld({ spawns: [{ type: 'spider', count: 1, x: 2, z: 0 }] });
  spider.attackHeld = true; spider.consumeEvents();
  for (let i = 0; i < 40; i++) {
    spider.step(); spiderAudio.ctx.currentTime = spider.time;
    for (const event of spider.consumeEvents()) spiderAudio.event(event, spider);
    spiderAudio.update(spider); await settle();
  }
  assert.equal(started(spiderAudio).filter(s => manifest.events.spider_attack.files.includes(s.buffer.id)).length, 0);
});

test('Werepig attack layers play the swoosh at 10 and voice at 15', async () => {
  const audio = setup(), entity = actor('werepig'), world = worldWith(entity);
  audio.event({ type: 'attack', id: entity.id, time: 0 }, world);
  assert.equal(audio.pending.length, 2);
  for (const frame of [9, 10, 14, 15]) {
    world.time = frame / 30; audio.ctx.currentTime = world.time;
    audio.update(world); await settle();
    assert.equal(started(audio).length, frame < 10 ? 0 : frame < 15 ? 1 : 2);
  }
  assert(manifest.events.werepig_swing.files.includes(started(audio)[0].buffer.id));
  assert(manifest.events.werepig_attack.files.includes(started(audio)[1].buffer.id));
});

test('Werepig howl and knight taunt keep their own delayed state cues', async () => {
  for (const [type, state, times, keys] of [
    ['werepig', 'howl', [20], ['werepig_howl']],
    ['knight', 'taunt', [0, 10, 28], ['knight_taunt', 'knight_paw', 'knight_paw']],
    ['killerbee', 'taunt', [0], ['killerbee_taunt']],
  ]) {
    const audio = setup(), entity = actor(type), world = worldWith(entity);
    entity.state = state; entity.attackActive = false;
    audio.event({ type: state, id: entity.id, time: 0 }, world);
    for (let i = 0; i < times.length; i++) {
      world.time = times[i] / 30; audio.ctx.currentTime = world.time;
      audio.update(world); await settle();
      assert.equal(started(audio).length, i + 1);
      assert(manifest.events[keys[i]].files.includes(started(audio)[i].buffer.id));
    }
  }
});

test('Dash preparation uses the original frame-4 twirl and is cancelled with its state', async () => {
  for (const cancel of [false, true]) {
    const audio = setup(), world = worldWith(actor());
    world.player.state = 'dash_pre'; world.player.attackActive = false;
    audio.event({ type: 'dashstart', id: 'player', time: 0 }, world);
    world.time = 3 / 30; audio.ctx.currentTime = world.time;
    audio.update(world); await settle();
    assert.equal(started(audio).length, 0);
    if (cancel) { world.player.state = 'idle'; world.player.stateStarted = world.time; }
    world.time = 4 / 30; audio.ctx.currentTime = world.time;
    audio.update(world); await settle();
    assert.equal(started(audio).length, cancel ? 0 : 1);
    if (!cancel) assert(manifest.events.player_dash_prepare.files.includes(started(audio)[0].buffer.id));
  }
});

test('Dash execution layers swing with lunge or charged thunder, never both', async () => {
  for (const charged of [false, true]) {
    const audio = setup(), world = worldWith(actor());
    world.player.state = 'dash_recover'; world.player.attackActive = false;
    world.weapon = { id: 'spear_wathgrithr_lightning' };
    audio.event({ type: 'dash', id: 'player', time: 0, charged }, world);
    audio.update(world); await settle();
    const ids = started(audio).map(s => s.buffer.id);
    assert(ids.some(id => manifest.events.player_swing.files.includes(id)));
    assert.equal(ids.some(id => manifest.events.player_dash.files.includes(id)), !charged);
    assert.equal(ids.some(id => manifest.events.player_dash_thunder.files.includes(id)), charged);
    assert.equal(ids.length, 2);
  }
});

test('A dash finishing during async decode cannot produce a late lunge sound', async () => {
  const audio = setup(), world = worldWith(actor()), gate = deferred();
  audio.buffer = () => gate.promise;
  world.player.state = 'dash_recover'; world.player.attackActive = false;
  audio.event({ type: 'dash', id: 'player', time: 0 }, world);
  audio.update(world);
  audio.event({ type: 'dashend', id: 'player', time: .1 }, world);
  gate.resolve({}); await settle();
  assert.equal(started(audio).length, 0);
});

test('Electric hits add the original spark, and metal/insect victims use their own impact layer', async () => {
  for (const [type, impact] of [['knight', 'player_hit_metal'], ['killerbee', 'player_hit_insect'], ['werepig', 'player_hit']]) {
    for (const electric of [false, true]) {
      const audio = setup(), entity = actor(type), world = worldWith(entity);
      audio.event({ type: 'hit', id: entity.id, sourceId: 'player', electric, skill: electric ? 'dash' : undefined }, world);
      await settle();
      const ids = started(audio).map(s => s.buffer.id);
      assert(ids.some(id => manifest.events[impact].files.includes(id)));
      assert.equal(ids.some(id => manifest.events.player_electric_hit.files.includes(id)), electric);
    }
  }
});

test('Tentacle warning is silent; emerge voice waits 20 frames and retract plays disappearance', async () => {
  const audio = setup(), entity = actor('tentacle'), world = worldWith(entity);
  entity.state = 'emerge'; entity.attackActive = false;
  audio.update(world); await settle();
  assert.equal(started(audio).length, 0);
  entity.state = 'attack_pre'; entity.stateStarted = 1; world.time = 1; audio.ctx.currentTime = 1;
  audio.update(world); await settle();
  assert.equal(started(audio).length, 1);
  assert(manifest.events.tentacle_emerge.files.includes(started(audio)[0].buffer.id));
  world.time = 1 + 19 / 30; audio.ctx.currentTime = world.time;
  audio.update(world); await settle(); assert.equal(started(audio).length, 1);
  world.time = 1 + 20 / 30; audio.ctx.currentTime = world.time;
  audio.update(world); await settle(); assert.equal(started(audio).length, 2);
  assert(manifest.events.tentacle_emerge_voice.files.includes(started(audio)[1].buffer.id));
  entity.state = 'retract'; entity.stateStarted = 2; world.time = 2; audio.ctx.currentTime = 2;
  audio.update(world); await settle(); assert.equal(started(audio).length, 3);
  assert(manifest.events.tentacle_disappear.files.includes(started(audio)[2].buffer.id));
});

test('Interrupted tentacle preparation cannot leak its delayed emerge voice into the next attack', async () => {
  const audio = setup(), entity = actor('tentacle'), world = worldWith(entity);
  entity.state = 'attack_pre'; entity.attackActive = false;
  audio.update(world); await settle();
  entity.state = 'hit'; entity.stateStarted = .1; world.time = .1; audio.ctx.currentTime = .1;
  audio.update(world); await settle();
  entity.state = 'attack'; entity.stateStarted = .3; world.time = .7; audio.ctx.currentTime = .7;
  audio.update(world); await settle();
  assert.equal(started(audio).filter(s => manifest.events.tentacle_emerge_voice.files.includes(s.buffer.id)).length, 0);
});

test('Real lightning dash events produce windup, execution and electric impact at their simulation ticks', async () => {
  const audio = setup();
  const world = new CombatWorld({ weapon: 'spear_wathgrithr_lightning', spawns: [{ type: 'leif', count: 1, x: 4, z: 0 }] });
  world.monsters[0].nextBrainAt = Infinity;
  for (let i = 0; i < 90; i++) world.step(); // Native equip discharge must finish.
  world.consumeEvents();
  const startTick = world.ticks;
  assert.equal(world.requestDash(6.5, 0), true);
  let dashTick;
  for (let i = 0; i < 60; i++) {
    world.step(); audio.ctx.currentTime = world.time;
    for (const event of world.consumeEvents()) {
      if (event.type === 'dash') dashTick = event.tick;
      audio.event(event, world);
    }
    audio.update(world); await settle();
  }
  assert(Number.isFinite(dashTick));
  for (const [key, expectedTick] of [['player_dash_prepare', startTick + 4], ['player_dash', dashTick], ['player_electric_hit', dashTick]]) {
    const sounds = started(audio).filter(s => manifest.events[key].files.includes(s.buffer.id));
    assert.equal(sounds.length, 1, key);
    assert.equal(Math.round(sounds[0].startAt * 30), expectedTick, key);
  }
});

test('Real new-monster combat events route their distinct attack sound frames', async () => {
  for (const [type, x, soundFrame] of [['killerbee', .9, 10], ['knight', 2, 14], ['werepig', 2, 15]]) {
    const audio = setup(), world = new CombatWorld({ spawns: [{ type, count: 1, x, z: 0 }] });
    world.consumeEvents();
    let attackTick;
    for (let i = 0; i < 200; i++) {
      world.step(); audio.ctx.currentTime = world.time;
      for (const event of world.consumeEvents()) {
        if (event.type === 'attack' && event.monster === type) attackTick ??= event.tick;
        audio.event(event, world);
      }
      audio.update(world); await settle();
      if (attackTick != null && world.ticks > attackTick + soundFrame) break;
    }
    assert(Number.isFinite(attackTick), type + ' attacked');
    const sounds = started(audio).filter(s => manifest.events[type + '_attack'].files.includes(s.buffer.id));
    assert.equal(sounds.length, 1, type);
    assert.equal(Math.round(sounds[0].startAt * 30), attackTick + soundFrame, type);
  }
});

const additionalMonsters = ['pigman','pigguard','bunnyman','merm','mermguard','beefalo','koalefant_summer','koalefant_winter','spider_warrior','spider_hider','spider_dropper','bat','frog','bee','mosquito','penguin','catcoon','krampus','lightninggoat','slurtle','deerclops'];
const hasSound = (audio, key) => started(audio).some(s => manifest.events[key].files.includes(s.buffer.id));
async function atFrame(audio, world, frame) {
  world.time = frame / 30; audio.ctx.currentTime = world.time;
  audio.update(world); await settle();
}

test('All 21 additional monsters have sourced attack, hurt-policy and death events', async () => {
  for (const type of additionalMonsters) {
    for (const suffix of ['attack', 'hurt', 'death']) {
      const cue = manifest.events[`${type}_${suffix}`];
      assert(cue, type + '_' + suffix);
      if (suffix !== 'hurt') assert(cue.files.length > 0, type + '_' + suffix);
      if (cue.files.length) assert(cue.scriptEvent?.startsWith('dontstarve'));
      else assert(cue.note, `${type} explicitly documents a silent native hurt state`);
      for (const src of cue.files) {
        assert((await fs.stat(new URL('../dist/' + src, import.meta.url))).size > 0);
        const clip = manifest.clips[src.split('/').at(-1)];
        assert(clip.duration > 0 && clip.sampleRate >= 8000, src);
      }
    }
  }
});

test('All 21 additional monster attacks play on their stock voice frames', async () => {
  const frames = [0,0,0,0,0,0,0,0,10,10,10,8,20,10,10,0,5,0,9,9,0];
  for (let i = 0; i < additionalMonsters.length; i++) {
    const type = additionalMonsters[i], frame = frames[i];
    const audio = setup(), entity = actor(type), world = worldWith(entity);
    audio.event({ type: 'attack', id: entity.id, time: 0, attackVariant: 'melee' }, world);
    for (let f = 0; f <= frame; f++) {
      await atFrame(audio, world, f);
      assert.equal(hasSound(audio, `${type}_attack`), f >= frame, `${type} frame ${f}`);
    }
  }
});

test('Interrupted additional attacks discard every later layer', async () => {
  for (const type of additionalMonsters) {
    const audio = setup(), entity = actor(type), world = worldWith(entity);
    audio.event({ type: 'attack', id: entity.id, time: 0 }, world);
    entity.state = 'hit'; entity.stateStarted = 1 / 30; entity.attackActive = false;
    await atFrame(audio, world, 45);
    assert.equal(started(audio).length, 0, type);
    assert.equal(audio.pending.length, 0, type);
  }
});

test('Spider pounces and cat jumps select their own vocal and swoosh timelines', async () => {
  for (const [type, variant, schedule] of [
    ['spider_warrior', 'spider', [[0,'pounce'],[0,'jump'],[9,'pounce_swipe']]],
    ['spider_dropper', 'spider', [[0,'pounce'],[0,'jump'],[9,'pounce_swipe']]],
    ['catcoon', 'cat', [[5,'pounce'],[14,'jump']]],
  ]) {
    const audio = setup(), entity = actor(type), world = worldWith(entity);
    audio.event({ type: 'attack', id: entity.id, attackVariant: variant, time: 0 }, world);
    assert.deepEqual(audio.pending.map(c => [Math.round(c.at * 30), c.key]).sort(), schedule.map(([f,k]) => [f,type+'_'+k]).sort());
    for (let f = 0; f <= 15; f++) await atFrame(audio, world, f);
    for (const [frame, suffix] of schedule) assert(started(audio).some(s => manifest.events[type+'_'+suffix].files.includes(s.buffer.id) && Math.round(s.startAt * 30) === frame), type+'_'+suffix);
  }
});

test('Extra layered attack foley follows stock punch, bite, flap, spit and swipe frames', async () => {
  for (const [type, key, frame] of [
    ['pigman','punch_whoosh',0],['pigguard','punch_whoosh',0],['merm','punch_whoosh',0],['mermguard','punch_whoosh',0],
    ['bunnyman','bunnyman_bite',13],['bat','bat_flap',10],['frog','frog_spit',20],
    ['catcoon','catcoon_swipe',9],['krampus','krampus_swipe',14],['deerclops','deerclops_swipe',34],
  ]) {
    const audio = setup(), entity = actor(type), world = worldWith(entity);
    audio.event({ type: 'attack', id: entity.id, time: 0 }, world);
    for (let f = 0; f <= frame; f++) await atFrame(audio, world, f);
    assert(started(audio).some(s => manifest.events[key].files.includes(s.buffer.id) && Math.round(s.startAt * 30) === frame), key);
  }
});

test('Shield entry and exit cues are state-bound and shield hits do not replay hide', async () => {
  for (const type of ['slurtle', 'spider_hider']) {
    const audio = setup(), entity = actor(type), world = worldWith(entity);
    entity.state = 'shield'; entity.animation = 'hide'; entity.attackActive = false;
    const frame = type === 'slurtle' ? 1 : 2;
    await atFrame(audio, world, 0); assert.equal(started(audio).length, 0);
    await atFrame(audio, world, frame); assert.equal(started(audio).length, type === 'slurtle' ? 1 : 2);
    entity.animation = 'hit_shield'; entity.stateStarted = 1;
    await atFrame(audio, world, 32); assert.equal(audio.pending.length, 0);
    const count = started(audio).length;
    entity.state = 'shield_end'; entity.stateStarted = 2; entity.animation = type === 'slurtle' ? 'emerge' : 'unhide';
    await atFrame(audio, world, 60); await atFrame(audio, world, 61);
    assert.equal(started(audio).length, count + (type === 'slurtle' ? 1 : 0));
  }
});

test('Goat charge uses three entry layers, with horn only on charged attacks', async () => {
  for (const charged of [false, true]) {
    const audio = setup(), entity = actor('lightninggoat'), world = worldWith(entity);
    entity.charged = charged;
    audio.event({ type: 'attack', id: entity.id, time: 0 }, world);
    for (let f = 0; f <= 9; f++) await atFrame(audio, world, f);
    assert.equal(hasSound(audio, 'lightninggoat_horn'), charged);
  }
  const audio = setup(), entity = actor('lightninggoat'), world = worldWith(entity);
  entity.state = 'shocked'; entity.attackActive = false;
  audio.event({ type: 'charged', id: entity.id, time: 0 }, world);
  await atFrame(audio, world, 0);
  for (const key of ['lightninggoat_charged','lightninggoat_charge_voice','lightninggoat_horn']) assert(hasSound(audio,key),key);
});

test('Mosquito overfeeding plays the burst event rather than an early ordinary death', async () => {
  const audio = setup(), entity = actor('mosquito'), world = worldWith(entity);
  entity.state = 'dead'; entity.dead = true; entity.animation = 'explode';
  audio.event({ type: 'death', id: entity.id, cause: 'overfed', time: 0 }, world);
  await atFrame(audio, world, 10); assert.equal(started(audio).length, 0);
  world.time = 11/30; audio.ctx.currentTime = world.time;
  audio.event({ type: 'burst', id: entity.id, time: world.time }, world); await settle();
  assert.equal(started(audio).length, 1); assert(hasSound(audio,'mosquito_burst'));
});

test('Frame-one death cues survive death, but not removal or reset', async () => {
  for (const type of ['bat','catcoon','slurtle']) for (const remove of [false,true]) {
    const audio = setup(), entity = actor(type), world = worldWith(entity);
    entity.dead = true; entity.state = 'dead';
    audio.event({ type: 'death', id: entity.id, time: 0 }, world);
    await atFrame(audio, world, 0); assert.equal(started(audio).length, 0);
    if (remove) world.entities = [world.player];
    await atFrame(audio, world, 1);
    assert.equal(hasSound(audio,type+'_death'), !remove, type);
  }
});

test('All marked ice spikes sound independently and survive owner attack interruption', async () => {
  const audio = setup(), entity = actor('deerclops'), world = worldWith(entity);
  world.hazards = Array.from({length:6},(_,i)=>({id:'ice-'+i}));
  entity.state = 'hit';
  audio.event({ type:'icespike',id:entity.id,hazardId:'ice-0',sound:false },world); await settle();
  assert.equal(started(audio).length,0);
  for (const hazard of world.hazards) audio.event({ type:'icespike',id:entity.id,hazardId:hazard.id,sound:true },world);
  await settle(); assert.equal(started(audio).length,6);
  assert(started(audio).every(s=>manifest.events.deerclops_ice.files.includes(s.buffer.id)));
  const delayed=setup(),gate=deferred();delayed.buffer=()=>gate.promise;
  delayed.event({type:'icespike',id:entity.id,hazardId:'ice-0',sound:true},world);
  world.hazards=[];gate.resolve({});await settle();assert.equal(started(delayed).length,0);
});

test('Freeze, thaw loop, pause/resume and ice break follow the player state', async () => {
  const audio = setup(), world = worldWith(actor());
  world.player.state='frozen';world.player.attackActive=false;
  audio.event({type:'freeze',id:'player'},world);await settle();assert(hasSound(audio,'freeze'));
  world.player.state='thaw';world.player.stateStarted=1;await atFrame(audio,world,30);
  const first=started(audio).find(s=>s.loop);assert(first);assert(manifest.events.thaw.files.includes(first.buffer.id));
  await audio.pause();assert.equal(first.stopAt,1);
  audio.suspended=false;audio.update(world);await settle();
  const loops=started(audio).filter(s=>s.loop);assert.equal(loops.length,2);
  world.player.state='hit';world.player.stateStarted=2;
  world.time=2;audio.ctx.currentTime=2;
  audio.event({type:'unfreeze',id:'player',reason:'damage'},world);
  await atFrame(audio,world,60);assert.equal(loops[1].stopAt,2);assert(hasSound(audio,'breakfreeze'));
});

test('Inventory swaps make one equip cue; slot take/place use click while damage/add stay silent', async () => {
  const audio = setup(), world=worldWith(actor());
  audio.event({type:'unequip',id:'player',itemId:'a'},world);
  audio.event({type:'equip',id:'player',itemId:'b'},world);
  audio.event({type:'inventorychange',reason:'equip'},world);await settle();
  assert.equal(started(audio).length,1);assert(hasSound(audio,'inventory_equip'));
  for (const reason of ['damage','add','pickup','drop','stolen']) audio.event({type:'inventorychange',reason},world);
  await settle();assert.equal(started(audio).length,1);
  for (const [i,reason] of ['slot','return'].entries()) {
    audio.ctx.currentTime=1+i;audio.event({type:'inventorychange',reason},world);await settle();
    assert.equal(started(audio).length,2+i);assert(hasSound(audio,'inventory_click'));
  }
});

test('Actual Deerclops simulation drives ice audio and its existing epic music cue', async () => {
  const audio=setup(),world=new CombatWorld({spawns:[{type:'deerclops',count:1,x:6,z:0}]});
  world.consumeEvents();let count=0;
  for(let i=0;i<50;i++) {
    world.step();audio.ctx.currentTime=world.time;
    for(const event of world.consumeEvents()) {if(event.type==='icespike'&&event.sound)count++;audio.event(event,world);}
    audio.update(world);await settle();
  }
  assert(count>0);assert.equal(started(audio).filter(s=>manifest.events.deerclops_ice.files.includes(s.buffer.id)).length,count);
  audio.setMode('boss');await settle();assert.equal(audio.tracks.get('boss').source.buffer.id,manifest.events.boss.files[0]);
  assert.equal(manifest.events.boss.scriptEvent,'dontstarve/music/music_epicfight');
});

test('Ground pickup and drop use stock material cues including the infinite grass item', async () => {
  for (const type of ['cutgrass','grass','spear','cane','unknown']) {
    const audio=setup(),world=worldWith(actor());world.inventory={slots:[{id:'item-1',type}]};
    audio.event({type:'pickup',itemId:'item-1',slot:0},world);await settle();
    assert(hasSound(audio,['cutgrass','grass'].includes(type)?'inventory_pickup_grass':'inventory_pickup'),type);
    audio.ctx.currentTime=1;audio.event({type:'itemdrop',itemType:type,reason:'stolen'},world);await settle();
    assert(hasSound(audio,'inventory_drop'),type);
  }
});

test('New source selections use exact compressed samples, with correct shared banks', async () => {
  const evidence=JSON.parse(await fs.readFile(new URL('../research/native-audio-selection.json',import.meta.url),'utf8'));
  for(const [path,entry] of Object.entries(evidence)) {
    assert.equal(entry.mapping,'compressed-prefix-exact',path);
    assert(entry.samples.length>0,path);
  }
  for(const [key,bank] of [['spider_warrior_hurt','sfx.fsb'],['catcoon_swipe','stuff.fsb'],['lightninggoat_attack','stuff.fsb'],['inventory_click','sfx.fsb'],['inventory_pickup_grass','aqol.fsb']]) {
    assert(manifest.events[key].files.every(src=>manifest.clips[src.split('/').at(-1)].bank===bank),key);
  }
});

let failures = 0;
for (const [name, run] of tests) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); }
}
console.log(`${tests.length - failures}/${tests.length} audio checks passed`);
if (failures) process.exitCode = 1;
