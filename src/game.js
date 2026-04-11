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
    beatOffsetMs: 200,           // FIX #1: shift bubbles 200ms later to land on beat
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
    floorPassengerSlideDuration: 800,
    floorDoorsCloseDuration: 800,

    passengerHeight: H * 0.28,

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
    ginoIdle: 'Assets/characters/gino-idle.png',
    fartMeterEmpty: 'Assets/ui/fart-meter-empty.png',
    fartMeterFillGreen: 'Assets/ui/fart-meter-fill-green.png',
    tapGhostBubble: 'Assets/ui/tap-ghost-bubble.png',
    tapZoneRing: 'Assets/ui/tap-zone-ring.png',
    comboPopupPerfect: 'Assets/ui/combo-popup-perfect.png',
    comboPopupGood: 'Assets/ui/combo-popup-good.png',
    comboPopupMiss: 'Assets/ui/combo-popup-miss.png',
    paxBusinessmanIdle: 'Assets/characters/pax-businessman-idle.png',
    paxBusinessmanSuspicious: 'Assets/characters/pax-businessman-suspicious.png',
    paxBusinessmanReacting: 'Assets/characters/pax-businessman-reacting.png',
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
  };

  // ─── Passenger ──────────────────────────────────────────────────
  function createPassenger(type, side) {
    return {
      type, side, state: 'idle',
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
    const img = getPassengerImage(pax);
    const targetH = CONFIG.passengerHeight;
    const scale = targetH / img.height;
    const drawW = img.width * scale;
    const gino = getGinoLayout();
    const targetX = pax.side === 'left' ? gino.drawX - drawW - 5 : gino.drawX + gino.drawW + 5;
    const doorX = (W - drawW) / 2;
    return { drawW, drawH: targetH, drawX: doorX + (targetX - doorX) * pax.slideProgress, drawY: H - targetH - 50 };
  }

  function getPassengerImage(pax) {
    if (pax.state === 'reacting') return images.paxBusinessmanReacting;
    if (pax.state === 'suspicious') return images.paxBusinessmanSuspicious;
    return images.paxBusinessmanIdle;
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
    if (state.currentFloor < 1) return; // Floor 0 = no passengers
    const precision = getFloorPrecision();

    // Exits
    let exits = 0;
    if (precision >= 90) exits = 2;
    else if (precision >= 70) exits = 1;

    for (let i = 0; i < exits && state.passengers.length > 0; i++) {
      const pax = state.passengers[state.passengers.length - 1];
      pax.exiting = true;
      pax.slideStartTime = performance.now();
    }

    // FIX #3: Board on floors ≥ 1 (every floor for testing)
    const shouldBoard = state.currentFloor >= 1;
    const extraBoards = precision < 50 ? 1 : 0;

    if ((shouldBoard || extraBoards > 0) && state.passengers.filter(p => !p.exiting).length < 3) {
      const activeCount = state.passengers.filter(p => !p.exiting).length;
      const side = activeCount % 2 === 0 ? 'left' : 'right';
      const newPax = createPassenger('businessman', side);
      // FIX #5: Don't set boarding yet — that happens in 'pax-slide' phase
      state.pendingPassenger = newPax;
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

    if (state.meter >= 1.0) { state.meter = 1.0; state.gameOver = true; stopMusic(); }

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
      // Music keeps playing (FIX #4)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────
  function render(now) {
    ctx.clearRect(0, 0, W, H);

    // 1. Background
    ctx.drawImage(images.elevatorBase, 0, 0, W, H);

    // 2. Door overlay during transitions
    const doorPhase = getDoorOpenAmount(now);

    // 3. Passengers
    drawPassengers();

    // 4. Gino
    const gino = getGinoLayout();
    ctx.drawImage(images.ginoIdle, gino.drawX, gino.drawY, gino.drawW, gino.drawH);

    // 5. Door closing overlay
    if (doorPhase !== null) drawDoors(doorPhase);

    // 6. Tap zone + bubbles (only during riding)
    if (state.floorPhase === 'riding' && !state.countdownPhase) {
      drawTapZone();
      drawBubbles(now);
    }

    // 7. Fart meter
    const meter = getFartMeterLayout();
    ctx.drawImage(images.fartMeterEmpty, meter.drawX, meter.drawY, meter.drawW, meter.drawH);
    drawMeterFill(meter, state.meter);

    // 8. Vignette
    if (state.meter > 0.70) drawCriticalVignette();

    // 9. Popup
    drawPopup(now);

    // 10. HUD
    drawComboHUD();
    drawFloorHUD();

    // 11. Floor transition text
    if (state.floorPhase === 'ding' || state.floorPhase === 'doors-open' || state.floorPhase === 'pax-slide' || state.floorPhase === 'doors-close') {
      drawFloorTransitionText(now);
    }

    // 12. Countdown
    if (state.countdownPhase && !needsUserGesture && !state.gameOver) drawCountdown(now);

    // 13. Tap to start
    if (needsUserGesture && !state.gameOver) drawTapToStart();

    // 14. Game over
    if (state.gameOver) drawGameOver();
  }

  // FIX #4: Door animation
  function getDoorOpenAmount(now) {
    if (state.floorPhase === 'doors-open') {
      return Math.min(1, (now - state.floorTransitionStart) / CONFIG.floorDoorsOpenDuration);
    }
    if (state.floorPhase === 'pax-slide') return 1; // fully open
    if (state.floorPhase === 'doors-close') {
      return 1 - Math.min(1, (now - state.floorTransitionStart) / CONFIG.floorDoorsCloseDuration);
    }
    return null;
  }

  function drawDoors(openAmount) {
    // Draw two door panels sliding apart
    const doorW = W * 0.4;
    const doorH = H * 0.55;
    const doorY = H * 0.18;
    const maxSlide = doorW * 0.9;
    const slide = maxSlide * openAmount;

    ctx.save();
    ctx.fillStyle = '#8a8a7a';
    // Left door
    ctx.fillRect(W / 2 - doorW - slide * 0.1, doorY, doorW - slide, doorH);
    // Right door
    ctx.fillRect(W / 2 + slide * 0.1, doorY, doorW - slide, doorH);

    // Door frame
    ctx.strokeStyle = '#666';
    ctx.lineWidth = 2;
    ctx.strokeRect(W / 2 - doorW - 2, doorY - 2, doorW * 2 + 4, doorH + 4);
    ctx.restore();
  }

  function drawPassengers() {
    for (const pax of state.passengers) {
      const img = getPassengerImage(pax);
      const layout = getPassengerLayout(pax);
      ctx.save();
      if (pax.boarding || pax.exiting) ctx.globalAlpha = pax.slideProgress;
      ctx.drawImage(img, layout.drawX, layout.drawY, layout.drawW, layout.drawH);
      ctx.restore();
    }
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

  // FIX #2: Draw meter fill only within tube boundaries, in 10 discrete segments
  function drawMeterFill(meter, fillPercent) {
    // Snap to segments for display
    const segments = Math.round(fillPercent * 10);
    if (segments <= 0) return;
    const segFill = segments / 10;

    const fillImg = images.fartMeterFillGreen;
    // The tube area is roughly the inner 80% of the meter image, offset from top/bottom
    const tubeTopOffset = meter.drawH * 0.06;  // top cap of tube
    const tubeBotOffset = meter.drawH * 0.12;  // bottom base of tube
    const tubeH = meter.drawH - tubeTopOffset - tubeBotOffset;
    const fillH = tubeH * segFill;
    const clipY = meter.drawY + tubeTopOffset + tubeH - fillH;

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

  function drawFloorHUD() {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(ctx, 12, 16, 80, 44, 8); ctx.fill();
    ctx.fillStyle = '#4ade80'; ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`F${state.currentFloor}`, 52, 38); ctx.restore();

    const paxCount = state.passengers.filter(p => !p.exiting).length;
    if (paxCount > 0) {
      ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(ctx, 12, 66, 80, 28, 6); ctx.fill();
      ctx.fillStyle = '#fbbf24'; ctx.font = '14px Arial';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(`\u{1F464} ${paxCount}`, 52, 80); ctx.restore();
    }
  }

  // FIX #4: Floor transition text with precision
  function drawFloorTransitionText(now) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, W, H);

    const precision = getFloorPrecision();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`FLOOR ${state.currentFloor + 1}`, W / 2, H * 0.38);

    ctx.font = '20px Arial';
    const precColor = precision >= 70 ? '#4ade80' : precision >= 50 ? '#fbbf24' : '#ef4444';
    ctx.fillStyle = precColor;
    ctx.fillText(`Precision: ${precision.toFixed(0)}%`, W / 2, H * 0.44);

    // Show door status
    ctx.fillStyle = '#aaa'; ctx.font = '14px Arial';
    if (state.floorPhase === 'ding') ctx.fillText('🔔 Ding!', W / 2, H * 0.50);
    else if (state.floorPhase === 'doors-open') ctx.fillText('Doors opening...', W / 2, H * 0.50);
    else if (state.floorPhase === 'pax-slide') ctx.fillText('Passenger boarding...', W / 2, H * 0.50);
    else if (state.floorPhase === 'doors-close') ctx.fillText('Doors closing...', W / 2, H * 0.50);

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

  function drawGameOver() {
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, W, H);
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
    ctx.fillText('Tap to restart', W / 2, H * 0.65); ctx.restore();
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
      bubbles: [], activePopup: null, gameOver: false,
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
