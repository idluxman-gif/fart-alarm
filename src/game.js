// FART ALARM — game.js (Phase 3b: Full Floor Sequence + Fart SFX)
// Canvas 390x844 | BPM rhythm | Passengers | Floor transitions with doors | Fart sounds

(function () {
  'use strict';

  // ─── Canvas Setup (high-DPI aware) ──────────────────────────────
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = 390;
  const H = 844;
  const DPR = window.devicePixelRatio || 1;

  canvas.width = W * DPR;
  canvas.height = H * DPR;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.scale(DPR, DPR);

  // ─── Audio System ──────────────────────────────────────────────
  let audioCtx = null;
  let musicBuffer = null;
  let musicSource = null;
  let musicPlaying = false;
  let musicLoaded = false;
  let needsUserGesture = true;

  const sfxBuffers = {};

  function loadMusic() {
    return fetch('Assets/audio/smooth-jazz-loop.mp3')
      .then(r => r.arrayBuffer())
      .then(buf => {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx.decodeAudioData(buf);
      })
      .then(decoded => { musicBuffer = decoded; musicLoaded = true; })
      .catch(e => console.warn('Music load failed:', e));
  }

  function loadSfx(name, url) {
    return fetch(url)
      .then(r => r.arrayBuffer())
      .then(buf => audioCtx ? audioCtx.decodeAudioData(buf) : null)
      .then(decoded => { if (decoded) sfxBuffers[name] = decoded; })
      .catch(() => {});
  }

  function loadAllAudio() {
    return loadMusic().then(() => Promise.all([
      loadSfx('fart-sm', 'Assets/audio/fart-sm.mp3'),
      loadSfx('fart-md', 'Assets/audio/fart-md.mp3'),
      loadSfx('fart-lg', 'Assets/audio/fart-lg.mp3'),
      loadSfx('fart-gameover', 'Assets/audio/fart relief.mp3'),
    ]));
  }

  function playSfx(name) {
    if (!audioCtx || !sfxBuffers[name]) return;
    const src = audioCtx.createBufferSource();
    src.buffer = sfxBuffers[name];
    src.connect(audioCtx.destination);
    src.start(0);
  }

  // Elevator ding — synthesized two-tone chime
  function playDing() {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const now = audioCtx.currentTime;

    // First tone (higher)
    const osc1 = audioCtx.createOscillator();
    const gain1 = audioCtx.createGain();
    osc1.type = 'sine';
    osc1.frequency.value = 830; // A5-ish
    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    osc1.connect(gain1).connect(audioCtx.destination);
    osc1.start(now);
    osc1.stop(now + 0.6);

    // Second tone (lower, slightly delayed)
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'sine';
    osc2.frequency.value = 660; // E5-ish
    gain2.gain.setValueAtTime(0, now);
    gain2.gain.setValueAtTime(0.25, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    osc2.connect(gain2).connect(audioCtx.destination);
    osc2.start(now + 0.15);
    osc2.stop(now + 0.8);
  }

  function startMusic() {
    if (!musicLoaded || !audioCtx) return;
    const doStart = () => {
      stopMusic();
      musicSource = audioCtx.createBufferSource();
      musicSource.buffer = musicBuffer;
      musicSource.loop = true;
      musicSource.connect(audioCtx.destination);
      musicSource.start(0);
      musicPlaying = true;
      needsUserGesture = false;
    };
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().then(doStart);
    } else {
      doStart();
    }
  }

  function stopMusic() {
    if (musicSource) { try { musicSource.stop(); } catch (e) {} musicSource = null; }
    musicPlaying = false;
  }

  // ─── World Config ───────────────────────────────────────────────
  const CONFIG = {
    bpm: 85,
    get beatInterval() { return 60000 / this.bpm; },
    bubbleTravelTime: 1800,
    beatOffsetMs: -155,          // shift bubbles back 705ms from 550 to try next quarter
    tapZoneY: H * 0.65,
    bubbleSpawnY: -60,
    bubbleSize: 70,
    tapZoneSize: 90,
    countdownBeats: 3,

    perfectWindow: 30,
    goodWindow: 80,

    meterPerfect: -0.10,         // PERFECT reduces meter by 1 segment
    meterGood: 0,
    meterMiss: 0.10,             // FIX #2: exactly 10% per miss (10 segments)

    meterBaseRate: 0,
    meterPerPassenger: 0.008,
    meterComboDecay: -0.015,

    comboPopupDuration: 600,

    // FIX #3: 30-second floors. At 85 BPM, 30s = ~42 beats
    beatsPerFloor: 42,
    totalFloors: 15,

    // FIX #4: Extended floor transition for full door sequence
    // Phases: ding (500ms) → doors open (800ms) → passenger slide (800ms) → doors close (800ms) → countdown (3 beats)
    floorDingDuration: 500,
    floorDoorsOpenDuration: 800,
    floorPassengerSlideDuration: 1200,   // ~4 walking steps at 250ms each
    floorDoorsCloseDuration: 800,

    passengerHeight: H * 0.32,    // same height as Gino

    // FIX #6: Fart sound thresholds (segment-based)
    fartThresholds: [
      { level: 0.30, sfx: 'fart-sm' },
      { level: 0.50, sfx: 'fart-md' },
      { level: 0.70, sfx: 'fart-lg' },
      { level: 1.00, sfx: 'fart-gameover' },
    ],
  };

  // ─── Asset Manifest ─────────────────────────────────────────────
  const ASSETS = {
    elevatorBase: 'Assets/Backgrounds/elevator-interior-base3.jpg',
    elevatorOpen: 'Assets/Backgrounds/elevator-interior-base3-open.jpg',
    ginoIdle: 'Assets/characters/gino-idle.png',
    fartMeterEmpty: 'Assets/ui/fart-meter-empty.png',
    fartMeterFillGreen: 'Assets/ui/fart-meter-fill-green.png',
    tapGhostBubble: 'Assets/ui/tap-ghost-bubble.png',
    tapZoneRing: 'Assets/ui/tap-zone-ring.png',
    comboPopupPerfect: 'Assets/ui/combo-popup-perfect.png',
    comboPopupGood: 'Assets/ui/combo-popup-good.png',
    comboPopupMiss: 'Assets/ui/combo-popup-miss.png',
    // Passenger sprites — 6 types × 4 states
    paxBusinessmanIdle: 'Assets/characters/pax-businessman-idle.png',
    paxBusinessmanSuspicious: 'Assets/characters/pax-businessman-suspicious.png',
    paxBusinessmanReacting: 'Assets/characters/pax-businessman-reacting.png',
    paxBusinessmanGameover: 'Assets/characters/pax-businessman-gameover.png',
    paxBusinessmanWalking: 'Assets/characters/pax-businessman-walking.png',
    paxBusinessmanWalking2: 'Assets/characters/pax-businessman-walking2.png',

    paxInternIdle: 'Assets/characters/pax-intern-idle.png',
    paxInternSuspicious: 'Assets/characters/pax-intern-suspicious.png',
    paxInternReacting: 'Assets/characters/pax-intern-reacting.png',
    paxInternGameover: 'Assets/characters/pax-intern-gameover.png',

    paxPhonegazerIdle: 'Assets/characters/pax-phonegazer-idle.jpg',
    paxPhonegazerSuspicious: 'Assets/characters/pax-phonegazer-suspicious.jpg',
    paxPhonegazerReacting: 'Assets/characters/pax-phonegazer-reacting.png',
    paxPhonegazerGameover: 'Assets/characters/pax-phonegazer-gameover.png',

    paxCoffeewomanIdle: 'Assets/characters/pax-coffeewoman-idle.png',
    paxCoffeewomanSuspicious: 'Assets/characters/pax-coffeewoman-suspicious.png',
    paxCoffeewomanReacting: 'Assets/characters/pax-coffeewoman-reacting.png',
    paxCoffeewomanGameover: 'Assets/characters/pax-coffeewoman-gameover.png',

    paxSecurityguardIdle: 'Assets/characters/pax-securityguard-idle.png',
    paxSecurityguardSuspicious: 'Assets/characters/pax-securityguard-suspicious.png',
    paxSecurityguardReacting: 'Assets/characters/pax-securityguard-reacting.png',
    paxSecurityguardGameover: 'Assets/characters/pax-securityguard-gameover.png',

    paxLawyerIdle: 'Assets/characters/pax-lawyer-idle.png',
    paxLawyerSuspicious: 'Assets/characters/pax-lawyer-suspicious.png',
    paxLawyerReacting: 'Assets/characters/pax-lawyer-reacting.png',
    paxLawyerGameover: 'Assets/characters/pax-lawyer-gameover.png',
    // Gino fart reactions (meter thresholds)
    ginoFart1: 'Assets/characters/gino-fart1.png',
    ginoFart2: 'Assets/characters/gino-fart2.png',
    ginoFart3: 'Assets/characters/gino-fart3-2.png',
    ginoFart4: 'Assets/characters/gino-fart4.png',
    // Fart fume clouds
    fartCloudSmall: 'Assets/characters/f1-small.png',
    gasCloud: 'Assets/characters/gas.png',
    fartCloud2: 'Assets/characters/f2.png',
    fartCloud3: 'Assets/characters/f3.png',
    fartCloud4: 'Assets/characters/f4.png',
    // Floor LED images
    floorEmpty: 'Assets/Backgrounds/floor-empty.png',
    floor0: 'Assets/Backgrounds/floor0.png',
    floor1: 'Assets/Backgrounds/floor1.png',
    floor2: 'Assets/Backgrounds/floor2.png',
    floor3: 'Assets/Backgrounds/floor3.png',
    floor4: 'Assets/Backgrounds/floor4.png',
    floor5: 'Assets/Backgrounds/floor5.png',
    floor6: 'Assets/Backgrounds/floor6.png',
    floor7: 'Assets/Backgrounds/floor7.png',
    floor8: 'Assets/Backgrounds/floor8.png',
    floor9: 'Assets/Backgrounds/floor9.png',
  };

  const images = {};

  function loadImage(key, src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { images[key] = img; resolve(img); };
      img.onerror = () => reject(new Error(`Failed to load: ${src}`));
      img.src = src;
    });
  }

  function loadAllAssets() {
    return Promise.all(Object.entries(ASSETS).map(([k, s]) => loadImage(k, s)));
  }

  // ─── Game State ─────────────────────────────────────────────────
  const state = {
    running: false, lastTime: 0,

    nextBeatTime: 0, bubbles: [], beatCount: 0,

    // FIX #2: meter as integer segments 0–10, stored as 0.0–1.0 in steps of 0.1
    meter: 0,

    combo: 0, bestCombo: 0, activePopup: null,
    score: 0, perfects: 0, goods: 0, misses: 0,
    floorPerfects: 0, floorGoods: 0, floorMisses: 0,

    // FIX #3: Floor 0 = starting floor with no passengers
    currentFloor: 0,

    // FIX #4: Multi-phase floor transition
    // 'riding' | 'ding' | 'doors-open' | 'pax-slide' | 'doors-close' | 'countdown'
    floorPhase: 'riding',
    floorTransitionStart: 0,
    rhythmPaused: false,

    passengers: [],

    // Countdown
    countdownPhase: true,
    countdownStartTime: 0,

    // FIX #6: Track which fart thresholds have fired this floor
    fartsFiredThisFloor: new Set(),

    gameOver: false,
    gameOverTime: 0,           // timestamp when game over started (for fume animation)
  };

  // ─── Passenger ──────────────────────────────────────────────────
  // Passenger slot positions (relative to canvas)
  // Front row: same size as Gino, standing beside him
  // Back row: slightly smaller + higher to create depth
  const PAX_SLOTS = [
    { id: 'front-left',  x: 0.08, y: 0.62, scale: 1.0,  zIndex: 1 },
    { id: 'front-right', x: 0.62, y: 0.62, scale: 1.0,  zIndex: 1 },
    { id: 'back-left',   x: 0.06, y: 0.58, scale: 0.82, zIndex: 0 },
    { id: 'back-right',  x: 0.68, y: 0.58, scale: 0.82, zIndex: 0 },
    { id: 'back-center', x: 0.30, y: 0.56, scale: 0.75, zIndex: 0 },
  ];

  function createPassenger(type, slotIndex) {
    return {
      type, slotIndex, state: 'idle',
      slideProgress: 0, slideStartTime: 0,
      boarding: false, exiting: false,
    };
  }

  // ─── Layout ─────────────────────────────────────────────────────
  function getGinoLayout() {
    const img = images.ginoIdle;
    const targetH = H * 0.32;
    const scale = targetH / img.height;
    return { drawW: img.width * scale, drawH: targetH, drawX: (W - img.width * scale) / 2, drawY: H - targetH - 50 };
  }

  function getFartMeterLayout() {
    const emptyImg = images.fartMeterEmpty;
    const targetH = H * 0.52;
    const scale = targetH / emptyImg.height;
    const drawW = emptyImg.width * scale * 1.5;
    return { drawW, drawH: targetH, drawX: W - drawW - 12, drawY: H * 0.06, scale };
  }

  function getPassengerLayout(pax) {
    const drawImg = getPassengerImage(pax);
    const slot = PAX_SLOTS[pax.slotIndex] || PAX_SLOTS[0];
    let targetH = CONFIG.passengerHeight * slot.scale;
    // Gameover sprite is hunched — reduce height slightly so he doesn't look oversized
    // Gameover sprites may have different proportions — reduce slightly
    if (state.gameOver) targetH *= 0.85;
    const scale = targetH / drawImg.height;
    const drawW = drawImg.width * scale;
    const drawH = targetH;

    // Target position from slot
    const targetX = slot.x * W;
    const targetY = H - drawH - (50 * slot.scale);

    // Door start position: center of elevator door, higher up (behind door frame)
    const doorX = W * 0.35;
    const doorY = H * 0.45;

    // Diagonal slide from door to target position
    const drawX = doorX + (targetX - doorX) * pax.slideProgress;
    const drawY = doorY + (targetY - doorY) * pax.slideProgress;

    return { drawW, drawH, drawX, drawY, zIndex: slot.zIndex };
  }

  // Passenger type registry — maps type name to image keys
  const PAX_TYPES = ['businessman', 'intern', 'phonegazer', 'coffeewoman', 'securityguard', 'lawyer'];

  function getPaxImageKey(type, state) {
    // Build key like 'paxBusinessmanIdle' from type 'businessman' and state 'idle'
    const cap = type.charAt(0).toUpperCase() + type.slice(1);
    const stateCap = state.charAt(0).toUpperCase() + state.slice(1);
    return `pax${cap}${stateCap}`;
  }

  function getPassengerImage(pax) {
    const visualState = state.gameOver ? 'gameover'
      : pax.state === 'reacting' ? 'reacting'
      : pax.state === 'suspicious' ? 'suspicious'
      : 'idle';
    const key = getPaxImageKey(pax.type, visualState);
    return images[key] || images.paxBusinessmanIdle;
  }

  function getRandomPaxType() {
    return PAX_TYPES[Math.floor(Math.random() * PAX_TYPES.length)];
  }

  // ─── Bubbles ────────────────────────────────────────────────────
  function spawnBubble(beatTime) {
    const adjusted = beatTime + CONFIG.beatOffsetMs;
    state.bubbles.push({ spawnTime: adjusted - CONFIG.bubbleTravelTime, hitTime: adjusted, hit: false, missed: false });
  }

  function getBubbleY(bubble, now) {
    const progress = (now - bubble.spawnTime) / CONFIG.bubbleTravelTime;
    return CONFIG.bubbleSpawnY + (CONFIG.tapZoneY - CONFIG.bubbleSpawnY) * progress;
  }

  // ─── Tap Handling ───────────────────────────────────────────────
  function handleTap() {
    if (state.gameOver) { restartGame(); startMusic(); state.countdownPhase = true; state.countdownStartTime = performance.now(); state.rhythmPaused = true; return; }
    if (needsUserGesture) { startMusic(); state.countdownPhase = true; state.countdownStartTime = performance.now(); state.rhythmPaused = true; return; }
    if (state.rhythmPaused || state.countdownPhase) return;

    const now = performance.now();
    let closest = null, closestOff = Infinity;
    for (const b of state.bubbles) {
      if (b.hit || b.missed) continue;
      const off = Math.abs(now - b.hitTime);
      if (off < closestOff) { closestOff = off; closest = b; }
    }
    if (!closest || closestOff > CONFIG.goodWindow) return;

    closest.hit = true;
    state.beatCount++;
    registerResult(closestOff <= CONFIG.perfectWindow ? 'perfect' : 'good');
  }

  function registerResult(type) {
    const now = performance.now();
    if (type === 'perfect') {
      // FIX #2: snap meter to segment boundaries
      state.meter = Math.max(0, roundToSegment(state.meter + CONFIG.meterPerfect));
      state.combo++; state.perfects++; state.floorPerfects++;
      state.score += 100 * (1 + Math.floor(state.combo / 5) * 0.1);
      showPopup('perfect', now);
    } else if (type === 'good') {
      state.combo = 0; state.goods++; state.floorGoods++;
      state.score += 50;
      showPopup('good', now);
    } else {
      // FIX #2: each MISS = exactly +10%
      state.meter = Math.min(1, roundToSegment(state.meter + CONFIG.meterMiss));
      state.combo = 0; state.misses++; state.floorMisses++;
      showPopup('miss', now);
    }

    if (state.combo > state.bestCombo) state.bestCombo = state.combo;

    // FIX #6: Check fart thresholds
    checkFartThresholds();

    if (state.meter >= 1.0) {
      state.meter = 1.0;
      state.gameOver = true;
      stopMusic();
    }
  }

  // FIX #2: Round to nearest 0.1 segment
  function roundToSegment(val) {
    return Math.round(val * 10) / 10;
  }

  function showPopup(type, time) { state.activePopup = { type, startTime: time }; }

  // FIX #6: Fart sounds at thresholds, once per floor
  function checkFartThresholds() {
    for (const t of CONFIG.fartThresholds) {
      if (state.meter >= t.level && !state.fartsFiredThisFloor.has(t.level)) {
        state.fartsFiredThisFloor.add(t.level);
        playSfx(t.sfx);
      }
    }
  }

  // ─── Floor Precision & Exit ─────────────────────────────────────
  function getFloorPrecision() {
    const total = state.floorPerfects + state.floorGoods + state.floorMisses;
    if (total === 0) return 100;
    return ((state.floorPerfects * 2 + state.floorGoods) / (total * 2)) * 100;
  }

  // FIX #5: Passengers only board during door sequence, never teleport
  function schedulePassengerBoarding() {
    const nextFloor = state.currentFloor + 1; // floor we're transitioning TO
    const precision = getFloorPrecision();

    // Exits
    let exits = 0;
    if (precision >= 90) exits = 2;
    else if (precision >= 70) exits = 1;

    // Exit passengers with highest slot index first (back row leaves first)
    const activePax = state.passengers.filter(p => !p.exiting).sort((a, b) => b.slotIndex - a.slotIndex);
    for (let i = 0; i < exits && i < activePax.length; i++) {
      activePax[i].exiting = true;
      activePax[i].slideStartTime = performance.now();
    }

    // Board a passenger when transitioning to floor 1+
    const shouldBoard = nextFloor >= 1;
    const extraBoards = precision < 50 ? 1 : 0;
    const activeCount = state.passengers.filter(p => !p.exiting).length;

    if ((shouldBoard || extraBoards > 0) && activeCount < 5) {
      // Find next available slot
      const usedSlots = state.passengers.filter(p => !p.exiting).map(p => p.slotIndex);
      const nextSlot = PAX_SLOTS.findIndex((_, i) => !usedSlots.includes(i));
      if (nextSlot >= 0) {
        const newPax = createPassenger(getRandomPaxType(), nextSlot);
        state.pendingPassenger = newPax;
      }
    }
  }

  // ─── Passenger Updates ──────────────────────────────────────────
  function updatePassengers(now) {
    for (let i = state.passengers.length - 1; i >= 0; i--) {
      const pax = state.passengers[i];

      if (pax.boarding) {
        const elapsed = now - pax.slideStartTime;
        pax.slideProgress = Math.min(1, elapsed / CONFIG.floorPassengerSlideDuration);
        if (pax.slideProgress >= 1) pax.boarding = false;
      }

      if (pax.exiting) {
        const elapsed = now - pax.slideStartTime;
        pax.slideProgress = Math.max(0, 1 - elapsed / CONFIG.floorPassengerSlideDuration);
        if (pax.slideProgress <= 0) { state.passengers.splice(i, 1); continue; }
      }

      // Visual state from meter
      if (state.meter >= 0.70) pax.state = 'reacting';
      else if (state.meter >= 0.50) pax.state = 'suspicious';
      else pax.state = 'idle';
    }
  }

  // ─── Update Logic ──────────────────────────────────────────────
  function update(now, dt) {
    if (state.gameOver) return;
    const dtSec = dt / 1000;

    updatePassengers(now);

    // ── Floor transition state machine ──
    if (state.floorPhase !== 'riding' && state.floorPhase !== 'countdown') {
      const elapsed = now - state.floorTransitionStart;

      if (state.floorPhase === 'ding') {
        if (elapsed >= CONFIG.floorDingDuration) {
          state.floorPhase = 'doors-open';
          state.floorTransitionStart = now;
          // Process exits and schedule new passenger
          schedulePassengerBoarding();
        }
      } else if (state.floorPhase === 'doors-open') {
        if (elapsed >= CONFIG.floorDoorsOpenDuration) {
          state.floorPhase = 'pax-slide';
          state.floorTransitionStart = now;
          // FIX #5: Start passenger slide-in NOW (during doors open)
          if (state.pendingPassenger) {
            state.pendingPassenger.boarding = true;
            state.pendingPassenger.slideStartTime = now;
            state.pendingPassenger.slideProgress = 0;
            state.passengers.push(state.pendingPassenger);
            state.pendingPassenger = null;
          }
        }
      } else if (state.floorPhase === 'pax-slide') {
        if (elapsed >= CONFIG.floorPassengerSlideDuration) {
          state.floorPhase = 'doors-close';
          state.floorTransitionStart = now;
        }
      } else if (state.floorPhase === 'doors-close') {
        if (elapsed >= CONFIG.floorDoorsCloseDuration) {
          // Advance floor, start countdown
          state.currentFloor++;
          state.floorPerfects = 0; state.floorGoods = 0; state.floorMisses = 0;
          state.fartsFiredThisFloor = new Set();

          if (state.currentFloor > CONFIG.totalFloors) {
            state.gameOver = true; stopMusic(); return;
          }

          state.floorPhase = 'countdown';
          state.countdownPhase = true;
          state.countdownStartTime = now;
        }
      }
      return;
    }

    // ── Countdown phase ──
    if (state.countdownPhase) return;

    // ── Normal riding phase ──
    // Spawn bubbles
    while (state.nextBeatTime <= now + CONFIG.bubbleTravelTime) {
      spawnBubble(state.nextBeatTime);
      state.nextBeatTime += CONFIG.beatInterval;
    }

    // Missed bubbles
    for (const b of state.bubbles) {
      if (!b.hit && !b.missed && now - b.hitTime > CONFIG.goodWindow) {
        b.missed = true;
        state.beatCount++;
        registerResult('miss');
      }
    }

    // Cleanup
    state.bubbles = state.bubbles.filter(b => !b.hit && !b.missed && getBubbleY(b, now) < H + 100);

    // Passive meter from passengers only
    const paxCount = state.passengers.filter(p => !p.exiting).length;
    if (paxCount > 0) {
      const oldMeter = state.meter;
      state.meter = Math.min(1, state.meter + paxCount * CONFIG.meterPerPassenger * dtSec);
      // Check if passive fill crossed a threshold
      if (Math.floor(state.meter * 10) > Math.floor(oldMeter * 10)) {
        checkFartThresholds();
      }
    }

    // Combo decay
    if (state.combo >= 5) {
      state.meter = Math.max(0, state.meter + CONFIG.meterComboDecay * dtSec);
    }

    if (state.meter >= 1.0) { state.meter = 1.0; if (!state.gameOver) { state.gameOver = true; state.gameOverTime = performance.now(); fumeFrame = 0; } stopMusic(); }

    // Popup expiry
    if (state.activePopup && now - state.activePopup.startTime > CONFIG.comboPopupDuration) {
      state.activePopup = null;
    }

    // Floor done?
    if (state.beatCount >= CONFIG.beatsPerFloor) {
      state.floorPhase = 'ding';
      state.floorTransitionStart = now;
      state.rhythmPaused = true;
      state.bubbles = [];
      state.beatCount = 0;
      playDing();
      // Music keeps playing (FIX #4)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────
  const isDoorPhase = () => ['doors-open', 'pax-slide', 'doors-close'].includes(state.floorPhase);

  function render(now) {
    ctx.clearRect(0, 0, W, H);

    // 1. Background — swap to open-door image during door phases
    if (isDoorPhase()) {
      ctx.drawImage(images.elevatorOpen, 0, 0, W, H);
    } else {
      ctx.drawImage(images.elevatorBase, 0, 0, W, H);
    }

    // 2. Floor LED image overlay (replaces dynamic text)
    drawFloorLED();

    // 3. Gas cloud BEHIND passengers and Gino (grows during game over)
    if (state.gameOver) drawFumeCloud();

    // 4. Passengers (walking sprites during boarding)
    drawPassengers(now);

    // 5. Gino (meter-reactive sprite)
    drawGino(now);

    // 5. Tap zone + bubbles (only during riding, not countdown)
    if (state.floorPhase === 'riding' && !state.countdownPhase) {
      drawTapZone();
      drawBubbles(now);
    }

    // 6. Fart meter
    const meter = getFartMeterLayout();
    ctx.drawImage(images.fartMeterEmpty, meter.drawX, meter.drawY, meter.drawW, meter.drawH);
    drawMeterFill(meter, state.meter);

    // 7. Vignette
    if (state.meter > 0.70) drawCriticalVignette();

    // 8. Popup
    drawPopup(now);

    // 9. HUD
    drawComboHUD();

    // 10. Floor transition text (ding phase only — doors use the open bg)
    if (state.floorPhase === 'ding') drawFloorTransitionText(now);

    // 11. Countdown
    if (state.countdownPhase && !needsUserGesture && !state.gameOver) drawCountdown(now);

    // 12. Tap to start
    if (needsUserGesture && !state.gameOver) drawTapToStart();

    // 13. Game over text (fume cloud already drawn behind Gino at step 3)
    if (state.gameOver) drawGameOver(now);
  }

  function drawPassengers(now) {
    // Sort by zIndex: back row (0) first, then front row (1)
    const sorted = [...state.passengers].sort((a, b) => {
      const slotA = PAX_SLOTS[a.slotIndex] || PAX_SLOTS[0];
      const slotB = PAX_SLOTS[b.slotIndex] || PAX_SLOTS[0];
      return slotA.zIndex - slotB.zIndex;
    });

    for (const pax of sorted) {
      let img;
      if (pax.boarding) {
        // Use walking sprites for businessman, idle sprite for others (no walking anim yet)
        if (pax.type === 'businessman') {
          const stepIndex = Math.floor((now - pax.slideStartTime) / 250) % 2;
          img = stepIndex === 0 ? images.paxBusinessmanWalking : images.paxBusinessmanWalking2;
        } else {
          img = images[getPaxImageKey(pax.type, 'idle')] || images.paxBusinessmanIdle;
        }
      } else {
        img = getPassengerImage(pax);
      }

      const layout = getPassengerLayout(pax);
      ctx.save();
      if (pax.boarding || pax.exiting) ctx.globalAlpha = Math.min(1, pax.slideProgress * 2);
      ctx.drawImage(img, layout.drawX, layout.drawY, layout.drawW, layout.drawH);
      ctx.restore();
    }
  }

  // Gino sprite based on meter level
  function drawGino(now) {
    let ginoImg;
    if (state.gameOver) {
      ginoImg = images.ginoFart4;
    } else if (state.meter >= 0.70) {
      ginoImg = images.ginoFart3; // has small fart cloud baked into sprite
    } else if (state.meter >= 0.50) {
      ginoImg = images.ginoFart2;
    } else if (state.meter >= 0.30) {
      ginoImg = images.ginoFart1;
    } else {
      ginoImg = images.ginoIdle;
    }

    const gino = getGinoLayout();
    const scale = gino.drawH / ginoImg.height;
    const drawW = ginoImg.width * scale;
    const drawX = (W - drawW) / 2;
    ctx.drawImage(ginoImg, drawX, gino.drawY, drawW, gino.drawH);
  }

  // Gas cloud animation — gas.png behind Gino, starts small and scales up smoothly
  let fumeFrame = 0;
  const FUME_TOTAL_FRAMES = 300; // ~5 seconds at 60fps

  function drawFumeCloud() {
    fumeFrame++;
    const t = Math.min(1, fumeFrame / FUME_TOTAL_FRAMES);

    // Smooth ease-out curve for natural expansion
    const eased = 1 - Math.pow(1 - t, 3);

    const gasImg = images.gasCloud;
    const gino = getGinoLayout();

    // gas.png starts tiny behind Gino's butt and scales up to fill the elevator
    // Origin: Gino's lower back area
    const originX = gino.drawX + gino.drawW * 0.3;
    const originY = gino.drawY + gino.drawH * 0.5;

    // Scale: starts at 5% of final size, ends at filling most of the elevator
    const finalW = W * 1.1;
    const finalH = H * 0.7;
    const drawW = finalW * (0.05 + eased * 0.95);
    const drawH = finalH * (0.05 + eased * 0.95);

    // Position: centered on origin point, drifts slightly upward as it grows
    const drawX = originX - drawW * 0.4;
    const drawY = originY - drawH * 0.3 - eased * H * 0.1;

    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.drawImage(gasImg, drawX, drawY, drawW, drawH);
    ctx.restore();
  }

  function drawTapZone() {
    const size = CONFIG.tapZoneSize;
    const x = W / 2 - size / 2, y = CONFIG.tapZoneY - size / 2;
    ctx.save(); ctx.globalAlpha = 0.3;
    ctx.drawImage(images.tapZoneRing, x - 4, y - 4, size + 8, size + 8);
    ctx.restore();
    ctx.drawImage(images.tapZoneRing, x, y, size, size);
  }

  function drawBubbles(now) {
    for (const b of state.bubbles) {
      if (b.hit || b.missed) continue;
      const y = getBubbleY(b, now);
      const size = CONFIG.bubbleSize, x = W / 2 - size / 2;
      const fadeIn = Math.min(1, (y - CONFIG.bubbleSpawnY) / 80);
      ctx.save(); ctx.globalAlpha = fadeIn * 0.85;
      ctx.drawImage(images.tapGhostBubble, x, y - size / 2, size, size);
      ctx.restore();
    }
  }

  // Draw meter fill only within the glass tube, in 10 discrete segments
  // Tube boundaries from pixel analysis: top=19.3%, bottom=68.5% of image height
  function drawMeterFill(meter, fillPercent) {
    const segments = Math.round(fillPercent * 10);
    if (segments <= 0) return;
    const segFill = segments / 10;

    const fillImg = images.fartMeterFillGreen;
    // Exact tube region within the rendered meter
    const tubeTop = meter.drawY + meter.drawH * 0.193;   // where glass tube starts
    const tubeBot = meter.drawY + meter.drawH * 0.685;   // where glass tube ends
    const tubeH = tubeBot - tubeTop;
    const fillH = tubeH * segFill;
    const clipY = tubeBot - fillH;  // fill from bottom of tube upward

    ctx.save();
    ctx.beginPath();
    ctx.rect(meter.drawX, clipY, meter.drawW, fillH);
    ctx.clip();
    ctx.drawImage(fillImg, meter.drawX, meter.drawY, meter.drawW, meter.drawH);
    ctx.restore();
  }

  function drawCriticalVignette() {
    const intensity = (state.meter - 0.70) / 0.30;
    const pulse = 0.3 + Math.sin(performance.now() / 200) * 0.1;
    ctx.save(); ctx.globalAlpha = intensity * pulse;
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.6);
    g.addColorStop(0, 'transparent'); g.addColorStop(1, '#ff0000');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawPopup(now) {
    if (!state.activePopup) return;
    const elapsed = now - state.activePopup.startTime;
    const progress = elapsed / CONFIG.comboPopupDuration;
    if (progress > 1) return;
    let img = state.activePopup.type === 'perfect' ? images.comboPopupPerfect :
              state.activePopup.type === 'good' ? images.comboPopupGood : images.comboPopupMiss;
    const scaleP = Math.min(progress / 0.15, 1);
    const fadeP = progress > 0.5 ? 1 - (progress - 0.5) / 0.5 : 1;
    const baseW = 160, baseH = baseW * (img.height / img.width);
    const s = 0.6 + scaleP * 0.4;
    ctx.save(); ctx.globalAlpha = fadeP;
    ctx.drawImage(img, W / 2 - baseW * s / 2, CONFIG.tapZoneY - 120 - baseH * s / 2, baseW * s, baseH * s);
    ctx.restore();
  }

  function drawComboHUD() {
    if (state.combo < 2) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    const t = `x${state.combo} COMBO`, tw = ctx.measureText(t).width;
    roundRect(ctx, 12, H * 0.12, tw + 20, 30, 6); ctx.fill();
    ctx.fillStyle = state.combo >= 5 ? '#facc15' : '#fff';
    ctx.fillText(t, 22, H * 0.12 + 6); ctx.restore();
  }

  function drawFloorLED() {
    // Draw the floor LED image on top of the background's static LED panel
    const floorNum = state.currentFloor;
    const ledKey = floorNum >= 0 && floorNum <= 9 ? `floor${floorNum}` : 'floorEmpty';
    const ledImg = images[ledKey] || images.floorEmpty;

    // Position: centered horizontally, aligned with the LED panel in the background
    // LED panel in bg is at roughly 21-28% from top, centered
    const ledW = W * 0.40;
    const ledH = ledW * (ledImg.height / ledImg.width);
    const ledX = (W - ledW) / 2;
    const ledY = H * 0.205;

    ctx.drawImage(ledImg, ledX, ledY, ledW, ledH);
  }

  // FIX #4: Floor transition text with precision
  function drawFloorTransitionText(now) {
    // Brief ding overlay — just a quick flash, no heavy darkening
    const elapsed = now - state.floorTransitionStart;
    const alpha = Math.max(0, 1 - elapsed / CONFIG.floorDingDuration);
    ctx.save();
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🔔', W / 2, H * 0.45);
    ctx.restore();
  }

  function drawTapToStart() {
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H);
    const pulse = 0.7 + Math.sin(performance.now() / 400) * 0.3;
    ctx.globalAlpha = pulse; ctx.fillStyle = '#fff'; ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u{1F3B5} TAP TO START \u{1F3B5}', W / 2, H * 0.45);
    ctx.globalAlpha = 0.6; ctx.font = '16px Arial';
    ctx.fillText('Tap the bubbles to the beat!', W / 2, H * 0.52);
    ctx.restore();
  }

  function drawCountdown(now) {
    const elapsed = now - state.countdownStartTime;
    const beatMs = CONFIG.beatInterval;
    const beatIndex = Math.floor(elapsed / beatMs);
    const beatProgress = (elapsed % beatMs) / beatMs;

    if (beatIndex >= CONFIG.countdownBeats) {
      state.countdownPhase = false;
      state.rhythmPaused = false;
      state.floorPhase = 'riding';
      state.nextBeatTime = now + CONFIG.beatInterval;
      return;
    }

    const number = CONFIG.countdownBeats - beatIndex;
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, 0, W, H);
    const s = 1 + beatProgress * 0.5;
    ctx.globalAlpha = Math.max(0, 1 - beatProgress * 0.8);
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.floor(72 * s)}px Arial`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(number, W / 2, H * 0.42);
    ctx.globalAlpha = 0.6; ctx.font = '18px Arial';
    ctx.fillText('Get ready...', W / 2, H * 0.52);
    ctx.restore();
  }

  function drawGameOver(now) {
    const elapsed = now - state.gameOverTime;
    const textDelay = 3000;  // wait 3 seconds for fumes to fill before showing text
    const fadeIn = Math.max(0, Math.min(1, (elapsed - textDelay) / 1000)); // 1s fade

    // Dark overlay fades in gradually alongside the fumes
    const overlayAlpha = Math.min(0.6, elapsed / 5000 * 0.6);
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${overlayAlpha})`;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Text only appears after the delay
    if (fadeIn <= 0) return;

    ctx.save();
    ctx.globalAlpha = fadeIn;
    const lvlClear = state.currentFloor > CONFIG.totalFloors;
    ctx.fillStyle = lvlClear ? '#4ade80' : '#ef4444';
    ctx.font = 'bold 42px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(lvlClear ? 'LEVEL CLEAR!' : 'GAME OVER', W / 2, H * 0.30);
    ctx.fillStyle = '#fff'; ctx.font = '20px Arial';
    ctx.fillText(`Score: ${Math.floor(state.score)}`, W / 2, H * 0.40);
    ctx.fillText(`Floor: ${Math.min(state.currentFloor, CONFIG.totalFloors)}`, W / 2, H * 0.45);
    ctx.fillText(`P: ${state.perfects}  G: ${state.goods}  M: ${state.misses}`, W / 2, H * 0.50);
    ctx.fillText(`Best Combo: ${state.bestCombo}`, W / 2, H * 0.55);
    ctx.fillStyle = '#aaa'; ctx.font = '16px Arial';
    ctx.fillText('Tap to restart', W / 2, H * 0.65);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  // ─── Game Loop ──────────────────────────────────────────────────
  function gameLoop() {
    const now = performance.now();
    const dt = Math.min(now - state.lastTime, 100);
    state.lastTime = now;
    update(now, dt);
    render(now);
  }

  function restartGame() {
    Object.assign(state, {
      meter: 0, combo: 0, bestCombo: 0, score: 0,
      perfects: 0, goods: 0, misses: 0,
      floorPerfects: 0, floorGoods: 0, floorMisses: 0,
      bubbles: [], activePopup: null, gameOver: false, gameOverTime: 0, fumeFrame: 0,
      currentFloor: 0, floorPhase: 'riding',
      rhythmPaused: true, beatCount: 0, passengers: [],
      countdownPhase: true, countdownStartTime: performance.now(),
      fartsFiredThisFloor: new Set(),
      lastTime: performance.now(),
      nextBeatTime: performance.now() + CONFIG.beatInterval,
    });
    state.pendingPassenger = null;
  }

  function init() {
    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = '20px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Loading...', W / 2, H / 2);

    Promise.all([loadAllAssets(), loadAllAudio()])
      .then(() => {
        console.log('FART ALARM — Phase 3b ready');
        canvas.addEventListener('mousedown', (e) => { e.preventDefault(); handleTap(); });
        canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleTap(); }, { passive: false });
        state.lastTime = performance.now();
        state.nextBeatTime = state.lastTime + CONFIG.beatInterval;
        state.running = true;
        setInterval(gameLoop, 16);
      })
      .catch(err => {
        ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ef4444'; ctx.font = '16px Arial'; ctx.textAlign = 'center';
        ctx.fillText('Failed to load: ' + err.message, W / 2, H / 2);
      });
  }

  init();
})();
