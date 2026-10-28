/* Mar de Fondo — sonidos sintetizados con WebAudio (sin archivos). */
(function (root) {
  'use strict';
  let ctx = null, master = null, on = true;
  try { on = root.localStorage.getItem('mdf.sound') !== 'off'; } catch (e) { /* sin almacenamiento */ }

  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    return ctx;
  }
  function noise(dur) {
    const b = ctx.createBuffer(1, Math.max(1, ctx.sampleRate * dur), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource(); s.buffer = b; return s;
  }
  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  const S = {
    boom(delay) {
      if (!on || !ensure()) return;
      const t = ctx.currentTime + (delay || 0);
      const n = noise(0.9), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'lowpass'; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(120, t + 0.6);
      env(g, t, 0.01, 0.9, 0.8);
      n.connect(f); f.connect(g); g.connect(master); n.start(t); n.stop(t + 0.9);
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
      env(og, t, 0.005, 0.7, 0.4);
      o.connect(og); og.connect(master); o.start(t); o.stop(t + 0.5);
    },
    splash(delay) {
      if (!on || !ensure()) return;
      const t = ctx.currentTime + (delay || 0);
      const n = noise(0.5), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'bandpass'; f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(500, t + 0.4); f.Q.value = 0.8;
      env(g, t, 0.02, 0.35, 0.4);
      n.connect(f); f.connect(g); g.connect(master); n.start(t); n.stop(t + 0.5);
    },
    ping() {
      if (!on || !ensure()) return;
      const t = ctx.currentTime;
      [0, 0.35].forEach((d, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = i ? 980 : 1240;
        env(g, t + d, 0.005, i ? 0.12 : 0.25, 0.9);
        o.connect(g); g.connect(master); o.start(t + d); o.stop(t + d + 1);
      });
    },
    chime() {
      if (!on || !ensure()) return;
      const t = ctx.currentTime;
      [660, 880, 1320].forEach((fq, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'triangle'; o.frequency.value = fq;
        env(g, t + i * 0.08, 0.005, 0.2, 0.35);
        o.connect(g); g.connect(master); o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.4);
      });
    },
    buzz() {
      if (!on || !ensure()) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = 140;
      lfo.frequency.value = 28; lg.gain.value = 40;
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.35, t + 0.03);
      g.gain.setValueAtTime(0.35, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
      o.connect(g); g.connect(master);
      o.start(t); lfo.start(t); o.stop(t + 0.7); lfo.stop(t + 0.7);
    },
    tick() {
      if (!on || !ensure()) return;
      const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 1800;
      env(g, t, 0.002, 0.05, 0.05);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.08);
    },
    thunder() {
      if (!on || !ensure()) return;
      const t = ctx.currentTime;
      const n = noise(2), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = 'lowpass'; f.frequency.value = 260;
      env(g, t, 0.08, 0.5, 1.8);
      n.connect(f); f.connect(g); g.connect(master); n.start(t); n.stop(t + 2);
    },
    unlock() { ensure(); },
    get on() { return on; },
    set on(v) {
      on = !!v;
      try { root.localStorage.setItem('mdf.sound', on ? 'on' : 'off'); } catch (e) { /* sin almacenamiento */ }
    },
  };
  root.MDF.Sound = S;
})(window);
