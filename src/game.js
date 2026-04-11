// FART ALARM — game.js (Phase 3: Passenger System & Floor Events)
// Canvas 390x844 | Rhythm engine | Passenger NPC with state transitions | Floor progression

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

  // ─── Audio System (Web Audio API for BPM-synced playback) ───────
  let audioCtx = null;
  let musicBuffer = null;
  let musicSource = null;
  let musicStartTime = 0;     // audioCtx.currentTime when music started
  let musicPlaying = false;
  let musicLoaded = false;
  let needsUserGesture = true; // mobile requires tap to start audio

  function loadMusic() {
    return fetch('Assets/audio/smooth-jazz-loop.mp3')
      .then(res => res.arrayBuffer())
      .then(buf => {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx.decodeAudioData(buf);
      })
      .then(decoded => {
        musicBuffer = decoded;
        musicLoaded = true;
        console.log(`Music loaded: ${decoded.duration.toFixed(1)}s`);
      })
      .catch(err => console.warn('Music load failed:', err));
  }

  function startMusic() {
    if (!musicLoaded || !audioCtx) return;
    // Resume context if suspended (mobile)
    if (audioCtx.state === 'suspended') audioCtx.resume();

    stopMusic();
    musicSource = audioCtx.createBufferSource();
    musicSource.buffer = musicBuffer;
    musicSource.loop = true;
    musicSource.connect(audioCtx.destination);
    musicSource.start(0);
    musicStartTime = audioCtx.currentTime;
    musicPlaying = true;
    needsUserGesture = false;
  }

  function stopMusic() {
    if (musicSource) {
      try { musicSource.stop(); } catch (e) {}
      musicSource = null;
    }
    musicPlaying = false;
  }

  function pauseMusic() {
    if (audioCtx && musicPlaying) {
      audioCtx.suspend();
    }
  }

  function resumeMusic() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // ─── World Config ───────────────────────────────────────────────
  const CONFIG = {
    bpm: 85,
    get beatInterval() { return 60000 / this.bpm; },
    bubbleTravelTime: 1800,
    beatOffsetMs: 20,            // delay bubbles by ~20ms to sync with music
    tapZoneY: H * 0.65,
    bubbleSpawnY: -60,
    bubbleSize: 70,
    tapZoneSize: 90,
    countdownBeats: 3,           // 3-2-1 countdown before gameplay starts

    // Timing windows
    perfectWindow: 30,
    goodWindow: 80,

    // Meter effects per tap result
    meterPerfect: -0.02,
    meterGood: 0.03,
    meterMiss: 0.08,

    // Passive meter
    meterBaseRate: 0.02,         // base fill with no passengers
    meterPerPassenger: 0.008,    // +0.8% per second per passenger
    meterComboDecay: -0.015,

    // Combo
    comboPopupDuration: 600,

    // Floor system
    beatsPerFloor: 12,           // beats of rhythm before elevator stops
    floorTransitionDuration: 2000, // ms for door open/close animation
    totalFloors: 15,             // World 1 has 15 floors

    // Passenger
    passengerSlideInDuration: 600, // ms to slide in from door
    passengerHeight: H * 0.28,    // rendered passenger height
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
    // Passenger: businessman
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
    return Promise.all(
      Object.entries(ASSETS).map(([key, src]) => loadImage(key, src))
    );
  }

  // ─── Game State ─────────────────────────────────────────────────
  const state = {
    running: false,
    lastTime: 0,

    // Rhythm
    nextBeatTime: 0,
    bubbles: [],
    beatCount: 0,             // beats elapsed on current floor

    // Fart meter
    meter: 0.05,

    // Combo
    combo: 0,
    bestCombo: 0,

    // Popup
    activePopup: null,

    // Score
    score: 0,
    perfects: 0,
    goods: 0,
    misses: 0,

    // Floor tracking
    floorPerfects: 0,         // perfects on current floor
    floorGoods: 0,
    floorMisses: 0,

    // Floor system
    currentFloor: 1,
    floorPhase: 'riding',     // 'riding' | 'stopping' | 'doors' | 'departing'
    floorTransitionStart: 0,
    rhythmPaused: false,

    // Passengers in elevator
    passengers: [],

    // Countdown (3-2-1 before gameplay)
    countdownPhase: true,        // true during countdown
    countdownStartTime: 0,
    countdownNumber: 3,          // current number showing

    // Game over
    gameOver: false,
  };

  // ─── Passenger Object ───────────────────────────────────────────
  function createPassenger(type, side) {
    return {
      type: type,              // 'businessman' (more types later)
      side: side,              // 'left' or 'right' of Gino
      state: 'idle',           // 'idle' | 'suspicious' | 'reacting'
      slideProgress: 0,        // 0 = at door, 1 = in position
      slideStartTime: 0,
      boarding: true,          // true while sliding in
      exiting: false,          // true while sliding out
    };
  }

  // ─── Scene Layout ──────────────────────────────────────────────
  function getGinoLayout() {
    const img = images.ginoIdle;
    const targetH = H * 0.32;
    const scale = targetH / img.height;
    const drawW = img.width * scale;
    const drawH = targetH;
    const drawX = (W - drawW) / 2;
    const drawY = H - drawH - 50;
    return { drawW, drawH, drawX, drawY };
  }

  function getFartMeterLayout() {
    const emptyImg = images.fartMeterEmpty;
    const targetH = H * 0.52;
    const scale = targetH / emptyImg.height;
    const drawW = emptyImg.width * scale * 1.5;
    const drawH = targetH;
    const drawX = W - drawW - 12;
    const drawY = H * 0.06;
    return { drawW, drawH, drawX, drawY, scale };
  }

  function getPassengerLayout(passenger) {
    const img = getPassengerImage(passenger);
    const targetH = CONFIG.passengerHeight;
    const scale = targetH / img.height;
    const drawW = img.width * scale;
    const drawH = targetH;

    const gino = getGinoLayout();
    // Position left or right of Gino
    let targetX;
    if (passenger.side === 'left') {
      targetX = gino.drawX - drawW - 5;
    } else {
      targetX = gino.drawX + gino.drawW + 5;
    }

    // Slide in from center (door) to target position
    const doorX = (W - drawW) / 2;
    const drawX = doorX + (targetX - doorX) * passenger.slideProgress;
    const drawY = H - drawH - 50;

    return { drawW, drawH, drawX, drawY };
  }

  function getPassengerImage(passenger) {
    if (passenger.type === 'businessman') {
      if (passenger.state === 'reacting') return images.paxBusinessmanReacting;
      if (passenger.state === 'suspicious') return images.paxBusinessmanSuspicious;
      return images.paxBusinessmanIdle;
    }
    return images.paxBusinessmanIdle;
  }

  // ─── Bubble Management ──────────────────────────────────────────
  function spawnBubble(beatTime) {
    const adjusted = beatTime + CONFIG.beatOffsetMs;
    state.bubbles.push({
      spawnTime: adjusted - CONFIG.bubbleTravelTime,
      hitTime: adjusted,
      hit: false,
      missed: false,
    });
  }

  function getBubbleY(bubble, now) {
    const elapsed = now - bubble.spawnTime;
    const progress = elapsed / CONFIG.bubbleTravelTime;
    return CONFIG.bubbleSpawnY + (CONFIG.tapZoneY - CONFIG.bubbleSpawnY) * progress;
  }

  // ─── Tap Handling ───────────────────────────────────────────────
  function onTap() {
    if (state.gameOver || state.rhythmPaused) return;

    const now = performance.now();
    let closestBubble = null;
    let closestOffset = Infinity;

    for (const bubble of state.bubbles) {
      if (bubble.hit || bubble.missed) continue;
      const offset = Math.abs(now - bubble.hitTime);
      if (offset < closestOffset) {
        closestOffset = offset;
        closestBubble = bubble;
      }
    }

    if (!closestBubble || closestOffset > CONFIG.goodWindow) return;

    closestBubble.hit = true;

    if (closestOffset <= CONFIG.perfectWindow) {
      registerResult('perfect');
    } else {
      registerResult('good');
    }
  }

  function registerResult(type) {
    const now = performance.now();

    if (type === 'perfect') {
      state.meter = Math.max(0, state.meter + CONFIG.meterPerfect);
      state.combo++;
      state.perfects++;
      state.floorPerfects++;
      state.score += 100 * (1 + Math.floor(state.combo / 5) * 0.1);
      showPopup('perfect', now);
    } else if (type === 'good') {
      state.meter = Math.min(1, state.meter + CONFIG.meterGood);
      state.combo = 0;
      state.goods++;
      state.floorGoods++;
      state.score += 50;
      showPopup('good', now);
    } else {
      state.meter = Math.min(1, state.meter + CONFIG.meterMiss);
      state.combo = 0;
      state.misses++;
      state.floorMisses++;
      showPopup('miss', now);
    }

    if (state.combo > state.bestCombo) state.bestCombo = state.combo;
    if (state.meter >= 1.0) { state.meter = 1.0; state.gameOver = true; stopMusic(); }
  }

  function showPopup(type, time) {
    state.activePopup = { type, startTime: time };
  }

  // ─── Floor Precision & Passenger Exit ───────────────────────────
  // PRD formula: Floor precision score = (PERFECT*2 + GOOD*1) / (total beats*2) * 100
  function getFloorPrecision() {
    const totalBeats = state.floorPerfects + state.floorGoods + state.floorMisses;
    if (totalBeats === 0) return 100;
    return ((state.floorPerfects * 2 + state.floorGoods * 1) / (totalBeats * 2)) * 100;
  }

  // PRD exit rules:
  // Score ≥ 70% → 2 passengers exit at next floor
  // Score 71–100% → 1 passenger exits
  // Score 51–70% → 0 passengers exit
  // Score < 50% → 0 exit, 1 extra boards
  function processFloorEnd() {
    const precision = getFloorPrecision();

    // Determine exits
    let exits = 0;
    let extraBoards = 0;
    if (precision >= 70) {
      exits = precision >= 90 ? 2 : 1;
    } else if (precision < 50) {
      extraBoards = 1;
    }

    // Remove exiting passengers (slide out)
    for (let i = 0; i < exits && state.passengers.length > 0; i++) {
      const pax = state.passengers[state.passengers.length - 1];
      pax.exiting = true;
      pax.slideStartTime = performance.now();
    }

    // Board new passenger (always board 1 on odd floors, or if extraBoards)
    const shouldBoard = (state.currentFloor % 2 === 0) || extraBoards > 0;
    if (shouldBoard && state.passengers.length < 3) {
      // Determine side: alternate left/right
      const side = state.passengers.filter(p => !p.exiting).length % 2 === 0 ? 'left' : 'right';
      const newPax = createPassenger('businessman', side);
      newPax.slideStartTime = performance.now();
      newPax.boarding = true;
      state.passengers.push(newPax);
    }

    // Reset floor stats
    state.floorPerfects = 0;
    state.floorGoods = 0;
    state.floorMisses = 0;
  }

  // ─── Passenger State Updates ────────────────────────────────────
  function updatePassengers(now, dt) {
    for (let i = state.passengers.length - 1; i >= 0; i--) {
      const pax = state.passengers[i];

      // Update slide animation
      if (pax.boarding) {
        const elapsed = now - pax.slideStartTime;
        pax.slideProgress = Math.min(1, elapsed / CONFIG.passengerSlideInDuration);
        if (pax.slideProgress >= 1) pax.boarding = false;
      }

      if (pax.exiting) {
        const elapsed = now - pax.slideStartTime;
        pax.slideProgress = Math.max(0, 1 - elapsed / CONFIG.passengerSlideInDuration);
        if (pax.slideProgress <= 0) {
          state.passengers.splice(i, 1);
          continue;
        }
      }

      // Update visual state based on meter
      if (state.meter >= 0.75) {
        pax.state = 'reacting';
      } else if (state.meter >= 0.50) {
        pax.state = 'suspicious';
      } else {
        pax.state = 'idle';
      }
    }
  }

  // ─── Update Logic ──────────────────────────────────────────────
  function update(now, dt) {
    if (state.gameOver) return;

    const dtSec = dt / 1000;

    // Update passengers (animations + state)
    updatePassengers(now, dt);

    // Floor transition logic
    if (state.floorPhase === 'doors') {
      const elapsed = now - state.floorTransitionStart;
      if (elapsed >= CONFIG.floorTransitionDuration) {
        // Transition done — process floor end, advance floor, resume rhythm
        processFloorEnd();
        state.currentFloor++;

        if (state.currentFloor > CONFIG.totalFloors) {
          // Level complete!
          state.gameOver = true;
          stopMusic();
          return;
        }

        state.floorPhase = 'riding';
        state.rhythmPaused = false;
        state.beatCount = 0;
        state.nextBeatTime = now + CONFIG.beatInterval;
        resumeMusic();
      }
      return; // skip rhythm updates during door transition
    }

    // Skip rhythm during countdown
    if (state.countdownPhase) return;

    // Spawn bubbles on beat
    while (state.nextBeatTime <= now + CONFIG.bubbleTravelTime) {
      spawnBubble(state.nextBeatTime);
      state.nextBeatTime += CONFIG.beatInterval;
    }

    // Check for missed bubbles
    for (const bubble of state.bubbles) {
      if (!bubble.hit && !bubble.missed) {
        if (now - bubble.hitTime > CONFIG.goodWindow) {
          bubble.missed = true;
          state.beatCount++;
          registerResult('miss');
        }
      }
    }

    // Track beat count from hits
    // (beat count for hits is incremented in registerResult via the hit path)

    // Clean up old bubbles
    state.bubbles = state.bubbles.filter((b) => {
      if (b.hit || b.missed) return false;
      return getBubbleY(b, now) < H + 100;
    });

    // Passive meter fill (base + per passenger)
    const passengerCount = state.passengers.filter(p => !p.exiting).length;
    const totalFillRate = CONFIG.meterBaseRate + passengerCount * CONFIG.meterPerPassenger;
    state.meter = Math.min(1, state.meter + totalFillRate * dtSec);

    // Combo decay
    if (state.combo >= 5) {
      state.meter = Math.max(0, state.meter + CONFIG.meterComboDecay * dtSec);
    }

    // Check game over
    if (state.meter >= 1.0) { state.meter = 1.0; state.gameOver = true; stopMusic(); }

    // Clear expired popup
    if (state.activePopup && now - state.activePopup.startTime > CONFIG.comboPopupDuration) {
      state.activePopup = null;
    }

    // Check if floor is done (enough beats elapsed)
    if (state.beatCount >= CONFIG.beatsPerFloor && state.floorPhase === 'riding') {
      state.floorPhase = 'doors';
      state.floorTransitionStart = now;
      state.rhythmPaused = true;
      state.bubbles = [];
      pauseMusic();
    }
  }

  // Override registerResult to also count beats for hits
  const _origRegisterResult = registerResult;
  // Actually, let's count beats in the hit path too
  // We need to increment beatCount when a bubble is HIT (not just missed)
  // Patch onTap to also count beats:
  const _origOnTap = onTap;

  // ─── Render ─────────────────────────────────────────────────────
  function render(now) {
    ctx.clearRect(0, 0, W, H);

    // 1. Elevator background
    ctx.drawImage(images.elevatorBase, 0, 0, W, H);

    // 2. Passengers (behind Gino)
    drawPassengers();

    // 3. Gino
    const gino = getGinoLayout();
    ctx.drawImage(images.ginoIdle, gino.drawX, gino.drawY, gino.drawW, gino.drawH);

    // 4. Tap zone ring
    if (!state.rhythmPaused) drawTapZone();

    // 5. Falling ghost bubbles
    if (!state.rhythmPaused) drawBubbles(now);

    // 6. Fart meter
    const meter = getFartMeterLayout();
    ctx.drawImage(images.fartMeterEmpty, meter.drawX, meter.drawY, meter.drawW, meter.drawH);
    drawMeterFill(meter, state.meter);

    // 7. Critical vignette
    if (state.meter > 0.75) drawCriticalVignette();

    // 8. Combo popup
    drawPopup(now);

    // 9. HUD
    drawComboHUD();
    drawFloorHUD();

    // 10. Floor transition overlay
    if (state.floorPhase === 'doors') drawFloorTransition(now);

    // 11. Game over
    if (state.gameOver) drawGameOver();

    // 12. Countdown overlay (3-2-1)
    if (state.countdownPhase && !needsUserGesture && !state.gameOver) drawCountdown(now);

    // 13. Tap to start overlay (before music starts)
    if (needsUserGesture && !state.gameOver) drawTapToStart();
  }

  function drawPassengers() {
    for (const pax of state.passengers) {
      const img = getPassengerImage(pax);
      const layout = getPassengerLayout(pax);

      ctx.save();
      // Fade during slide
      if (pax.boarding || pax.exiting) {
        ctx.globalAlpha = pax.slideProgress;
      }
      ctx.drawImage(img, layout.drawX, layout.drawY, layout.drawW, layout.drawH);
      ctx.restore();
    }
  }

  function drawTapZone() {
    const size = CONFIG.tapZoneSize;
    const x = W / 2 - size / 2;
    const y = CONFIG.tapZoneY - size / 2;

    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.drawImage(images.tapZoneRing, x - 4, y - 4, size + 8, size + 8);
    ctx.restore();

    ctx.drawImage(images.tapZoneRing, x, y, size, size);
  }

  function drawBubbles(now) {
    for (const bubble of state.bubbles) {
      if (bubble.hit || bubble.missed) continue;
      const y = getBubbleY(bubble, now);
      const size = CONFIG.bubbleSize;
      const x = W / 2 - size / 2;
      const distFromSpawn = y - CONFIG.bubbleSpawnY;
      const fadeIn = Math.min(1, distFromSpawn / 80);

      ctx.save();
      ctx.globalAlpha = fadeIn * 0.85;
      ctx.drawImage(images.tapGhostBubble, x, y - size / 2, size, size);
      ctx.restore();
    }
  }

  function drawMeterFill(meter, fillPercent) {
    const clamped = Math.max(0, Math.min(1, fillPercent));
    const fillImg = images.fartMeterFillGreen;
    const fillH = meter.drawH * clamped;
    const clipY = meter.drawY + meter.drawH - fillH;

    ctx.save();
    ctx.beginPath();
    ctx.rect(meter.drawX, clipY, meter.drawW, fillH);
    ctx.clip();
    ctx.drawImage(fillImg, meter.drawX, meter.drawY, meter.drawW, meter.drawH);
    ctx.restore();
  }

  function drawCriticalVignette() {
    const intensity = (state.meter - 0.75) / 0.25;
    const pulse = 0.3 + Math.sin(performance.now() / 200) * 0.1;
    ctx.save();
    ctx.globalAlpha = intensity * pulse;
    const gradient = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.6);
    gradient.addColorStop(0, 'transparent');
    gradient.addColorStop(1, '#ff0000');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawPopup(now) {
    if (!state.activePopup) return;
    const elapsed = now - state.activePopup.startTime;
    const progress = elapsed / CONFIG.comboPopupDuration;
    if (progress > 1) return;

    let img;
    if (state.activePopup.type === 'perfect') img = images.comboPopupPerfect;
    else if (state.activePopup.type === 'good') img = images.comboPopupGood;
    else img = images.comboPopupMiss;

    const scalePhase = Math.min(progress / 0.15, 1);
    const fadePhase = progress > 0.5 ? 1 - (progress - 0.5) / 0.5 : 1;
    const baseW = 160;
    const baseH = baseW * (img.height / img.width);
    const scale = 0.6 + scalePhase * 0.4;
    const drawW = baseW * scale;
    const drawH = baseH * scale;

    ctx.save();
    ctx.globalAlpha = fadePhase;
    ctx.drawImage(img, W / 2 - drawW / 2, CONFIG.tapZoneY - 120 - drawH / 2, drawW, drawH);
    ctx.restore();
  }

  function drawComboHUD() {
    if (state.combo < 2) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.font = 'bold 18px Arial, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const text = `x${state.combo} COMBO`;
    const textW = ctx.measureText(text).width;
    roundRect(ctx, 12, H * 0.12, textW + 20, 30, 6);
    ctx.fill();
    ctx.fillStyle = state.combo >= 5 ? '#facc15' : '#ffffff';
    ctx.fillText(text, 22, H * 0.12 + 6);
    ctx.restore();
  }

  function drawFloorHUD() {
    ctx.save();
    // Floor indicator — top left
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    roundRect(ctx, 12, 16, 80, 44, 8);
    ctx.fill();

    ctx.fillStyle = '#4ade80';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`F${state.currentFloor}`, 52, 38);
    ctx.restore();

    // Passenger count — below floor
    const paxCount = state.passengers.filter(p => !p.exiting).length;
    if (paxCount > 0) {
      ctx.save();
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      roundRect(ctx, 12, 66, 80, 28, 6);
      ctx.fill();
      ctx.fillStyle = '#fbbf24';
      ctx.font = '14px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`👤 ${paxCount}`, 52, 80);
      ctx.restore();
    }
  }

  function drawFloorTransition(now) {
    const elapsed = now - state.floorTransitionStart;
    const progress = elapsed / CONFIG.floorTransitionDuration;

    // Darken briefly
    const fade = progress < 0.5
      ? Math.sin(progress * Math.PI)      // fade in then out
      : Math.sin(progress * Math.PI);
    const alpha = fade * 0.4;

    ctx.save();
    ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
    ctx.fillRect(0, 0, W, H);

    // Show floor text
    if (progress > 0.2 && progress < 0.8) {
      const textAlpha = Math.min(1, (progress - 0.2) / 0.1) * Math.min(1, (0.8 - progress) / 0.1);
      ctx.globalAlpha = textAlpha;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const precision = getFloorPrecision();
      ctx.fillText(`Floor ${state.currentFloor + 1}`, W / 2, H * 0.4);

      ctx.font = '18px Arial, sans-serif';
      const precColor = precision >= 70 ? '#4ade80' : precision >= 50 ? '#fbbf24' : '#ef4444';
      ctx.fillStyle = precColor;
      ctx.fillText(`Precision: ${precision.toFixed(0)}%`, W / 2, H * 0.46);
    }

    ctx.restore();
  }

  function drawTapToStart() {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, W, H);

    const pulse = 0.7 + Math.sin(performance.now() / 400) * 0.3;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎵 TAP TO START 🎵', W / 2, H * 0.45);

    ctx.globalAlpha = 0.6;
    ctx.font = '16px Arial, sans-serif';
    ctx.fillText('Tap the bubbles to the beat!', W / 2, H * 0.52);
    ctx.restore();
  }

  function drawCountdown(now) {
    const elapsed = now - state.countdownStartTime;
    const beatMs = CONFIG.beatInterval;
    const totalBeats = CONFIG.countdownBeats;

    // Which beat are we on? (0-indexed)
    const beatIndex = Math.floor(elapsed / beatMs);
    const beatProgress = (elapsed % beatMs) / beatMs;

    if (beatIndex >= totalBeats) {
      // Countdown done — start gameplay
      state.countdownPhase = false;
      state.rhythmPaused = false;
      state.nextBeatTime = now + CONFIG.beatInterval;
      return;
    }

    const number = totalBeats - beatIndex; // 3, 2, 1

    ctx.save();
    // Slight darken
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, W, H);

    // Number scales up and fades on each beat
    const scale = 1 + beatProgress * 0.5;
    const alpha = 1 - beatProgress * 0.8;

    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.floor(72 * scale)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(number, W / 2, H * 0.42);

    ctx.globalAlpha = 0.6;
    ctx.font = '18px Arial, sans-serif';
    ctx.fillText('Get ready...', W / 2, H * 0.52);
    ctx.restore();
  }

  function drawGameOver() {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, W, H);

    // Check if level complete or actual game over
    const levelComplete = state.currentFloor > CONFIG.totalFloors;

    ctx.fillStyle = levelComplete ? '#4ade80' : '#ef4444';
    ctx.font = 'bold 42px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(levelComplete ? 'LEVEL CLEAR!' : 'GAME OVER', W / 2, H * 0.30);

    ctx.fillStyle = '#ffffff';
    ctx.font = '20px Arial, sans-serif';
    ctx.fillText(`Score: ${Math.floor(state.score)}`, W / 2, H * 0.40);
    ctx.fillText(`Floor reached: ${Math.min(state.currentFloor, CONFIG.totalFloors)}`, W / 2, H * 0.45);
    ctx.fillText(`Perfects: ${state.perfects}  Good: ${state.goods}  Miss: ${state.misses}`, W / 2, H * 0.50);
    ctx.fillText(`Best Combo: ${state.bestCombo}`, W / 2, H * 0.55);

    ctx.fillStyle = '#aaa';
    ctx.font = '16px Arial, sans-serif';
    ctx.fillText('Tap to restart', W / 2, H * 0.65);
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ─── Game Loop ──────────────────────────────────────────────────
  function gameLoop() {
    const now = performance.now();
    const dt = now - state.lastTime;
    state.lastTime = now;
    const clampedDt = Math.min(dt, 100);

    update(now, clampedDt);
    render(now);
  }

  function startGameLoop() {
    setInterval(gameLoop, 16);
  }

  // ─── Restart ────────────────────────────────────────────────────
  function restartGame() {
    state.meter = 0.05;
    state.combo = 0;
    state.bestCombo = 0;
    state.score = 0;
    state.perfects = 0;
    state.goods = 0;
    state.misses = 0;
    state.floorPerfects = 0;
    state.floorGoods = 0;
    state.floorMisses = 0;
    state.bubbles = [];
    state.activePopup = null;
    state.gameOver = false;
    state.currentFloor = 1;
    state.floorPhase = 'riding';
    state.rhythmPaused = true;
    state.beatCount = 0;
    state.passengers = [];
    state.countdownPhase = true;
    state.countdownStartTime = performance.now();
    state.lastTime = performance.now();
    state.nextBeatTime = state.lastTime + CONFIG.beatInterval;
  }

  // ─── Loading Screen ─────────────────────────────────────────────
  function showLoading() {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.font = '20px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Loading...', W / 2, H / 2);
  }

  // ─── Init ───────────────────────────────────────────────────────
  function init() {
    showLoading();

    Promise.all([loadAllAssets(), loadMusic()])
      .then(() => {
        console.log('FART ALARM — Phase 3 ready (music loaded)');

        // Patch onTap to count beats on hit
        canvas.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (needsUserGesture) { startMusic(); state.countdownPhase = true; state.countdownStartTime = performance.now(); state.rhythmPaused = true; }
          if (state.gameOver) { restartGame(); startMusic(); state.countdownPhase = true; state.countdownStartTime = performance.now(); state.rhythmPaused = true; return; }
          if (state.rhythmPaused) return;

          const now = performance.now();
          let closestBubble = null;
          let closestOffset = Infinity;

          for (const bubble of state.bubbles) {
            if (bubble.hit || bubble.missed) continue;
            const offset = Math.abs(now - bubble.hitTime);
            if (offset < closestOffset) {
              closestOffset = offset;
              closestBubble = bubble;
            }
          }

          if (!closestBubble || closestOffset > CONFIG.goodWindow) return;

          closestBubble.hit = true;
          state.beatCount++;

          if (closestOffset <= CONFIG.perfectWindow) {
            registerResult('perfect');
          } else {
            registerResult('good');
          }
        });

        canvas.addEventListener('touchstart', (e) => {
          e.preventDefault();
          if (needsUserGesture) { startMusic(); state.countdownPhase = true; state.countdownStartTime = performance.now(); state.rhythmPaused = true; }
          if (state.gameOver) { restartGame(); startMusic(); state.countdownPhase = true; state.countdownStartTime = performance.now(); state.rhythmPaused = true; return; }
          if (state.rhythmPaused) return;

          const now = performance.now();
          let closestBubble = null;
          let closestOffset = Infinity;

          for (const bubble of state.bubbles) {
            if (bubble.hit || bubble.missed) continue;
            const offset = Math.abs(now - bubble.hitTime);
            if (offset < closestOffset) {
              closestOffset = offset;
              closestBubble = bubble;
            }
          }

          if (!closestBubble || closestOffset > CONFIG.goodWindow) return;

          closestBubble.hit = true;
          state.beatCount++;

          if (closestOffset <= CONFIG.perfectWindow) {
            registerResult('perfect');
          } else {
            registerResult('good');
          }
        }, { passive: false });

        state.lastTime = performance.now();
        state.nextBeatTime = state.lastTime + CONFIG.beatInterval;
        state.running = true;

        startGameLoop();
      })
      .catch((err) => {
        console.error('Asset load failed:', err);
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ef4444';
        ctx.font = '16px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Failed to load assets', W / 2, H / 2 - 12);
        ctx.fillStyle = '#aaa';
        ctx.font = '12px Arial, sans-serif';
        ctx.fillText(err.message, W / 2, H / 2 + 12);
      });
  }

  init();
})();
