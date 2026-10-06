/*
 * © 2026 gamer-09. All rights reserved.
 * This code is proprietary. Unauthorized copying, modification,
 * distribution, or use of this software is strictly prohibited.
 *
 * Live glass backdrop — canvas-drawn flowing waves for the Wenny glass UI
 * test mode. Generated on-device: no images, no network, no storage beyond
 * one local preference flag (motion on/off).
 *
 * Exposes window.PTR29GlassBackdrop:
 *   setEnabled(bool)  start/stop the animation (glass mode on/off)
 *   setTheme(bool)    true = light palette, false = dark
 *   setMotion(bool)   animate, or hold a single still frame
 *   motionOn()        current motion setting
 *   refresh()         re-measure + repaint (resize)
 */
(function () {
  'use strict';

  var wrap = document.getElementById('glass-backdrop');
  var canvas = document.getElementById('gb-canvas');
  if (!wrap || !canvas) return;

  var ctx = canvas.getContext('2d', { alpha: false });
  var orbCv = document.createElement('canvas');
  var orbCtx = orbCv.getContext('2d');
  var sprites = {};

  // ── palettes ────────────────────────────────────────────────────────────────
  var P = {
    dark: {
      base: ['#0c1c34', '#050d19'],
      comp: 'lighter',
      orbs: [
        { c0: 'rgba(59,130,246,.78)', c1: 'rgba(59,130,246,.20)', sx: .34, sy: .27, px: 0.0, py: 1.2, r: .80 },
        { c0: 'rgba(168,85,247,.70)', c1: 'rgba(168,85,247,.18)', sx: .26, sy: .37, px: 2.1, py: 0.4, r: .76 },
        { c0: 'rgba(45,212,191,.58)', c1: 'rgba(45,212,191,.15)', sx: .42, sy: .21, px: 4.0, py: 2.6, r: .70 }
      ],
      bands: [
        { top: 'rgba(56,189,248,.56)', mid: 'rgba(37,99,235,.32)', bot: 'rgba(37,99,235,0)', hi: 'rgba(186,230,253,.78)' },
        { top: 'rgba(139,92,246,.52)', mid: 'rgba(124,58,237,.30)', bot: 'rgba(124,58,237,0)', hi: 'rgba(221,214,254,.66)' },
        { top: 'rgba(45,212,191,.46)', mid: 'rgba(13,148,136,.26)', bot: 'rgba(13,148,136,0)', hi: 'rgba(204,251,241,.58)' }
      ],
      bokeh: 'rgba(226,240,255,.9)'
    },
    light: {
      base: ['#eaf2fd', '#e2ecfa'],
      comp: 'source-over',
      orbs: [
        { c0: 'rgba(70,150,246,.74)', c1: 'rgba(70,150,246,.24)', sx: .34, sy: .27, px: 0.0, py: 1.2, r: .80 },
        { c0: 'rgba(146,126,240,.70)', c1: 'rgba(146,126,240,.22)', sx: .26, sy: .37, px: 2.1, py: 0.4, r: .76 },
        { c0: 'rgba(56,212,196,.64)', c1: 'rgba(56,212,196,.20)', sx: .42, sy: .21, px: 4.0, py: 2.6, r: .70 },
        { c0: 'rgba(255,166,134,.56)', c1: 'rgba(255,166,134,.18)', sx: .31, sy: .43, px: 5.3, py: 3.1, r: .66 }
      ],
      bands: [
        { top: 'rgba(70,150,246,.70)', mid: 'rgba(70,150,246,.38)', bot: 'rgba(70,150,246,0)', hi: 'rgba(255,255,255,.88)' },
        { top: 'rgba(146,126,240,.66)', mid: 'rgba(146,126,240,.36)', bot: 'rgba(146,126,240,0)', hi: 'rgba(255,255,255,.82)' },
        { top: 'rgba(56,212,196,.62)', mid: 'rgba(56,212,196,.32)', bot: 'rgba(56,212,196,0)', hi: 'rgba(255,255,255,.76)' }
      ],
      bokeh: 'rgba(255,255,255,.95)'
    }
  };

  // ── state ───────────────────────────────────────────────────────────────────
  var MOTION_KEY = 'ptr29_glass_motion_v1';
  var RS_HIGH = 0.72, RS_LOW = 0.55;
  var enabled = false, light = false, motion = true, quality = 'high';
  var raf = 0, t = 0, last = 0, lastPaint = 0, slowTicks = 0, visible = true;
  var w = 0, h = 0, dpr = 1, rs = RS_HIGH, orbScale = 3, bokehN = 16;
  var cache = { key: '', base: null, band: [] };
  var frames = 0, fpsAt = 0;

  var bokeh = [];
  for (var i = 0; i < 16; i++) {
    bokeh.push({ x: Math.random(), y: Math.random(), r: 10 + Math.random() * 52, s: .02 + Math.random() * .06, p: Math.random() * 6.28 });
  }

  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  try {
    var saved = localStorage.getItem(MOTION_KEY);
    motion = saved === null ? !reduced : saved === '1';
  } catch (e) { motion = !reduced; }

  function palette() { return light ? P.light : P.dark; }

  function bokehSprite(color) {
    if (sprites[color]) return sprites[color];
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g2 = c.getContext('2d');
    var g = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    g2.fillStyle = g;
    g2.fillRect(0, 0, 64, 64);
    sprites[color] = c;
    return c;
  }

  function rebuildCache(pal) {
    var key = (light ? 'l' : 'd') + '|' + w + 'x' + h;
    if (cache.key === key) return;
    var base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, pal.base[0]);
    base.addColorStop(1, pal.base[1]);
    var bands = [];
    for (var i = 0; i < pal.bands.length; i++) {
      var g = ctx.createLinearGradient(0, h * (0.36 + i * 0.185) - h * 0.14, 0, h);
      g.addColorStop(0, pal.bands[i].top);
      g.addColorStop(0.5, pal.bands[i].mid);
      g.addColorStop(1, pal.bands[i].bot);
      bands.push(g);
    }
    cache = { key: key, base: base, band: bands };
  }

  function size() {
    dpr = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : 1);
    w = wrap.clientWidth || window.innerWidth || 1;
    h = wrap.clientHeight || window.innerHeight || 1;
    rs = quality === 'high' ? RS_HIGH : RS_LOW;
    canvas.width = Math.max(2, Math.round(w * dpr * rs));
    canvas.height = Math.max(2, Math.round(h * dpr * rs));
    var k = dpr * rs;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    orbCv.width = Math.max(48, Math.round(w / orbScale));
    orbCv.height = Math.max(48, Math.round(h / orbScale));
    cache.key = '';
  }

  function drawOrbs(pal) {
    var sw = orbCv.width, sh = orbCv.height;
    orbCtx.setTransform(1, 0, 0, 1, 0, 0);
    orbCtx.clearRect(0, 0, sw, sh);
    orbCtx.globalCompositeOperation = pal.comp === 'lighter' ? 'lighter' : 'source-over';
    for (var i = 0; i < pal.orbs.length; i++) {
      var b = pal.orbs[i];
      var cx = sw * (0.5 + 0.40 * Math.sin(t * b.sx + b.px));
      var cy = sh * (0.5 + 0.38 * Math.cos(t * b.sy + b.py));
      var r = Math.max(sw, sh) * b.r;
      var g = orbCtx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, b.c0);
      g.addColorStop(0.42, b.c1);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      orbCtx.fillStyle = g;
      orbCtx.fillRect(0, 0, sw, sh);
    }
    orbCtx.globalCompositeOperation = 'source-over';
    ctx.globalCompositeOperation = pal.comp;
    ctx.drawImage(orbCv, 0, 0, sw, sh, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  function bandPaths(i) {
    var yBase = h * (0.36 + i * 0.185);
    var a1 = h * (0.085 + i * 0.022);
    var a2 = h * (0.040 + i * 0.015);
    var k1 = (1.05 + i * 0.34) * 6.28318530718 / Math.max(w, 1);
    var k2 = (2.25 + i * 0.47) * 6.28318530718 / Math.max(w, 1);
    var s1 = 0.34 + i * 0.10, s2 = -0.23 - i * 0.06, ph = i * 1.7;
    var step = Math.max(6, w / 130);
    var top = new Path2D();
    for (var x = -12; x <= w + 12; x += step) {
      var y = yBase + Math.sin(x * k1 + t * s1 + ph) * a1 + Math.sin(x * k2 + t * s2 + ph * 1.6) * a2;
      if (x === -12) top.moveTo(x, y); else top.lineTo(x, y);
    }
    var fill = new Path2D();
    fill.addPath(top);
    fill.lineTo(w + 12, h + 12);
    fill.lineTo(-12, h + 12);
    fill.closePath();
    return { top: top, fill: fill };
  }

  function draw() {
    var pal = palette();
    if (!w || !h) size();
    rebuildCache(pal);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = cache.base;
    ctx.fillRect(0, 0, w, h);
    drawOrbs(pal);
    for (var i = 0; i < pal.bands.length; i++) {
      var pth = bandPaths(i);
      ctx.fillStyle = cache.band[i];
      ctx.fill(pth.fill);
      ctx.strokeStyle = pal.bands[i].hi;
      ctx.lineWidth = 1.5;
      ctx.stroke(pth.top);
    }
    var sp = bokehSprite(pal.bokeh);
    ctx.globalAlpha = 0.26;
    for (var b = 0; b < bokehN; b++) {
      var s = bokeh[b];
      var y = ((s.y - t * s.s * 0.05) % 1 + 1) % 1;
      var x = s.x + Math.sin(t * 0.16 + s.p) * 0.025;
      var d = s.r * 2;
      ctx.drawImage(sp, x * w - s.r, y * h - s.r, d, d);
    }
    ctx.globalAlpha = 1;
    if (!canvas.classList.contains('on')) canvas.classList.add('on');   // crossfade from the still image
  }

  function loop(now) {
    if (!enabled) { raf = 0; return; }
    raf = requestAnimationFrame(loop);
    if (!last) last = now;
    var dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    // auto-lite: soften the scene on slow devices (also halves the frosted-glass
    // blur work, which is the real cost when the backdrop is animating)
    if (now - fpsAt > 900) {
      var f = Math.round(frames * 1000 / (now - fpsAt));
      frames = 0; fpsAt = now;
      if (quality === 'high' && motion && visible && f > 4 && f < 45) {
        if (++slowTicks >= 3) { quality = 'low'; orbScale = 4; bokehN = 9; size(); draw(); }
      } else { slowTicks = 0; }
    }
    frames++;
    if (!motion || !visible) return;                    // still frame: no repaint
    if (quality === 'low' && (now - lastPaint) < 32) return;
    lastPaint = now;
    t += dt;                                            // calm, time-based drift
    draw();
  }

  function start() {
    if (!raf) { last = 0; lastPaint = 0; fpsAt = 0; frames = 0; raf = requestAnimationFrame(loop); }
  }
  function stop() {
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    canvas.classList.remove('on');
  }

  // ── public API ──────────────────────────────────────────────────────────────
  window.PTR29GlassBackdrop = {
    setEnabled: function (on) {
      enabled = !!on;
      if (!enabled) { stop(); return; }
      size();
      draw();                 // first frame immediately (never a blank backdrop)
      start();
    },
    setTheme: function (isLight) {
      light = !!isLight;
      cache.key = '';
      if (enabled) draw();
    },
    setMotion: function (on) {
      motion = !!on;
      try { localStorage.setItem(MOTION_KEY, motion ? '1' : '0'); } catch (e) {}
      if (enabled) { lastPaint = 0; draw(); }   // hold the current frame when still
      return motion;
    },
    motionOn: function () { return motion; },
    refresh: function () { if (!enabled) return; size(); draw(); }
  };

  document.addEventListener('visibilitychange', function () {
    visible = !document.hidden;
    last = 0; lastPaint = 0;
  });
  var rt = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { if (enabled) { size(); draw(); } }, 140);
  });
  window.addEventListener('orientationchange', function () {
    setTimeout(function () { if (enabled) { size(); draw(); } }, 260);
  });
})();
