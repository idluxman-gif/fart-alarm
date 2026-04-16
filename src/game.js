// ELEFARTOR — game.js (Phase 3b: Full Floor Sequence + Fart SFX)
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
      loadSfx('event-phone', 'Assets/audio/event-phone.wav'),
      loadSfx('event-sneeze', 'Assets/audio/event-sneeze.mp3'),
      loadSfx('event-jolt', 'Assets/audio/event-jolt.wav'),
      loadSfx('event-success', 'Assets/audio/event-success.wav'),
      loadSfx('event-fail', 'Assets/audio/event-fail.wav'),
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
      musicBeatOrigin = performance.now();
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
    beatOffsetMs: -155,
    // Horizontal bubble track at the bottom of the screen
    bubbleTrackY: H * 0.92,     // Y position of the horizontal track
    tapZoneX: W * 0.5,          // tap zone at center horizontally
    bubbleSpawnX: -50,           // spawn off left edge
    bubbleSize: 50,              // quarter note bubble size
    eighthNoteSize: 35,          // 8th note bubble size (70% of quarter)
    tapZoneSize: 65,

    // 8th note frequency by floor (chance each beat spawns an 8th note partner)
    eighthNoteChance: [
      0, 0, 0,       // floors 0-2: none
      0.25, 0.25,    // floors 3-4: 25%
      0.50, 0.50,    // floors 5-6: 50%
      0.75, 0.75, 0.75, // floors 7-9: 75%
      1.0,           // floor 10+: always
    ],
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
    totalFloors: 10,

    // FIX #4: Extended floor transition for full door sequence
    // Phases: ding (500ms) → doors open (800ms) → passenger slide (800ms) → doors close (800ms) → countdown (3 beats)
    floorDingDuration: 500,
    floorDoorsOpenDuration: 800,
    floorPassengerSlideDuration: 1200,   // ~4 walking steps at 250ms each
    floorDoorsCloseDuration: 800,

    passengerHeight: H * 0.38,    // bigger than before — more impressive

    // Boss floor
    bossFloor: 10,               // boss triggers at this floor
    bossDurationBeats: 128,      // 90 seconds at 85 BPM ≈ 128 beats
    bossMissPenalty: 0.20,       // +20% per miss during boss
    preBossCutsceneDuration: 5000, // 5 seconds for cutscene

    // Interrupt events
    eventMinFloor: 3,            // events start from floor 3
    eventTimeout: 2000,          // overridden at runtime by testOptions.slowEvents
    eventMinBeat: 8,             // earliest beat an event can trigger
    eventMaxBeat: 20,            // latest beat an event can trigger
    eventPhonePenalty: 0.10,
    eventSneezePenalty: 0.15,
    eventJoltPenalty: 0.10,

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
    gameLogo: 'Assets/logo.png',
    elevatorBase: 'Assets/Backgrounds/elevator-interior-base3.jpg',
    elevatorOpen: 'Assets/Backgrounds/elevator-interior-base3-open.jpg',
    ginoIdle: 'Assets/characters/gino-idle.png',
    fartMeterEmpty: 'Assets/ui/fart-meter-empty.png',
    fartMeterFillGreen: 'Assets/ui/fart-meter-fill-green.png',
    tapGhostBubble: 'Assets/ui/tap-ghost-bubble.png',
    tapGhostBubbleMiss: 'Assets/ui/tap-ghost-bubble-miss.png',
    tapZoneRing: 'Assets/ui/tap-zone-ring.png',
    eventPhone: 'Assets/ui/event-phone.png',
    eventSneeze: 'Assets/ui/event-sneeze.png',
    eventJolt: 'Assets/ui/event-jolt.png',
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

    paxPhonegazerIdle: 'Assets/characters/pax-phonegazer-idle.png',
    paxPhonegazerSuspicious: 'Assets/characters/pax-phonegazer-suspicious.png',
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
    ginoVictorious: 'Assets/characters/gino-victorious.png',
    ginoRelieved: 'Assets/characters/gino-relieved.png',
    ginoBossStaredown: 'Assets/characters/gino-boss-staredown.png',
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
    floorBoss: 'Assets/Backgrounds/FloorBoss.png',
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

  // ─── Beat Grid Sync ─────────────────────────────────────────────
  // Keep a continuous beat grid based on performance.now() origin.
  // After floor transitions, snap nextBeatTime to the nearest future beat on this grid.
  let lastTapX = 0, lastTapY = 0; // last tap coordinates for event hit detection
  let musicBeatOrigin = 0; // performance.now() when beat grid started

  function getNextBeatOnGrid(now) {
    const beatMs = CONFIG.beatInterval;
    const elapsed = now - musicBeatOrigin;
    const nextBeatIndex = Math.ceil(elapsed / beatMs);
    return musicBeatOrigin + nextBeatIndex * beatMs;
  }

  // ─── Game State ─────────────────────────────────────────────────
  const state = {
    running: false, lastTime: 0,

    // Menu
    menuScreen: 'main',         // 'main', 'test-config', or null (in game)
    testOptions: {
      slowEvents: false,
      eighthNotes: false,
      phoneEvents: false,
      sneezeEvents: false,
      joltEvents: false,
      allEvents: false,
      bossFloor: false,
      maxPassengers: false,
      slowMeter: false,
      endless: false,
    },

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

    // Interrupt events
    currentEvent: null,          // { type: 'phone'|'sneeze'|'jolt', startTime, x, y, targetPaxIndex, resolved, joltStep }
    eventFiredThisFloor: false,  // max one event per floor
    eventTriggerBeat: 0,         // pre-calculated beat when event fires
    eventResultFlash: null,      // { success: bool, startTime }

    // FIX #6: Track which fart thresholds have fired this floor
    fartsFiredThisFloor: new Set(),

    gameOver: false,
    gameOverTime: 0,
    levelCleared: false,

    // Boss floor
    isBossFloor: false,
    preBossCutscene: false,     // true during the pre-boss cutscene
    preBossCutsceneStart: 0,
    bossDefeated: false,        // true when boss floor survived
    victoryScreen: false,
    victoryTime: 0,
  };

  // ─── Passenger ──────────────────────────────────────────────────
  // Passenger slot positions (relative to canvas)
  // Front row: same size as Gino, standing beside him
  // Back row: slightly smaller + higher to create depth
  const PAX_SLOTS = [
    // Front row: flanking the sides
    { id: 'front-left',  x: 0.02, y: 0.62, scale: 1.0,  zIndex: 2 },
    { id: 'front-right', x: 0.58, y: 0.62, scale: 1.0,  zIndex: 2 },
    // Back row: between Gino and front characters, slightly higher for depth
    { id: 'mid-left',    x: 0.18, y: 0.58, scale: 0.95, zIndex: 1 },
    { id: 'mid-right',   x: 0.45, y: 0.58, scale: 0.95, zIndex: 1 },
    { id: 'mid-center',  x: 0.32, y: 0.55, scale: 0.90, zIndex: 0 },
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
    const targetH = H * 0.38;
    const scale = targetH / img.height;
    return { drawW: img.width * scale, drawH: targetH, drawX: (W - img.width * scale) / 2, drawY: H - targetH - 30 };
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
    const visualState = (state.gameOver && !state.levelCleared) ? 'gameover'
      : pax.state === 'reacting' ? 'reacting'
      : pax.state === 'suspicious' ? 'suspicious'
      : 'idle';
    const key = getPaxImageKey(pax.type, visualState);
    return images[key] || images.paxBusinessmanIdle;
  }

  let recentExitedTypes = []; // track last 2 exited types

  function getRandomPaxType() {
    // Avoid the last 2 exited types
    const available = PAX_TYPES.filter(t => !recentExitedTypes.includes(t));
    if (available.length === 0) return PAX_TYPES[Math.floor(Math.random() * PAX_TYPES.length)];
    return available[Math.floor(Math.random() * available.length)];
  }

  // Pre-render orange 8th note bubble to offscreen canvas (avoid per-frame compositing)
  let eighthNoteBubbleCanvas = null;
  function createEighthNoteBubble() {
    const src = images.tapGhostBubble;
    if (!src) return;
    const size = 100; // render at high res, scale down when drawing
    const c2 = document.createElement('canvas');
    c2.width = size; c2.height = size;
    const c2x = c2.getContext('2d');
    c2x.drawImage(src, 0, 0, size, size);
    c2x.globalCompositeOperation = 'source-atop';
    c2x.fillStyle = 'rgba(240, 160, 40, 0.55)';
    c2x.fillRect(0, 0, size, size);
    eighthNoteBubbleCanvas = c2;
  }

  // ─── Bubbles ────────────────────────────────────────────────────
  function spawnBubble(beatTime, isEighth) {
    const adjusted = beatTime + CONFIG.beatOffsetMs;
    state.bubbles.push({
      spawnTime: adjusted - CONFIG.bubbleTravelTime,
      hitTime: adjusted,
      hit: false,
      missed: false,
      isEighth: !!isEighth,  // true for 8th notes, false for quarter notes
    });
  }

  function getEventTimeout() {
    return state.testOptions.slowEvents ? 10000 : getEventTimeout();
  }

  function getEighthNoteChance() {
    if (state.testOptions.eighthNotes) return 1.0;
    const floor = state.currentFloor;
    const chances = CONFIG.eighthNoteChance;
    return floor < chances.length ? chances[floor] : 1.0;
  }

  function getBubbleX(bubble, now) {
    const progress = (now - bubble.spawnTime) / CONFIG.bubbleTravelTime;
    return CONFIG.bubbleSpawnX + (CONFIG.tapZoneX - CONFIG.bubbleSpawnX) * progress;
  }

  // ─── Tap Handling ───────────────────────────────────────────────
  // ─── Menu Constants ──────────────────────────────────────────────
  const MENU_BTN_H = 50;
  const TOGGLE_LABELS = [
    { key: 'slowEvents',    label: 'Slow Events (10s window)' },
    { key: 'eighthNotes',   label: '8th Notes (100% all floors)' },
    { key: 'phoneEvents',   label: 'Phone Events only' },
    { key: 'sneezeEvents',  label: 'Sneeze Events only' },
    { key: 'joltEvents',    label: 'Jolt Events only' },
    { key: 'allEvents',     label: 'All Events (from floor 0)' },
    { key: 'bossFloor',     label: 'Skip to Boss Floor' },
    { key: 'maxPassengers', label: 'Max Passengers (5)' },
    { key: 'slowMeter',     label: 'Slow Meter (10% speed)' },
    { key: 'endless',       label: 'Endless (no game over)' },
  ];

  function handleMenuTap(tapX, tapY) {
    const rect = canvas.getBoundingClientRect();
    const x = (tapX - rect.left) * (W / rect.width);
    const y = (tapY - rect.top) * (H / rect.height);

    if (state.menuScreen === 'main') {
      // PLAY button: y ~ 55-63%
      if (y > H * 0.55 && y < H * 0.55 + MENU_BTN_H) {
        state.menuScreen = null;
        startMusic();
        state.countdownPhase = true;
        state.countdownStartTime = performance.now();
        state.rhythmPaused = true;
      }
      // TEST MODE button: y ~ 67-75%
      if (y > H * 0.67 && y < H * 0.67 + MENU_BTN_H) {
        state.menuScreen = 'test-config';
      }
    } else if (state.menuScreen === 'test-config') {
      // Toggle rows start at y=18%, each 38px tall
      const rowStartY = H * 0.18;
      const rowH = 38;
      for (let i = 0; i < TOGGLE_LABELS.length; i++) {
        const ry = rowStartY + i * rowH;
        if (y > ry && y < ry + rowH) {
          const key = TOGGLE_LABELS[i].key;
          state.testOptions[key] = !state.testOptions[key];
          return;
        }
      }
      // START TEST button
      const startY = rowStartY + TOGGLE_LABELS.length * rowH + 15;
      if (y > startY && y < startY + MENU_BTN_H) {
        state.menuScreen = null;
        applyTestOptions();
        startMusic();
        state.countdownPhase = true;
        state.countdownStartTime = performance.now();
        state.rhythmPaused = true;
      }
      // BACK button
      if (y > startY + MENU_BTN_H + 10 && y < startY + MENU_BTN_H * 2 + 10) {
        state.menuScreen = 'main';
      }
    }
  }

  function applyTestOptions() {
    const to = state.testOptions;
    if (to.bossFloor) {
      state.currentFloor = CONFIG.bossFloor - 1;
      state.passengers = [];
    }
    if (to.maxPassengers) {
      // Spawn 5 passengers immediately
      state.passengers = [];
      for (let i = 0; i < 5; i++) {
        const pax = createPassenger(getRandomPaxType(), i);
        pax.slideProgress = 1; pax.boarding = false;
        state.passengers.push(pax);
      }
    }
    // Force event scheduling from floor 0 if any event test is on
    const anyEvent = to.allEvents || to.phoneEvents || to.sneezeEvents || to.joltEvents;
    if (anyEvent) scheduleEventForFloor();
  }

  function handleTap() {
    // Menu screens
    if (state.menuScreen) { handleMenuTap(lastTapX, lastTapY); return; }

    // Endless mode X button (top-right corner)
    if (state.testOptions.endless && !state.menuScreen) {
      const rect = canvas.getBoundingClientRect();
      const tx = (lastTapX - rect.left) * (W / rect.width);
      const ty = (lastTapY - rect.top) * (H / rect.height);
      if (tx > W - 45 && ty < 45) { restartGame(); return; }
    }

    if (state.levelCleared || state.victoryScreen || state.gameOver) { restartGame(); return; }
    if (state.rhythmPaused || state.countdownPhase) return;

    const now = performance.now();

    // Handle interrupt event taps first (takes priority over bubbles)
    if (state.currentEvent && !state.currentEvent.resolved) {
      // Get tap coordinates from the last event
      const rect = canvas.getBoundingClientRect();
      const scaleX = W / rect.width, scaleY = H / rect.height;
      const tapX = (lastTapX - rect.left) * scaleX;
      const tapY = (lastTapY - rect.top) * scaleY;
      if (handleEventTap(tapX, tapY, now)) return;
      return; // during events, taps only go to event handling
    }

    let closest = null, closestOff = Infinity;
    for (const b of state.bubbles) {
      if (b.hit || b.missed) continue;
      const off = Math.abs(now - b.hitTime);
      if (off < closestOff) { closestOff = off; closest = b; }
    }
    if (!closest || closestOff > CONFIG.goodWindow) return;

    closest.hit = true;
    if (!closest.isEighth) state.beatCount++; // only quarter notes count toward floor progress
    registerResult(closestOff <= CONFIG.perfectWindow ? 'perfect' : 'good');
  }

  function registerResult(type) {
    const now = performance.now();
    if (type === 'perfect') {
      state.combo++; state.perfects++; state.floorPerfects++;
      // Meter only reduces on combo ≥ 2 (consecutive perfects)
      if (state.combo >= 2) {
        state.meter = Math.max(0, roundToSegment(state.meter + CONFIG.meterPerfect));
      }
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
        if (pax.slideProgress <= 0) { recentExitedTypes.push(pax.type); if (recentExitedTypes.length > 2) recentExitedTypes.shift(); state.passengers.splice(i, 1); continue; }
      }

      // Visual state from meter
      if (state.meter >= 0.70) pax.state = 'reacting';
      else if (state.meter >= 0.50) pax.state = 'suspicious';
      else pax.state = 'idle';
    }
  }

  // ─── Update Logic ──────────────────────────────────────────────
  function update(now, dt) {
    if (state.gameOver || state.levelCleared) return;
    const dtSec = dt / 1000;

    updatePassengers(now);

    // ── Floor transition state machine ──
    if (state.floorPhase !== 'riding' && state.floorPhase !== 'countdown' && state.floorPhase !== 'pre-boss') {
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
          state.currentFloor++;
          state.floorPerfects = 0; state.floorGoods = 0; state.floorMisses = 0;
          state.fartsFiredThisFloor = new Set();
          state.currentEvent = null;
          state.eventFiredThisFloor = false;
          scheduleEventForFloor();

          if (state.currentFloor > CONFIG.totalFloors) {
            if (state.testOptions.endless) {
              state.currentFloor = 0; // loop back to floor 0
            } else {
              state.levelCleared = true; stopMusic(); return;
            }
          }

          // Check if boss floor should trigger (elevator empty + at boss floor)
          const activePaxCount = state.passengers.filter(p => !p.exiting).length;
          if (state.currentFloor >= CONFIG.bossFloor && activePaxCount === 0 && !state.bossDefeated) {
            // Trigger pre-boss cutscene
            state.preBossCutscene = true;
            state.preBossCutsceneStart = now;
            state.floorPhase = 'pre-boss';
            state.rhythmPaused = true;
            playSfx('fart-lg'); // fart release during cutscene
          } else {
            state.floorPhase = 'countdown';
            state.countdownPhase = true;
            state.countdownStartTime = now;
          }
        }
      }
      return;
    }

    // ── Pre-boss cutscene ──
    if (state.floorPhase === 'pre-boss') {
      const elapsed = now - state.preBossCutsceneStart;
      // Gas cloud grows during cutscene (reuse fumeFrame)
      if (elapsed < 3000) {
        fumeFrame = Math.min(fumeFrame + 1, 180); // grow cloud for 3 seconds
      }
      if (elapsed >= CONFIG.preBossCutsceneDuration) {
        // Cutscene done — start boss floor
        state.preBossCutscene = false;
        state.isBossFloor = true;
        state.meter = 0; // reset meter for boss
        fumeFrame = 0;
        state.fartsFiredThisFloor = new Set();
        state.beatCount = 0;

        // Board the CEO (using businessman sprites for now)
        const ceo = createPassenger('businessman', 0);
        ceo.boarding = true;
        ceo.slideStartTime = now;
        state.passengers.push(ceo);
        state.pendingPassenger = null;

        // Start countdown for boss
        state.floorPhase = 'countdown';
        state.countdownPhase = true;
        state.countdownStartTime = now;
      }
      return;
    }

    // ── Countdown phase ──
    if (state.countdownPhase) return;

    // ── Normal riding phase ──
    // During active events, freeze bubble spawning and miss detection
    if (state.currentEvent && !state.currentEvent.resolved) {
      // Jolt screen shake
      if (state.currentEvent.type === 'jolt') {
        state.currentEvent.shakeOffset = Math.sin(now / 50) * 4;
      }
      // Skip bubble logic during event
      // Still check popup expiry and floor done below
    } else {

    // Spawn bubbles (quarter notes + 8th note subdivisions)
    while (state.nextBeatTime <= now + CONFIG.bubbleTravelTime) {
      spawnBubble(state.nextBeatTime, false); // quarter note

      // Maybe spawn an 8th note on the offbeat (halfway between this beat and next)
      const eighthChance = getEighthNoteChance();
      if (eighthChance > 0 && Math.random() < eighthChance) {
        const eighthTime = state.nextBeatTime + CONFIG.beatInterval / 2;
        spawnBubble(eighthTime, true); // 8th note
      }

      state.nextBeatTime += CONFIG.beatInterval;
    }

    // Missed bubbles
    for (const b of state.bubbles) {
      if (!b.hit && !b.missed && now - b.hitTime > CONFIG.goodWindow) {
        b.missed = true;
        if (!b.isEighth) state.beatCount++; // only quarter notes count toward floor progress
        // Boss floor: +20% miss penalty instead of normal
        if (state.isBossFloor) {
          state.meter = Math.min(1, roundToSegment(state.meter + CONFIG.bossMissPenalty));
          state.combo = 0; state.misses++; state.floorMisses++;
          showPopup('miss', now);
          checkFartThresholds();
          if (state.meter >= 1.0) { if (state.testOptions.endless) { state.meter = 0; state.fartsFiredThisFloor = new Set(); } else { state.meter = 1.0; if (!state.gameOver) { state.gameOver = true; state.gameOverTime = performance.now(); fumeFrame = 0; } stopMusic(); } }
        } else {
          registerResult('miss');
        }
      }
    }

    // Cleanup
    // Keep missed bubbles alive (they keep scrolling right as miss indicators)
    // Remove hit bubbles and bubbles that have scrolled off the right edge
    state.bubbles = state.bubbles.filter(b => {
      if (b.hit) return false;
      const x = getBubbleX(b, now);
      return x < W + 100; // remove when off right edge
    });

    // Passive meter from passengers only
    const paxCount = state.passengers.filter(p => !p.exiting).length;
    if (paxCount > 0) {
      const oldMeter = state.meter;
      const meterMult = state.testOptions.slowMeter ? 0.1 : 1;
      state.meter = Math.min(1, state.meter + paxCount * CONFIG.meterPerPassenger * dtSec * meterMult);
      // Check if passive fill crossed a threshold
      if (Math.floor(state.meter * 10) > Math.floor(oldMeter * 10)) {
        checkFartThresholds();
      }
    }

    // Combo decay
    if (state.combo >= 5) {
      state.meter = Math.max(0, state.meter + CONFIG.meterComboDecay * dtSec);
    }

    if (state.meter >= 1.0) { if (state.testOptions.endless) { state.meter = 0; state.fartsFiredThisFloor = new Set(); } else { state.meter = 1.0; if (!state.gameOver) { state.gameOver = true; state.gameOverTime = performance.now(); fumeFrame = 0; } stopMusic(); } }

    // Popup expiry
    if (state.activePopup && now - state.activePopup.startTime > CONFIG.comboPopupDuration) {
      state.activePopup = null;
    }

    } // end of non-event riding phase

    // ── Interrupt Event Logic ──
    // Trigger event at the pre-calculated beat
    const anyEventTest = state.testOptions.allEvents || state.testOptions.phoneEvents || state.testOptions.sneezeEvents || state.testOptions.joltEvents;
    const eventFloorOk = anyEventTest ? true : state.currentFloor >= CONFIG.eventMinFloor;
    if (!state.currentEvent && !state.eventFiredThisFloor
        && eventFloorOk && !state.isBossFloor
        && state.beatCount >= state.eventTriggerBeat && state.eventTriggerBeat > 0) {
      triggerRandomEvent(now);
    }

    // Update active event (timeout check)
    if (state.currentEvent && !state.currentEvent.resolved) {
      if (now - state.currentEvent.startTime > getEventTimeout()) {
        resolveEvent(false, now); // timed out = fail
      }
    }

    // Clear event result flash
    if (state.eventResultFlash && now - state.eventResultFlash.startTime > 600) {
      state.eventResultFlash = null;
    }

    // Floor done? (boss floor has different beat count)
    const floorBeats = state.isBossFloor ? CONFIG.bossDurationBeats : CONFIG.beatsPerFloor;
    if (state.beatCount >= floorBeats) {
      if (state.isBossFloor) {
        if (state.testOptions.endless) {
          // Endless: loop back from boss
          state.isBossFloor = false;
          state.bossDefeated = false;
          state.currentFloor = 0;
          state.beatCount = 0;
          state.floorPhase = 'countdown';
          state.countdownPhase = true;
          state.countdownStartTime = now;
          state.bubbles = [];
          playDing();
        } else {
          // Boss survived! Victory!
          state.bossDefeated = true;
          state.isBossFloor = false;
          state.victoryScreen = true;
          state.victoryTime = now;
          state.rhythmPaused = true;
          state.bubbles = [];
          stopMusic();
          playDing();
        }
      } else {
        state.floorPhase = 'ding';
        state.floorTransitionStart = now;
        state.rhythmPaused = true;
        state.bubbles = [];
        state.beatCount = 0;
        playDing();
      }
    }
  }

  // ─── Interrupt Events ───────────────────────────────────────────
  function scheduleEventForFloor() {
    const anyEventTest = state.testOptions.allEvents || state.testOptions.phoneEvents || state.testOptions.sneezeEvents || state.testOptions.joltEvents;
    if ((!anyEventTest && state.currentFloor < CONFIG.eventMinFloor) || state.isBossFloor) {
      state.eventTriggerBeat = 0;
      return;
    }
    // Random beat between eventMinBeat and eventMaxBeat
    state.eventTriggerBeat = CONFIG.eventMinBeat +
      Math.floor(Math.random() * (CONFIG.eventMaxBeat - CONFIG.eventMinBeat));
    state.eventFiredThisFloor = false;
  }

  function triggerRandomEvent(now) {
    // Filter event types based on test options
    let types = ['phone', 'sneeze', 'jolt'];
    const to = state.testOptions;
    if (to.phoneEvents || to.sneezeEvents || to.joltEvents) {
      // Specific events selected — filter to only those
      types = [];
      if (to.phoneEvents) types.push('phone');
      if (to.sneezeEvents) types.push('sneeze');
      if (to.joltEvents) types.push('jolt');
    }
    // allEvents keeps all 3 (default)
    if (types.length === 0) types = ['phone', 'sneeze', 'jolt'];
    const type = types[Math.floor(Math.random() * types.length)];

    const event = { type, startTime: now, resolved: false };

    if (type === 'phone') {
      // Safe zone: 20-80% width, 25-55% height
      event.x = W * 0.2 + Math.random() * (W * 0.6);
      event.y = H * 0.25 + Math.random() * (H * 0.3);
      playSfx('event-phone');
    } else if (type === 'sneeze') {
      const activePax = state.passengers.filter(p => !p.exiting && !p.boarding);
      if (activePax.length > 0) {
        const idx = Math.floor(Math.random() * activePax.length);
        event.targetPax = activePax[idx];
      } else {
        event.targetPax = null;
      }
      playSfx('event-sneeze');
    } else if (type === 'jolt') {
      event.joltStep = 0;
      event.shakeOffset = 0;
      playSfx('event-jolt');
    }

    state.currentEvent = event;
    state.eventFiredThisFloor = true;

    // FULLY clear all bubbles — rhythm stops completely
    state.bubbles = [];
  }

  function resolveEvent(success, now) {
    if (!state.currentEvent || state.currentEvent.resolved) return;
    state.currentEvent.resolved = true;

    if (!success) {
      const penalties = { phone: CONFIG.eventPhonePenalty, sneeze: CONFIG.eventSneezePenalty, jolt: CONFIG.eventJoltPenalty };
      const penalty = penalties[state.currentEvent.type] || 0.10;
      state.meter = Math.min(1, roundToSegment(state.meter + penalty));
      checkFartThresholds();
      playSfx('event-fail');
      if (state.meter >= 1.0) { if (state.testOptions.endless) { state.meter = 0; state.fartsFiredThisFloor = new Set(); } else { state.meter = 1.0; if (!state.gameOver) { state.gameOver = true; state.gameOverTime = performance.now(); fumeFrame = 0; } stopMusic(); } }
    } else {
      state.score += 200;
      playSfx('event-success');
    }

    state.eventResultFlash = { success, startTime: now };

    // Resume rhythm after a brief pause
    setTimeout(() => {
      state.currentEvent = null;
      // Snap to beat grid, ensure first bubble has full travel time
      const resumeNow = performance.now();
      state.nextBeatTime = getNextBeatOnGrid(resumeNow);
      const minFirstHit = resumeNow + CONFIG.bubbleTravelTime;
      if (state.nextBeatTime < minFirstHit) {
        const skip = Math.ceil((minFirstHit - state.nextBeatTime) / CONFIG.beatInterval);
        state.nextBeatTime += skip * CONFIG.beatInterval;
      }
    }, 500);
  }

  function handleEventTap(tapX, tapY, now) {
    if (!state.currentEvent || state.currentEvent.resolved) return false;
    const ev = state.currentEvent;

    if (ev.type === 'phone') {
      // Must tap within 60px radius of the phone icon center
      const dx = tapX - ev.x, dy = tapY - ev.y;
      if (dx * dx + dy * dy < 60 * 60) {
        resolveEvent(true, now);
        return true;
      }
      return true; // consume tap but don't resolve (missed the phone)
    } else if (ev.type === 'sneeze') {
      // Must tap within the target passenger's bounding box
      let targetLayout;
      if (ev.targetPax) {
        targetLayout = getPassengerLayout(ev.targetPax);
      } else {
        targetLayout = getGinoLayout();
      }
      if (tapX >= targetLayout.drawX && tapX <= targetLayout.drawX + targetLayout.drawW
          && tapY >= targetLayout.drawY && tapY <= targetLayout.drawY + targetLayout.drawH) {
        resolveEvent(true, now);
        return true;
      }
      return true; // consume tap but don't resolve (tapped wrong area)
    } else if (ev.type === 'jolt') {
      if (ev.joltStep === 0) {
        if (tapX < W / 2) {
          ev.joltStep = 1; // correct: left tap done
        } else {
          ev.joltStep = 0; // wrong side: reset
        }
        return true;
      } else if (ev.joltStep === 1) {
        if (tapX >= W / 2) {
          resolveEvent(true, now); // correct: right tap done
        } else {
          ev.joltStep = 0; // wrong side: reset back to left
        }
        return true;
      }
    }
    return true; // consume all taps during events
  }

  // ─── Render ─────────────────────────────────────────────────────
  const isDoorPhase = () => ['doors-open', 'pax-slide', 'doors-close'].includes(state.floorPhase);

  function render(now) {
    ctx.clearRect(0, 0, W, H);

    // Apply jolt screen shake
    const shakeX = (state.currentEvent && state.currentEvent.type === 'jolt' && !state.currentEvent.resolved)
      ? state.currentEvent.shakeOffset || 0 : 0;
    if (shakeX) { ctx.save(); ctx.translate(shakeX, 0); }

    // 1. Background — swap to open-door image during door phases
    if (isDoorPhase()) {
      ctx.drawImage(images.elevatorOpen, 0, 0, W, H);
    } else {
      ctx.drawImage(images.elevatorBase, 0, 0, W, H);
    }

    // 2. Floor LED image overlay (replaces dynamic text)
    drawFloorLED();

    // 3. Gas cloud BEHIND passengers and Gino (grows during game over, not victory)
    if (state.gameOver && !state.victoryScreen && !state.levelCleared) drawFumeCloud();

    // 4. Passengers (walking sprites during boarding)
    drawPassengers(now);

    // 5. Gino (meter-reactive sprite)
    drawGino(now);

    // 5. Tap zone + bubbles (hidden during events, countdown, victory)
    const eventActive = state.currentEvent && !state.currentEvent.resolved;
    if (state.floorPhase === 'riding' && !state.countdownPhase && !state.victoryScreen && !eventActive) {
      drawTapZone();
      if (!state.isBossFloor) drawBubbles(now);
    }

    // 6. Fart meter
    const meter = getFartMeterLayout();
    ctx.drawImage(images.fartMeterEmpty, meter.drawX, meter.drawY, meter.drawW, meter.drawH);
    drawMeterFill(meter, state.meter);

    // 7. Vignette
    if (state.meter > 0.70) drawCriticalVignette();

    // 8. Popup
    drawPopup(now);

    // End screen shake
    if (shakeX) ctx.restore();

    // 9. Interrupt event overlay
    if (state.currentEvent && !state.currentEvent.resolved) drawEventOverlay(now);
    if (state.eventResultFlash) drawEventFlash(now);

    // 10. HUD
    drawComboHUD();
    if (state.testOptions.endless && !state.menuScreen) drawEndlessExitBtn();

    // 10. Floor transition text (ding phase only — doors use the open bg)
    if (state.floorPhase === 'ding') drawFloorTransitionText(now);

    // 11. Countdown
    if (state.countdownPhase && !needsUserGesture && !state.gameOver) drawCountdown(now);

    // 12. Menu screens
    if (state.menuScreen === 'main') { drawMainMenu(); }
    else if (state.menuScreen === 'test-config') { drawTestConfig(); }

    // 13. Pre-boss cutscene overlay
    if (state.preBossCutscene) drawPreBossCutscene(now);

    // 14. Victory screen
    if (state.victoryScreen) drawVictoryScreen(now);

    // 15. Level cleared screen
    if (state.levelCleared) drawLevelCleared(now);

    // 16. Game over text (fume cloud already drawn behind Gino at step 3)
    if (state.gameOver && !state.victoryScreen && !state.levelCleared) drawGameOver(now);

    // 16. Boss floor indicator
    if (state.isBossFloor && state.floorPhase === 'riding' && !state.countdownPhase) drawBossHUD();
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

  // Gino sprite based on game state
  function drawGino(now) {
    let ginoImg;
    if (state.victoryScreen || state.levelCleared) {
      ginoImg = images.ginoVictorious;
    } else if (state.preBossCutscene) {
      ginoImg = images.ginoRelieved;
    } else if (state.isBossFloor) {
      ginoImg = images.ginoBossStaredown;
    } else if (state.gameOver) {
      ginoImg = images.ginoFart4;
    } else if (state.meter >= 0.70) {
      ginoImg = images.ginoFart3;
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

  // Pre-boss cutscene: Gino checks around, relieved sigh, gas cloud, meter reset
  function drawPreBossCutscene(now) {
    const elapsed = now - state.preBossCutsceneStart;
    const progress = elapsed / CONFIG.preBossCutsceneDuration;

    // Dark overlay fades in
    ctx.save();
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.5, progress * 0.8)})`;
    ctx.fillRect(0, 0, W, H);

    // Gas cloud growing behind Gino during cutscene
    if (elapsed > 1000 && elapsed < 4000) {
      const gasT = (elapsed - 1000) / 2000;
      const gasImg = images.gasCloud;
      const gino = getGinoLayout();
      const gasW = W * 0.5 * gasT;
      const gasH = H * 0.3 * gasT;
      ctx.globalAlpha = 0.5 * gasT;
      ctx.drawImage(gasImg, gino.drawX - gasW * 0.2, gino.drawY + gino.drawH * 0.3 - gasH * 0.3, gasW, gasH);
    }

    // Text sequence
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (progress < 0.3) {
      ctx.fillStyle = '#fff'; ctx.font = 'bold 24px Arial';
      ctx.fillText('Elevator empty...', W / 2, H * 0.25);
    } else if (progress < 0.6) {
      ctx.fillStyle = '#4ade80'; ctx.font = 'bold 28px Arial';
      ctx.fillText('💨 Sweet relief!', W / 2, H * 0.25);
    } else {
      const pulse = 0.7 + Math.sin(now / 200) * 0.3;
      ctx.globalAlpha = pulse;
      ctx.fillStyle = '#ef4444'; ctx.font = 'bold 32px Arial';
      ctx.fillText('⚠️ CEO ENTERING ⚠️', W / 2, H * 0.25);
      ctx.font = '18px Arial'; ctx.fillStyle = '#fbbf24';
      ctx.globalAlpha = 0.8;
      ctx.fillText('Listen to the beat — no visual cues!', W / 2, H * 0.32);
    }
    ctx.restore();
  }

  // Victory screen
  function drawVictoryScreen(now) {
    const elapsed = now - state.victoryTime;
    const fadeIn = Math.min(1, elapsed / 1500);

    ctx.save();
    // Golden glow background
    ctx.fillStyle = `rgba(40, 30, 0, ${fadeIn * 0.7})`;
    ctx.fillRect(0, 0, W, H);

    ctx.globalAlpha = fadeIn;
    ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 42px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🏆 YOU WIN! 🏆', W / 2, H * 0.20);

    ctx.fillStyle = '#fff'; ctx.font = '22px Arial';
    ctx.fillText('The CEO survived!', W / 2, H * 0.28);

    ctx.fillText(`Score: ${Math.floor(state.score)}`, W / 2, H * 0.38);
    ctx.fillText(`Perfects: ${state.perfects}  Good: ${state.goods}`, W / 2, H * 0.43);
    ctx.fillText(`Misses: ${state.misses}`, W / 2, H * 0.48);
    ctx.fillText(`Best Combo: ${state.bestCombo}`, W / 2, H * 0.53);

    if (elapsed > 2000) {
      ctx.fillStyle = '#aaa'; ctx.font = '16px Arial';
      ctx.fillText('Tap to play again', W / 2, H * 0.63);
    }
    ctx.restore();
  }

  // Boss floor HUD indicator
  function drawBossHUD() {
    ctx.save();
    const pulse = 0.6 + Math.sin(performance.now() / 300) * 0.4;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ef4444'; ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText('🎧 BOSS — LISTEN ONLY 🎧', W / 2, 12);
    ctx.restore();
  }

  function drawEventOverlay(now) {
    const ev = state.currentEvent;
    const elapsed = now - ev.startTime;
    const pulse = 0.7 + Math.sin(now / 150) * 0.3;
    const timeLeft = Math.max(0, 1 - elapsed / getEventTimeout());

    // 1. Dark background overlay
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // 2. Thick timer bar — centered, prominent
    const barW = W * 0.7, barH = 10;
    const barX = (W - barW) / 2, barY = H * 0.58;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = timeLeft > 0.3 ? '#fbbf24' : '#ef4444';
    ctx.fillRect(barX, barY, barW * timeLeft, barH);
    ctx.restore();

    // 3. Event-specific large centered UI
    if (ev.type === 'phone') {
      const bounce = Math.sin(now / 80) * 8;
      const size = 150;
      ctx.save(); ctx.globalAlpha = pulse;
      ctx.drawImage(images.eventPhone, ev.x - size / 2, ev.y - size / 2 + bounce, size, size);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText('📱 TAP TO SILENCE!', ev.x, ev.y + size / 2 + 12);
      ctx.restore();

    } else if (ev.type === 'sneeze') {
      let targetX, targetY;
      if (ev.targetPax) {
        const layout = getPassengerLayout(ev.targetPax);
        targetX = layout.drawX + layout.drawW / 2;
        targetY = layout.drawY;
      } else {
        const gino = getGinoLayout();
        targetX = gino.drawX + gino.drawW / 2;
        targetY = gino.drawY;
      }
      const imgW = 220, imgH = 110;
      ctx.save(); ctx.globalAlpha = pulse;
      ctx.drawImage(images.eventSneeze, W / 2 - imgW / 2, H * 0.28, imgW, imgH);
      ctx.restore();
      // Arrow to passenger
      ctx.save();
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(W / 2, H * 0.28 + imgH); ctx.lineTo(targetX, targetY); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center';
      ctx.fillText('TAP: "Bless you!"', W / 2, H * 0.28 + imgH + 20);
      ctx.restore();

    } else if (ev.type === 'jolt') {
      const imgW = W * 0.7, imgH = imgW * 0.25;
      ctx.save(); ctx.globalAlpha = pulse;
      ctx.drawImage(images.eventJolt, (W - imgW) / 2, H * 0.35, imgW, imgH);
      ctx.restore();
      ctx.save();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 24px Arial'; ctx.textAlign = 'center';
      if (ev.joltStep === 0) {
        ctx.fillText('⬅️ TAP LEFT SIDE!', W / 2, H * 0.35 + imgH + 25);
      } else {
        ctx.fillStyle = '#4ade80';
        ctx.fillText('✅ NOW TAP RIGHT! ➡️', W / 2, H * 0.35 + imgH + 25);
      }
      ctx.restore();
    }
  }

  function drawEventFlash(now) {
    const elapsed = now - state.eventResultFlash.startTime;
    const alpha = Math.max(0, 1 - elapsed / 600);
    ctx.save();
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillStyle = state.eventResultFlash.success ? '#22c55e' : '#ef4444';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#fff'; ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(state.eventResultFlash.success ? '✅ Nice!' : '❌ Too slow!', W / 2, H * 0.45);
    ctx.restore();
  }

  function drawTapZone() {
    const size = CONFIG.tapZoneSize;
    const trackY = CONFIG.bubbleTrackY;

    // Subtle track line (solid, no setLineDash for perf)
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(0, trackY - 1, W, 2);
    ctx.restore();

    // Tap zone ring at center
    const x = CONFIG.tapZoneX - size / 2;
    const y = trackY - size / 2;
    ctx.save(); ctx.globalAlpha = 0.3;
    ctx.drawImage(images.tapZoneRing, x - 4, y - 4, size + 8, size + 8);
    ctx.restore();
    ctx.drawImage(images.tapZoneRing, x, y, size, size);
  }

  function drawBubbles(now) {
    const trackY = CONFIG.bubbleTrackY;

    for (const b of state.bubbles) {
      if (b.hit) continue;

      const x = getBubbleX(b, now);
      const size = b.isEighth ? CONFIG.eighthNoteSize : CONFIG.bubbleSize;

      if (b.missed) {
        const pastMissX = x - CONFIG.tapZoneX;
        const fadeOut = Math.max(0, 1 - pastMissX / (W * 0.5));
        ctx.save();
        ctx.globalAlpha = fadeOut * 0.8;
        ctx.drawImage(images.tapGhostBubbleMiss, x - size / 2, trackY - size / 2, size, size);
        ctx.restore();
      } else if (b.isEighth) {
        // 8th note: pre-rendered orange bubble (no per-frame compositing)
        const fadeIn = Math.min(1, (x - CONFIG.bubbleSpawnX) / 80);
        ctx.save();
        ctx.globalAlpha = fadeIn * 0.85;
        const src = eighthNoteBubbleCanvas || images.tapGhostBubble;
        ctx.drawImage(src, x - size / 2, trackY - size / 2, size, size);
        ctx.restore();
      } else {
        // Quarter note: blue bubble
        const fadeIn = Math.min(1, (x - CONFIG.bubbleSpawnX) / 80);
        ctx.save();
        ctx.globalAlpha = fadeIn * 0.85;
        ctx.drawImage(images.tapGhostBubble, x - size / 2, trackY - size / 2, size, size);
        ctx.restore();
      }
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

  // Pre-cache vignette gradient (expensive to create every frame)
  const vignetteGrad = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.6);
  vignetteGrad.addColorStop(0, 'transparent'); vignetteGrad.addColorStop(1, '#ff0000');

  function drawCriticalVignette() {
    const intensity = (state.meter - 0.70) / 0.30;
    const pulse = 0.3 + Math.sin(performance.now() / 200) * 0.1;
    ctx.save(); ctx.globalAlpha = intensity * pulse;
    ctx.fillStyle = vignetteGrad; ctx.fillRect(0, 0, W, H);
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
    ctx.drawImage(img, W / 2 - baseW * s / 2, CONFIG.bubbleTrackY - 100 - baseH * s / 2, baseW * s, baseH * s);
    ctx.restore();
  }

  function drawEndlessExitBtn() {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, W - 42, 8, 34, 34, 8); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 18px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u2715', W - 25, 25);
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
    const ledKey = (state.isBossFloor || state.preBossCutscene || floorNum >= CONFIG.bossFloor) ? 'floorBoss'
      : floorNum >= 0 && floorNum <= 9 ? `floor${floorNum}` : 'floorEmpty';
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

  function drawMainMenu() {
    ctx.save();
    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, W, H);

    // Logo
    const logo = images.gameLogo;
    const logoSize = 120;
    ctx.drawImage(logo, W / 2 - logoSize / 2, H * 0.10, logoSize, logoSize);

    // Title
    ctx.fillStyle = '#fbbf24'; ctx.font = 'bold 36px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ELEFARTOR', W / 2, H * 0.35);

    ctx.fillStyle = '#aaa'; ctx.font = '14px Arial';
    ctx.fillText('Survive the elevator. Tap the beat.', W / 2, H * 0.42);

    // PLAY button
    const btnW = W * 0.6, btnH = MENU_BTN_H;
    const playY = H * 0.55;
    ctx.fillStyle = '#22c55e';
    roundRect(ctx, W / 2 - btnW / 2, playY, btnW, btnH, 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Arial';
    ctx.fillText('\u{1F3AE} PLAY', W / 2, playY + btnH / 2);

    // TEST MODE button
    const testY = H * 0.67;
    ctx.fillStyle = '#6366f1';
    roundRect(ctx, W / 2 - btnW / 2, testY, btnW, btnH, 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Arial';
    ctx.fillText('\u{1F527} TEST MODE', W / 2, testY + btnH / 2);

    ctx.fillStyle = '#555'; ctx.font = '12px Arial';
    ctx.fillText('v1.0 — Tap the bubbles to the beat!', W / 2, H * 0.92);

    ctx.restore();
  }

  function drawTestConfig() {
    ctx.save();
    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#6366f1'; ctx.font = 'bold 26px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('\u{1F527} TEST MODE', W / 2, H * 0.08);

    ctx.fillStyle = '#aaa'; ctx.font = '13px Arial';
    ctx.fillText('Tap toggles, then START', W / 2, H * 0.13);

    // Toggle rows
    const rowStartY = H * 0.18;
    const rowH = 38;
    const rowW = W * 0.85;
    const rowX = (W - rowW) / 2;

    for (let i = 0; i < TOGGLE_LABELS.length; i++) {
      const { key, label } = TOGGLE_LABELS[i];
      const ry = rowStartY + i * rowH;
      const active = state.testOptions[key];

      // Row background
      ctx.fillStyle = active ? 'rgba(34, 197, 94, 0.25)' : 'rgba(255,255,255,0.06)';
      roundRect(ctx, rowX, ry + 2, rowW, rowH - 4, 8); ctx.fill();

      // Checkbox
      ctx.fillStyle = active ? '#22c55e' : '#555';
      roundRect(ctx, rowX + 8, ry + 9, 20, 20, 4); ctx.fill();
      if (active) {
        ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('\u2713', rowX + 18, ry + 19);
      }

      // Label
      ctx.fillStyle = active ? '#fff' : '#aaa';
      ctx.font = '14px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(label, rowX + 36, ry + rowH / 2);
    }

    // START TEST button
    const startY = rowStartY + TOGGLE_LABELS.length * rowH + 15;
    const btnW = W * 0.6;
    ctx.fillStyle = '#22c55e';
    roundRect(ctx, W / 2 - btnW / 2, startY, btnW, MENU_BTN_H, 12); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('START TEST', W / 2, startY + MENU_BTN_H / 2);

    // BACK button
    const backY = startY + MENU_BTN_H + 10;
    ctx.fillStyle = '#444';
    roundRect(ctx, W / 2 - btnW / 2, backY, btnW, MENU_BTN_H, 12); ctx.fill();
    ctx.fillStyle = '#ccc'; ctx.font = 'bold 18px Arial';
    ctx.fillText('\u2190 BACK', W / 2, backY + MENU_BTN_H / 2);

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
      // Set nextBeatTime far enough in the future that the first bubble
      // starts fully off-screen and the player sees it approach
      const gridBeat = getNextBeatOnGrid(now);
      // Ensure at least bubbleTravelTime before first hit
      const minFirstHit = now + CONFIG.bubbleTravelTime;
      if (gridBeat < minFirstHit) {
        // Skip ahead to the next beat that gives enough travel time
        const beatsToSkip = Math.ceil((minFirstHit - gridBeat) / CONFIG.beatInterval);
        state.nextBeatTime = gridBeat + beatsToSkip * CONFIG.beatInterval;
      } else {
        state.nextBeatTime = gridBeat;
      }
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

  function drawLevelCleared(now) {
    ctx.save();
    ctx.fillStyle = 'rgba(20, 30, 10, 0.6)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#4ade80'; ctx.font = 'bold 42px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('LEVEL CLEAR!', W / 2, H * 0.22);

    ctx.fillStyle = '#fff'; ctx.font = '20px Arial';
    ctx.fillText(`Score: ${Math.floor(state.score)}`, W / 2, H * 0.34);
    ctx.fillText(`Perfects: ${state.perfects}  Good: ${state.goods}`, W / 2, H * 0.39);
    ctx.fillText(`Misses: ${state.misses}`, W / 2, H * 0.44);
    ctx.fillText(`Best Combo: ${state.bestCombo}`, W / 2, H * 0.49);

    ctx.fillStyle = '#aaa'; ctx.font = '16px Arial';
    ctx.fillText('Tap to play again', W / 2, H * 0.58);
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

  // ─── Game Loop (rAF primary, setInterval fallback for bg tabs) ──
  let loopId = 0;
  function gameLoop() {
    const now = performance.now();
    const dt = Math.min(now - state.lastTime, 100);
    state.lastTime = now;
    update(now, dt);
    render(now);
    loopId = requestAnimationFrame(gameLoop);
  }

  // Fallback: when tab goes to background, rAF stops. Use setInterval.
  let bgInterval = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(loopId);
      bgInterval = setInterval(() => {
        const now = performance.now();
        const dt = Math.min(now - state.lastTime, 100);
        state.lastTime = now;
        update(now, dt);
      }, 50); // lower rate for bg, update only (no render)
    } else {
      if (bgInterval) { clearInterval(bgInterval); bgInterval = null; }
      state.lastTime = performance.now();
      loopId = requestAnimationFrame(gameLoop);
    }
  });

  function restartGame() {
    Object.assign(state, {
      meter: 0, combo: 0, bestCombo: 0, score: 0,
      perfects: 0, goods: 0, misses: 0,
      floorPerfects: 0, floorGoods: 0, floorMisses: 0,
      bubbles: [], activePopup: null, gameOver: false, gameOverTime: 0,
      currentFloor: 0, floorPhase: 'riding',
      rhythmPaused: true, beatCount: 0, passengers: [],
      levelCleared: false,
      currentEvent: null, eventFiredThisFloor: false, eventTriggerBeat: 0, eventResultFlash: null,
      isBossFloor: false, preBossCutscene: false, bossDefeated: false,
      victoryScreen: false, victoryTime: 0,
      countdownPhase: false,
      menuScreen: 'main',         // return to menu on restart
      fartsFiredThisFloor: new Set(),
      lastTime: performance.now(),
      nextBeatTime: performance.now() + CONFIG.beatInterval,
    });
    state.pendingPassenger = null;
    fumeFrame = 0;
    musicBeatOrigin = performance.now();
    stopMusic();
  }

  function init() {
    ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.font = '20px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('Loading...', W / 2, H / 2);

    Promise.all([loadAllAssets(), loadAllAudio()])
      .then(() => {
        console.log('ELEFARTOR — ready');
        createEighthNoteBubble();
        canvas.addEventListener('mousedown', (e) => {
          e.preventDefault();
          lastTapX = e.clientX; lastTapY = e.clientY;
          handleTap();
        });
        canvas.addEventListener('touchstart', (e) => {
          e.preventDefault();
          if (e.touches.length > 0) { lastTapX = e.touches[0].clientX; lastTapY = e.touches[0].clientY; }
          handleTap();
        }, { passive: false });
        state.lastTime = performance.now();
        state.nextBeatTime = state.lastTime + CONFIG.beatInterval;
        state.running = true;
        loopId = requestAnimationFrame(gameLoop);
      })
      .catch(err => {
        ctx.fillStyle = '#1a1a2e'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ef4444'; ctx.font = '16px Arial'; ctx.textAlign = 'center';
        ctx.fillText('Failed to load: ' + err.message, W / 2, H / 2);
      });
  }

  init();
})();
