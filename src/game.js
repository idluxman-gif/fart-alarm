// FART ALARM — game.js (Phase 2: Rhythm Engine)
// Canvas 390x844 | BPM-synced ghost bubbles | tap detection | fart meter

(function () {
  'use strict';

  // ─── Canvas Setup ───────────────────────────────────────────────
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = 390;
  const H = 844;

  // ─── World Config (will be per-world later) ─────────────────────
  const CONFIG = {
    bpm: 85,                    // World 1: Downtown Business District
    get beatInterval() {        // ms per beat
      return 60000 / this.bpm;
    },
    bubbleTravelTime: 1800,     // ms for bubble to fall from spawn to tap zone
    tapZoneY: H * 0.55,        // where the tap zone ring sits (above Gino's head)
    bubbleSpawnY: -60,          // spawn above visible canvas
    bubbleSize: 70,             // rendered bubble diameter
    tapZoneSize: 90,            // rendered ring diameter

    // Timing windows (ms offset from perfect beat alignment)
    perfectWindow: 30,          // PRD: ±30ms
    goodWindow: 80,             // PRD: ±80ms

    // Meter effects per tap result
    meterPerfect: -0.02,       // -2%
    meterGood: 0.03,           // +3%
    meterMiss: 0.08,           // +8%

    // Passive meter (Phase 2: reduced — Phase 3 restores 0.15 with passengers)
    meterBaseRate: 0.01,       // +1% per second (no passengers yet)
    meterComboDecay: -0.015,   // -1.5% per second during combo streaks

    // Combo
    comboPopupDuration: 600,   // ms to show popup
  };

  // ─── Asset Manifest ─────────────────────────────────────────────
  const ASSETS = {
    elevatorBase: 'Assets/Backgrounds/elevator-interior-base.png',
    ginoIdle: 'Assets/characters/gino-idle.png',
    fartMeterEmpty: 'Assets/ui/fart-meter-empty.png',
    fartMeterFillGreen: 'Assets/ui/fart-meter-fill-green.png',
    tapGhostBubble: 'Assets/ui/tap-ghost-bubble.png',
    tapZoneRing: 'Assets/ui/tap-zone-ring.png',
    comboPopupPerfect: 'Assets/ui/combo-popup-perfect.png',
    comboPopupGood: 'Assets/ui/combo-popup-good.png',
    comboPopupMiss: 'Assets/ui/combo-popup-miss.png',
  };

  const images = {};

  // ─── Asset Loader ───────────────────────────────────────────────
  function loadImage(key, src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        images[key] = img;
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Failed to load: ${src}`));
      img.src = src;
    });
  }

  function loadAllAssets() {
    const promises = Object.entries(ASSETS).map(([key, src]) =>
      loadImage(key, src)
    );
    return Promise.all(promises);
  }

  // ─── Game State ─────────────────────────────────────────────────
  const state = {
    running: false,
    lastTime: 0,

    // Rhythm
    nextBeatTime: 0,
    bubbles: [],

    // Fart meter: 0.0 = empty, 1.0 = game over
    meter: 0.05,

    // Combo tracking
    combo: 0,
    bestCombo: 0,

    // Popup
    activePopup: null,

    // Score
    score: 0,
    perfects: 0,
    goods: 0,
    misses: 0,

    // Game over
    gameOver: false,
  };

  // ─── Scene Layout (carried from Phase 1) ────────────────────────
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
    const targetH = H * 0.35;
    const scale = targetH / emptyImg.height;
    const drawW = emptyImg.width * scale;
    const drawH = targetH;
    const drawX = W - drawW - 24;
    const drawY = H * 0.12;
    return { drawW, drawH, drawX, drawY, scale };
  }

  // ─── Bubble Management ──────────────────────────────────────────
  function spawnBubble(beatTime) {
    state.bubbles.push({
      spawnTime: beatTime - CONFIG.bubbleTravelTime,
      hitTime: beatTime,
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
    if (state.gameOver) return;

    const now = performance.now();

    // Find the closest unhit bubble within any timing window
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

    if (!closestBubble || closestOffset > CONFIG.goodWindow) {
      // Tapped with no bubble in range — no penalty (wasted tap)
      return;
    }

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
      state.score += 100 * (1 + Math.floor(state.combo / 5) * 0.1);
      showPopup('perfect', now);
    } else if (type === 'good') {
      state.meter = Math.min(1, state.meter + CONFIG.meterGood);
      state.combo = 0;
      state.goods++;
      state.score += 50;
      showPopup('good', now);
    } else {
      state.meter = Math.min(1, state.meter + CONFIG.meterMiss);
      state.combo = 0;
      state.misses++;
      showPopup('miss', now);
    }

    if (state.combo > state.bestCombo) {
      state.bestCombo = state.combo;
    }

    if (state.meter >= 1.0) {
      state.meter = 1.0;
      state.gameOver = true;
    }
  }

  function showPopup(type, time) {
    state.activePopup = { type, startTime: time };
  }

  // ─── Update Logic ──────────────────────────────────────────────
  function update(now, dt) {
    if (state.gameOver) return;

    // Spawn bubbles on beat
    while (state.nextBeatTime <= now + CONFIG.bubbleTravelTime) {
      spawnBubble(state.nextBeatTime);
      state.nextBeatTime += CONFIG.beatInterval;
    }

    // Check for missed bubbles (passed the tap zone without being hit)
    for (const bubble of state.bubbles) {
      if (!bubble.hit && !bubble.missed) {
        const timePastHit = now - bubble.hitTime;
        if (timePastHit > CONFIG.goodWindow) {
          bubble.missed = true;
          registerResult('miss');
        }
      }
    }

    // Clean up old bubbles (hit, missed, or off screen)
    state.bubbles = state.bubbles.filter((b) => {
      if (b.hit || b.missed) return false;
      const y = getBubbleY(b, now);
      return y < H + 100;
    });

    // Passive meter fill (base rate)
    const dtSec = dt / 1000;
    state.meter = Math.min(1, state.meter + CONFIG.meterBaseRate * dtSec);

    // Combo decay (reduce meter while in combo streak)
    if (state.combo >= 5) {
      state.meter = Math.max(0, state.meter + CONFIG.meterComboDecay * dtSec);
    }

    // Check game over
    if (state.meter >= 1.0) {
      state.meter = 1.0;
      state.gameOver = true;
    }

    // Clear expired popup
    if (state.activePopup) {
      if (now - state.activePopup.startTime > CONFIG.comboPopupDuration) {
        state.activePopup = null;
      }
    }
  }

  // ─── Render ─────────────────────────────────────────────────────
  function render(now) {
    ctx.clearRect(0, 0, W, H);

    // 1. Elevator background
    ctx.drawImage(images.elevatorBase, 0, 0, W, H);

    // 2. Gino (behind gameplay elements)
    const gino = getGinoLayout();
    ctx.drawImage(images.ginoIdle, gino.drawX, gino.drawY, gino.drawW, gino.drawH);

    // 3. Tap zone ring (on top of Gino)
    drawTapZone();

    // 4. Falling ghost bubbles
    drawBubbles(now);

    // 5. Fart meter
    const meter = getFartMeterLayout();
    ctx.drawImage(images.fartMeterEmpty, meter.drawX, meter.drawY, meter.drawW, meter.drawH);
    drawMeterFill(meter, state.meter);

    // 6. Critical vignette when meter > 75%
    if (state.meter > 0.75) {
      drawCriticalVignette();
    }

    // 7. Combo popup
    drawPopup(now);

    // 8. HUD — combo counter
    drawComboHUD();

    // 9. Game over overlay
    if (state.gameOver) {
      drawGameOver();
    }
  }

  function drawTapZone() {
    const size = CONFIG.tapZoneSize;
    const x = W / 2 - size / 2;
    const y = CONFIG.tapZoneY - size / 2;

    // Subtle pulse glow
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

      // Fade in as bubble enters screen
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

    // Animation: scale up then fade out
    const scalePhase = Math.min(progress / 0.15, 1);
    const fadePhase = progress > 0.5 ? 1 - (progress - 0.5) / 0.5 : 1;

    const baseW = 160;
    const baseH = baseW * (img.height / img.width);
    const scale = 0.6 + scalePhase * 0.4;
    const drawW = baseW * scale;
    const drawH = baseH * scale;

    ctx.save();
    ctx.globalAlpha = fadePhase;
    ctx.drawImage(
      img,
      W / 2 - drawW / 2,
      CONFIG.tapZoneY - 120 - drawH / 2,
      drawW,
      drawH
    );
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

  function drawGameOver() {
    ctx.save();

    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, W, H);

    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 42px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('GAME OVER', W / 2, H * 0.35);

    ctx.fillStyle = '#ffffff';
    ctx.font = '20px Arial, sans-serif';
    ctx.fillText(`Score: ${Math.floor(state.score)}`, W / 2, H * 0.45);
    ctx.fillText(`Perfects: ${state.perfects}  Good: ${state.goods}  Miss: ${state.misses}`, W / 2, H * 0.50);
    ctx.fillText(`Best Combo: ${state.bestCombo}`, W / 2, H * 0.55);

    ctx.fillStyle = '#aaa';
    ctx.font = '16px Arial, sans-serif';
    ctx.fillText('Tap to restart', W / 2, H * 0.65);

    ctx.restore();
  }

  // Utility: rounded rectangle
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

    // Cap dt to avoid spiral of death on tab switch
    const clampedDt = Math.min(dt, 100);

    update(now, clampedDt);
    render(now);
  }

  // setInterval ensures consistent ticking even in background tabs
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
    state.bubbles = [];
    state.activePopup = null;
    state.gameOver = false;
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

    loadAllAssets()
      .then(() => {
        console.log('FART ALARM — Phase 2 ready');

        // Bind input — handle restart on game over
        canvas.addEventListener('mousedown', (e) => {
          e.preventDefault();
          if (state.gameOver) {
            restartGame();
            return;
          }
          onTap();
        });
        canvas.addEventListener('touchstart', (e) => {
          e.preventDefault();
          if (state.gameOver) {
            restartGame();
            return;
          }
          onTap();
        }, { passive: false });

        // Start game
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
