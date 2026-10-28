/* Mar de Fondo — dibujo del océano en canvas. */
(function (root) {
  'use strict';
  const M = root.MDF;

  const C = {
    abyss: '#06121a',
    seaA: '#0c2c3c',
    seaB: '#0f3a4c',
    foam: '#d6ecef',
    sand: '#cdb27c',
    sandDark: '#a88c58',
    leaf: '#3e6a3c',
    leafLight: '#5a8c4c',
    brass: '#e0aa45',
    signal: '#ff5a3c',
    sonar: '#74d9c4',
    steel: '#8d9aa5',
    steelDark: '#4f5c66',
    deck: '#b9c3c9',
    rust: '#7a3220',
    storm: '#2a1b40',
    shield: '#7cc4ff',
  };

  const hash = (x, y) => {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = null;
    this.mode = 'idle';         // idle | deploy | aim
    this.hover = null;          // [x, y]
    this.preview = null;        // { cells:[[x,y]], ok, kind, path }
    this.pending = null;        // { cells, kind }
    this.deployShip = null;     // { type, x, y, horiz, ok }
    this.effects = [];
    this.particles = [];
    this.flash = 0;
    this.reduced = root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.ox = 0; this.oy = 0; this.cs = 20;
    this.resize();
    const loop = (t) => { this.draw(t / 1000); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  Renderer.prototype.resize = function () {
    const c = this.canvas, r = c.getBoundingClientRect();
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    c.width = Math.max(10, Math.round(r.width * dpr));
    c.height = Math.max(10, Math.round(r.height * dpr));
    this.dpr = dpr;
    this.w = r.width; this.h = r.height;
    this.layout();
  };

  Renderer.prototype.layout = function () {
    const S = this.view ? this.view.size : 20;
    const avail = Math.min(this.w, this.h);
    const cs = Math.floor(avail / (S + 1.6));
    this.cs = Math.max(8, cs);
    const band = this.cs * 1.0;
    const total = this.cs * S + band;
    this.ox = Math.round((this.w - total) / 2 + band);
    this.oy = Math.round((this.h - total) / 2 + band);
  };

  Renderer.prototype.setView = function (view) {
    const sizeChanged = !this.view || this.view.size !== view.size;
    this.view = view;
    if (sizeChanged) this.layout();
  };

  Renderer.prototype.cellAt = function (px, py) {
    if (!this.view) return null;
    const x = Math.floor((px - this.ox) / this.cs), y = Math.floor((py - this.oy) / this.cs);
    if (x < 0 || y < 0 || x >= this.view.size || y >= this.view.size) return null;
    return [x, y];
  };
  Renderer.prototype.cellCenter = function (x, y) {
    return [this.ox + (x + 0.5) * this.cs, this.oy + (y + 0.5) * this.cs];
  };

  /* ---------- efectos ---------- */
  Renderer.prototype.fx = function (type, x, y, extra) {
    if (this.reduced && type !== 'torpedo') {
      this.effects.push({ type: 'blip', x, y, t0: performance.now() / 1000, dur: 0.6, color: type === 'explosion' ? C.signal : C.foam });
      return;
    }
    const t0 = performance.now() / 1000;
    this.effects.push(Object.assign({ type, x, y, t0, dur: { explosion: 1.1, splash: 0.9, deflect: 0.9, sonar: 1.4, torpedo: 0.9, crate: 1, repair: 1 }[type] || 1 }, extra || {}));
    if (type === 'explosion') {
      const [cx, cy] = this.cellCenter(x, y);
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2, v = 30 + Math.random() * 90;
        this.particles.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 1.5 + Math.random() * 2.5, life: 0.5 + Math.random() * 0.5, age: 0, kind: 'spark' });
      }
    }
    if (type === 'splash') {
      const [cx, cy] = this.cellCenter(x, y);
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 30 + Math.random() * 60;
        this.particles.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 1 + Math.random() * 1.6, life: 0.6, age: 0, kind: 'drop' });
      }
    }
  };
  Renderer.prototype.lightning = function () { if (!this.reduced) this.flash = 1; };

  /* ---------- dibujo ---------- */
  Renderer.prototype.draw = function (t) {
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.abyss;
    ctx.fillRect(0, 0, this.w, this.h);
    if (!this.view) return;
    const v = this.view, S = v.size, cs = this.cs, ox = this.ox, oy = this.oy;
    const tt = this.reduced ? 0 : t;
    if (!this.lastT) this.lastT = t;
    const dt = Math.min(0.05, t - this.lastT); this.lastT = t;

    // agua
    const g = ctx.createLinearGradient(ox, oy, ox + S * cs, oy + S * cs);
    g.addColorStop(0, C.seaA); g.addColorStop(1, C.seaB);
    ctx.fillStyle = g;
    ctx.fillRect(ox, oy, S * cs, S * cs);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const w = Math.sin(x * 0.55 + tt * 0.6) * Math.cos(y * 0.48 - tt * 0.5) + Math.sin((x + y) * 0.3 + tt * 0.9) * 0.5;
      ctx.fillStyle = w > 0 ? `rgba(160,220,235,${0.035 * w})` : `rgba(0,10,20,${-0.07 * w})`;
      ctx.fillRect(ox + x * cs, oy + y * cs, cs, cs);
      const hv = hash(x, y);
      if (hv < 0.14) {
        const a = 0.5 + 0.5 * Math.sin(tt * 1.3 + hv * 60);
        ctx.strokeStyle = `rgba(214,236,239,${0.16 * a})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const cx = ox + (x + 0.3 + hv * 3) * cs, cy = oy + (y + 0.55) * cs + Math.sin(tt + hv * 9) * cs * 0.06;
        ctx.arc(cx, cy, cs * 0.22, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
    }

    // grilla
    ctx.lineWidth = 1;
    for (let i = 0; i <= S; i++) {
      ctx.strokeStyle = i % 5 === 0 ? 'rgba(214,236,239,0.13)' : 'rgba(214,236,239,0.055)';
      ctx.beginPath(); ctx.moveTo(ox + i * cs + 0.5, oy); ctx.lineTo(ox + i * cs + 0.5, oy + S * cs); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy + i * cs + 0.5); ctx.lineTo(ox + S * cs, oy + i * cs + 0.5); ctx.stroke();
    }

    // sectores durante el despliegue
    if (this.mode === 'deploy' && v.me) {
      const s = v.me.sector;
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, S * cs, S * cs);
      ctx.rect(ox + s.x * cs, oy + s.y * cs, s.w * cs, s.h * cs);
      ctx.clip('evenodd');
      ctx.fillStyle = 'rgba(3,10,15,0.55)';
      ctx.fillRect(ox, oy, S * cs, S * cs);
      ctx.strokeStyle = 'rgba(214,236,239,0.06)';
      for (let d = -S * cs; d < S * cs * 2; d += 10) {
        ctx.beginPath(); ctx.moveTo(ox + d, oy); ctx.lineTo(ox + d + S * cs, oy + S * cs); ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = C.brass; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.strokeRect(ox + s.x * cs + 1, oy + s.y * cs + 1, s.w * cs - 2, s.h * cs - 2);
      ctx.setLineDash([]);
      // franja de tormenta futura
      ctx.fillStyle = 'rgba(120,80,170,0.10)';
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++)
        if (M.inStorm(v, x, y, 2)) ctx.fillRect(ox + x * cs, oy + y * cs, cs, cs);
    }

    this.drawIslands(ctx, v, tt);
    this.drawStorm(ctx, v, tt);
    this.drawMarkers(ctx, v, tt);
    this.drawCrates(ctx, v, tt);
    if (v.me) v.me.ships.forEach(s => this.drawShip(ctx, s, tt, { diving: this.divingPreview && s.type === 'submarino' }));
    if (this.deployShip) this.drawDeployGhost(ctx);
    this.drawSonar(ctx, v, tt);
    this.emitSmoke(v, dt);
    this.drawParticles(ctx, dt);
    this.drawFog(ctx, v, tt);
    this.drawPending(ctx, tt);
    this.drawPreview(ctx, tt);
    this.drawEffects(ctx, t);
    this.drawLabels(ctx, v);

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(220,210,255,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, this.w, this.h);
      this.flash = Math.max(0, this.flash - dt * 3);
    }
    if (v.storm > 0 && !this.reduced && Math.random() < 0.004) this.flash = 0.8;
  };

  Renderer.prototype.drawIslands = function (ctx, v, t) {
    const S = v.size, cs = this.cs, ox = this.ox, oy = this.oy;
    const rr = (x, y, w, h, r) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); };
    const foamA = 0.22 + 0.08 * Math.sin(t * 1.4);
    ctx.fillStyle = `rgba(214,236,239,${foamA})`;
    v.islands.forEach(k => { const x = k % S, y = (k / S) | 0; rr(ox + x * cs - cs * 0.16, oy + y * cs - cs * 0.16, cs * 1.32, cs * 1.32, cs * 0.45); });
    ctx.fillStyle = C.sandDark;
    v.islands.forEach(k => { const x = k % S, y = (k / S) | 0; rr(ox + x * cs - cs * 0.04, oy + y * cs - cs * 0.02, cs * 1.08, cs * 1.08, cs * 0.38); });
    ctx.fillStyle = C.sand;
    v.islands.forEach(k => { const x = k % S, y = (k / S) | 0; rr(ox + x * cs - cs * 0.04, oy + y * cs - cs * 0.06, cs * 1.08, cs * 1.04, cs * 0.38); });
    v.islands.forEach(k => {
      const x = k % S, y = (k / S) | 0, h = hash(x, y);
      const cx = ox + (x + 0.5) * cs, cy = oy + (y + 0.45) * cs;
      if (h < 0.7) {
        ctx.fillStyle = C.leaf;
        ctx.beginPath(); ctx.arc(cx + (h - 0.35) * cs * 0.4, cy, cs * (0.26 + h * 0.12), 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = C.leafLight;
        ctx.beginPath(); ctx.arc(cx + (h - 0.35) * cs * 0.4 - cs * 0.07, cy - cs * 0.07, cs * (0.12 + h * 0.06), 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = '#7d7466';
        ctx.beginPath(); ctx.ellipse(cx, cy + cs * 0.05, cs * 0.22, cs * 0.15, 0.3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#9a9081';
        ctx.beginPath(); ctx.ellipse(cx - cs * 0.05, cy, cs * 0.12, cs * 0.08, 0.3, 0, Math.PI * 2); ctx.fill();
      }
    });
  };

  Renderer.prototype.drawStorm = function (ctx, v, t) {
    const S = v.size, cs = this.cs, ox = this.ox, oy = this.oy;
    const L = v.storm, N = v.nextStorm;
    if (L > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, S * cs, S * cs);
      ctx.rect(ox + L * cs, oy + L * cs, (S - 2 * L) * cs, (S - 2 * L) * cs);
      ctx.clip('evenodd');
      ctx.fillStyle = 'rgba(34,20,58,0.62)';
      ctx.fillRect(ox, oy, S * cs, S * cs);
      ctx.strokeStyle = 'rgba(190,180,230,0.25)';
      ctx.lineWidth = 1;
      const off = (t * 220) % 24;
      for (let i = -S * cs; i < S * cs * 2; i += 12) {
        const yy = ((i * 7.3) % 24) + off;
        for (let y = -24 + yy; y < S * cs; y += 24) {
          ctx.beginPath(); ctx.moveTo(ox + i + y * 0.25, oy + y); ctx.lineTo(ox + i + y * 0.25 + 3, oy + y + 10); ctx.stroke();
        }
      }
      ctx.restore();
      ctx.strokeStyle = `rgba(196,154,242,${0.6 + 0.3 * Math.sin(t * 6)})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + L * cs, oy + L * cs, (S - 2 * L) * cs, (S - 2 * L) * cs);
    }
    if (N > L && N * 2 < S) {
      ctx.strokeStyle = 'rgba(196,154,242,0.45)';
      ctx.setLineDash([4, 5]); ctx.lineWidth = 1.5;
      ctx.strokeRect(ox + N * cs, oy + N * cs, (S - 2 * N) * cs, (S - 2 * N) * cs);
      ctx.setLineDash([]);
    }
  };

  Renderer.prototype.drawMarkers = function (ctx, v, t) {
    const S = v.size, cs = this.cs, ox = this.ox, oy = this.oy;
    Object.keys(v.markers).forEach(ks => {
      const k = +ks, m = v.markers[k], x = k % S, y = (k / S) | 0;
      const cx = ox + (x + 0.5) * cs, cy = oy + (y + 0.5) * cs;
      if (m.kind === 'splash') {
        ctx.strokeStyle = 'rgba(214,236,239,0.55)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(cx, cy, cs * 0.18, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(214,236,239,0.6)';
        ctx.beginPath(); ctx.arc(cx, cy, cs * 0.05, 0, Math.PI * 2); ctx.fill();
      } else if (m.kind === 'smoke') {
        const fl = 0.75 + 0.25 * Math.sin(t * 9 + x * 3 + y);
        const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, cs * 0.55);
        gr.addColorStop(0, `rgba(255,120,50,${0.75 * fl})`);
        gr.addColorStop(0.4, `rgba(200,50,20,${0.35 * fl})`);
        gr.addColorStop(1, 'rgba(120,20,10,0)');
        ctx.fillStyle = gr;
        ctx.fillRect(cx - cs * 0.6, cy - cs * 0.6, cs * 1.2, cs * 1.2);
        ctx.fillStyle = `rgba(255,214,120,${0.9 * fl})`;
        ctx.beginPath(); ctx.arc(cx, cy, cs * 0.08, 0, Math.PI * 2); ctx.fill();
      } else if (m.kind === 'wreck') {
        ctx.fillStyle = 'rgba(40,16,10,0.72)';
        ctx.beginPath(); ctx.roundRect(ox + x * cs + cs * 0.12, oy + y * cs + cs * 0.12, cs * 0.76, cs * 0.76, cs * 0.12); ctx.fill();
        ctx.strokeStyle = 'rgba(200,90,50,0.7)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(cx - cs * 0.2, cy - cs * 0.2); ctx.lineTo(cx + cs * 0.2, cy + cs * 0.2);
        ctx.moveTo(cx + cs * 0.2, cy - cs * 0.2); ctx.lineTo(cx - cs * 0.2, cy + cs * 0.2);
        ctx.stroke();
      } else if (m.kind === 'deflect') {
        ctx.strokeStyle = 'rgba(124,196,255,0.8)';
        ctx.lineWidth = 1.4;
        hexPath(ctx, cx, cy, cs * 0.3);
        ctx.stroke();
      }
    });
  };

  function hexPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + i * Math.PI / 3;
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  Renderer.prototype.drawCrates = function (ctx, v, t) {
    const cs = this.cs;
    v.crates.forEach(c => {
      const [cx, cy0] = this.cellCenter(c.x, c.y);
      const cy = cy0 + Math.sin(t * 2 + c.id) * cs * 0.05;
      // halo
      ctx.strokeStyle = `rgba(224,170,69,${0.35 + 0.25 * Math.sin(t * 3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx, cy0, cs * 0.46, 0, Math.PI * 2); ctx.stroke();
      // caja
      ctx.fillStyle = '#9a6a33';
      ctx.fillRect(cx - cs * 0.2, cy - cs * 0.12, cs * 0.4, cs * 0.32);
      ctx.strokeStyle = '#5e3e1a'; ctx.lineWidth = 1;
      ctx.strokeRect(cx - cs * 0.2, cy - cs * 0.12, cs * 0.4, cs * 0.32);
      ctx.beginPath(); ctx.moveTo(cx - cs * 0.2, cy - cs * 0.12); ctx.lineTo(cx + cs * 0.2, cy + cs * 0.2); ctx.stroke();
      // flotador
      ctx.fillStyle = C.brass;
      ctx.beginPath(); ctx.arc(cx, cy - cs * 0.22, cs * 0.08, 0, Math.PI * 2); ctx.fill();
    });
  };

  Renderer.prototype.drawShip = function (ctx, ship, t, opts) {
    const cs = this.cs, n = ship.cells.length;
    const len = n * cs, beam = cs * ({ acorazado: 0.66, submarino: 0.46, fragata: 0.56, lancha: 0.5 }[ship.type]);
    const cx = this.ox + (ship.x + (ship.horiz ? n / 2 : 0.5)) * cs;
    const cy = this.oy + (ship.y + (ship.horiz ? 0.5 : n / 2)) * cs;
    ctx.save();
    ctx.translate(cx, cy);
    if (!ship.horiz) ctx.rotate(Math.PI / 2);
    ctx.globalAlpha = ship.sunk ? 0.35 : (opts && opts.diving ? 0.4 : 1);
    const hl = len / 2 - cs * 0.1, hb = beam / 2;

    // estela
    if (!ship.sunk) {
      ctx.fillStyle = 'rgba(214,236,239,0.10)';
      ctx.beginPath(); ctx.ellipse(0, 0, hl + cs * 0.12, hb + cs * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    }
    // casco
    ctx.beginPath();
    if (ship.type === 'submarino') {
      ctx.ellipse(0, 0, hl, hb, 0, 0, Math.PI * 2);
    } else {
      ctx.moveTo(-hl, -hb * 0.85);
      ctx.quadraticCurveTo(-hl - cs * 0.05, 0, -hl, hb * 0.85);
      ctx.lineTo(hl - cs * 0.55, hb);
      ctx.quadraticCurveTo(hl - cs * 0.1, hb * 0.7, hl, 0);
      ctx.quadraticCurveTo(hl - cs * 0.1, -hb * 0.7, hl - cs * 0.55, -hb);
      ctx.closePath();
    }
    const hg = ctx.createLinearGradient(0, -hb, 0, hb);
    if (ship.type === 'submarino') { hg.addColorStop(0, '#5b6670'); hg.addColorStop(1, '#2c343b'); }
    else { hg.addColorStop(0, '#a9b5be'); hg.addColorStop(1, '#5e6b75'); }
    ctx.fillStyle = ship.sunk ? '#3a2a24' : hg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,20,26,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();

    // cubierta
    ctx.fillStyle = ship.type === 'submarino' ? '#3c464e' : C.deck;
    if (ship.type !== 'submarino') {
      ctx.beginPath(); ctx.roundRect(-hl + cs * 0.15, -hb * 0.45, len - cs * 0.9, hb * 0.9, hb * 0.3); ctx.fill();
    }

    // detalles por tipo
    if (ship.type === 'acorazado') {
      [-hl + cs * 0.55, -hl + cs * 1.35, hl - cs * 1.25].forEach((px, i) => {
        ctx.fillStyle = '#56636d';
        ctx.beginPath(); ctx.arc(px, 0, hb * 0.42, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#2b343a'; ctx.lineWidth = Math.max(1.5, cs * 0.07);
        ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px + (i === 2 ? 1 : -1) * -cs * 0.0 + cs * 0.38, 0); ctx.stroke();
      });
      ctx.fillStyle = '#6f7c86';
      ctx.fillRect(-cs * 0.25, -hb * 0.35, cs * 0.5, hb * 0.7);
    } else if (ship.type === 'submarino') {
      ctx.fillStyle = '#20272d';
      ctx.beginPath(); ctx.roundRect(-cs * 0.32, -hb * 0.32, cs * 0.55, hb * 0.64, hb * 0.3); ctx.fill();
      ctx.strokeStyle = 'rgba(214,236,239,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-hl + cs * 0.3, 0); ctx.lineTo(hl - cs * 0.3, 0); ctx.stroke();
    } else if (ship.type === 'fragata') {
      ctx.fillStyle = '#6f7c86';
      ctx.fillRect(-cs * 0.5, -hb * 0.38, cs * 0.75, hb * 0.76);
      const a = t * 2.2;
      ctx.strokeStyle = C.sonar; ctx.lineWidth = Math.max(1.5, cs * 0.06);
      ctx.beginPath(); ctx.moveTo(-cs * 0.12 - Math.cos(a) * hb * 0.55, -Math.sin(a) * hb * 0.55); ctx.lineTo(-cs * 0.12 + Math.cos(a) * hb * 0.55, Math.sin(a) * hb * 0.55); ctx.stroke();
      ctx.fillStyle = C.sonar;
      ctx.beginPath(); ctx.arc(-cs * 0.12, 0, cs * 0.06, 0, Math.PI * 2); ctx.fill();
    } else if (ship.type === 'lancha') {
      ctx.fillStyle = C.brass;
      ctx.fillRect(-hl + cs * 0.2, -hb * 0.12, len - cs * 0.9, hb * 0.24);
      ctx.fillStyle = '#5a6670';
      ctx.beginPath(); ctx.roundRect(-cs * 0.15, -hb * 0.4, cs * 0.4, hb * 0.8, 3); ctx.fill();
    }
    ctx.restore();

    // daños
    ship.cells.forEach(c => {
      if (!c.hit || ship.sunk) return;
      const [px, py] = this.cellCenter(c.x, c.y);
      ctx.fillStyle = 'rgba(25,12,8,0.75)';
      ctx.beginPath(); ctx.arc(px, py, cs * 0.26, 0, Math.PI * 2); ctx.fill();
      const f = 0.7 + 0.3 * Math.sin(t * 14 + c.x * 5 + c.y * 3);
      ctx.fillStyle = `rgba(255,110,40,${f})`;
      ctx.beginPath(); ctx.moveTo(px - cs * 0.12, py + cs * 0.08); ctx.quadraticCurveTo(px, py - cs * 0.35 * f, px + cs * 0.12, py + cs * 0.08); ctx.fill();
      ctx.fillStyle = `rgba(255,220,120,${f})`;
      ctx.beginPath(); ctx.arc(px, py + cs * 0.03, cs * 0.06, 0, Math.PI * 2); ctx.fill();
    });
  };

  Renderer.prototype.drawDeployGhost = function (ctx) {
    const d = this.deployShip;
    const ship = { type: d.type, x: d.x, y: d.y, horiz: d.horiz, sunk: false, cells: M.shipCells(d.type, d.x, d.y, d.horiz).map(([x, y]) => ({ x, y, hit: false })) };
    ctx.save();
    ctx.globalAlpha = 0.75;
    this.drawShip(ctx, ship, 0, {});
    ctx.restore();
    ctx.strokeStyle = d.ok ? C.sonar : C.signal;
    ctx.lineWidth = 2;
    const n = ship.cells.length;
    ctx.strokeRect(this.ox + d.x * this.cs + 1, this.oy + d.y * this.cs + 1, (d.horiz ? n : 1) * this.cs - 2, (d.horiz ? 1 : n) * this.cs - 2);
  };

  Renderer.prototype.drawSonar = function (ctx, v, t) {
    if (!v.me) return;
    const cs = this.cs;
    v.me.sonar.forEach(s => {
      const age = v.round - s.round;
      if (age > 3) return;
      const a = 1 - age * 0.22;
      const x = this.ox + s.x * cs, y = this.oy + s.y * cs;
      ctx.strokeStyle = `rgba(116,217,196,${0.7 * a})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(x + 1, y + 1, 4 * cs - 2, 4 * cs - 2);
      ctx.setLineDash([]);
      ctx.fillStyle = `rgba(116,217,196,${0.08 * a})`;
      ctx.fillRect(x, y, 4 * cs, 4 * cs);
      const bw = cs * 0.95;
      ctx.fillStyle = `rgba(6,18,26,${0.9 * a})`;
      ctx.beginPath(); ctx.roundRect(x + 4 * cs - bw - 3, y + 3, bw, cs * 0.8, 4); ctx.fill();
      ctx.fillStyle = `rgba(116,217,196,${a})`;
      ctx.font = `600 ${Math.round(cs * 0.55)}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(s.count), x + 4 * cs - bw / 2 - 3, y + 3 + cs * 0.42);
    });
  };

  Renderer.prototype.emitSmoke = function (v, dt) {
    if (this.reduced) return;
    const S = v.size, cs = this.cs;
    const keys = Object.keys(v.markers);
    keys.forEach(ks => {
      const m = v.markers[ks];
      const rate = m.kind === 'smoke' ? 5 : m.kind === 'wreck' ? 0.6 : 0;
      if (!rate || Math.random() > rate * dt) return;
      const k = +ks, [cx, cy] = this.cellCenter(k % S, (k / S) | 0);
      this.particles.push({ x: cx + (Math.random() - 0.5) * cs * 0.2, y: cy, vx: 6 + Math.random() * 6, vy: -(10 + Math.random() * 14), r: cs * 0.12, grow: cs * 0.35, life: 2 + Math.random() * 1.2, age: 0, kind: 'smoke' });
    });
    if (this.particles.length > 700) this.particles.splice(0, this.particles.length - 700);
  };

  Renderer.prototype.drawParticles = function (ctx, dt) {
    const keep = [];
    this.particles.forEach(p => {
      p.age += dt;
      if (p.age > p.life) return;
      p.x += p.vx * dt; p.y += p.vy * dt;
      const k = p.age / p.life;
      if (p.kind === 'smoke') {
        const r = p.r + p.grow * k;
        ctx.fillStyle = `rgba(28,30,34,${0.42 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'spark') {
        p.vy += 40 * dt;
        ctx.fillStyle = `rgba(255,${180 - 120 * k | 0},60,${1 - k})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - k * 0.5), 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'drop') {
        p.vy += 160 * dt;
        ctx.fillStyle = `rgba(214,236,239,${1 - k})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'bubble') {
        ctx.strokeStyle = `rgba(214,236,239,${0.6 * (1 - k)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
      }
      keep.push(p);
    });
    this.particles = keep;
  };

  Renderer.prototype.drawFog = function (ctx, v, t) {
    const cs = this.cs;
    const draw = (f, mine) => {
      const x = this.ox + f.x * cs, y = this.oy + f.y * cs;
      ctx.save();
      ctx.beginPath(); ctx.rect(x - cs * 0.4, y - cs * 0.4, 3 * cs + cs * 0.8, 3 * cs + cs * 0.8); ctx.clip();
      for (let i = 0; i < 9; i++) {
        const px = x + ((i % 3) + 0.5) * cs + Math.sin(t * 0.6 + i) * cs * 0.15;
        const py = y + (((i / 3) | 0) + 0.5) * cs + Math.cos(t * 0.5 + i) * cs * 0.15;
        ctx.fillStyle = mine ? 'rgba(200,210,220,0.12)' : 'rgba(170,182,192,0.82)';
        ctx.beginPath(); ctx.arc(px, py, cs * 0.85, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      if (mine) {
        ctx.strokeStyle = 'rgba(200,210,220,0.6)'; ctx.setLineDash([4, 4]);
        ctx.strokeRect(x, y, 3 * cs, 3 * cs); ctx.setLineDash([]);
      }
    };
    v.fogs.forEach(f => draw(f, false));
    (v.myFogs || []).forEach(f => draw(f, true));
  };

  Renderer.prototype.drawPending = function (ctx, t) {
    const p = this.pending;
    if (!p) return;
    const cs = this.cs;
    const pulse = 0.6 + 0.4 * Math.sin(t * 5);
    ctx.strokeStyle = `rgba(224,170,69,${pulse})`;
    ctx.lineWidth = 2;
    (p.cells || []).forEach(([x, y]) => {
      const [cx, cy] = this.cellCenter(x, y);
      crosshair(ctx, cx, cy, cs * 0.36);
    });
    if (p.path && p.path.length) {
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      p.path.forEach(([x, y], i) => { const [cx, cy] = this.cellCenter(x, y); if (i) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (p.area) {
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(this.ox + p.area.x * cs, this.oy + p.area.y * cs, p.area.w * cs, p.area.h * cs);
      ctx.setLineDash([]);
    }
  };

  Renderer.prototype.drawPreview = function (ctx, t) {
    const p = this.preview;
    if (!p) return;
    const cs = this.cs;
    const col = p.color || C.brass;
    if (p.area) {
      ctx.fillStyle = hexA(col, 0.14);
      ctx.fillRect(this.ox + p.area.x * cs, this.oy + p.area.y * cs, p.area.w * cs, p.area.h * cs);
      ctx.strokeStyle = hexA(col, 0.9); ctx.lineWidth = 1.5;
      ctx.strokeRect(this.ox + p.area.x * cs + 0.5, this.oy + p.area.y * cs + 0.5, p.area.w * cs - 1, p.area.h * cs - 1);
    }
    if (p.path) {
      ctx.strokeStyle = hexA(col, 0.8); ctx.lineWidth = 2; ctx.setLineDash([2, 4]);
      ctx.beginPath();
      p.path.forEach(([x, y], i) => { const [cx, cy] = this.cellCenter(x, y); if (i) ctx.lineTo(cx, cy); else ctx.moveTo(cx, cy); });
      ctx.stroke(); ctx.setLineDash([]);
    }
    (p.cells || []).forEach(([x, y]) => {
      ctx.fillStyle = hexA(col, 0.18);
      ctx.fillRect(this.ox + x * cs, this.oy + y * cs, cs, cs);
      ctx.strokeStyle = hexA(col, 0.95); ctx.lineWidth = 1.5;
      const [cx, cy] = this.cellCenter(x, y);
      crosshair(ctx, cx, cy, cs * 0.34);
    });
  };

  function crosshair(ctx, cx, cy, r) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - r * 1.35, cy); ctx.lineTo(cx - r * 0.45, cy);
    ctx.moveTo(cx + r * 0.45, cy); ctx.lineTo(cx + r * 1.35, cy);
    ctx.moveTo(cx, cy - r * 1.35); ctx.lineTo(cx, cy - r * 0.45);
    ctx.moveTo(cx, cy + r * 0.45); ctx.lineTo(cx, cy + r * 1.35);
    ctx.stroke();
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  Renderer.prototype.drawEffects = function (ctx, t) {
    const cs = this.cs, keep = [];
    this.effects.forEach(e => {
      const k = (t - e.t0) / e.dur;
      if (k < 0) { keep.push(e); return; }
      if (k > 1) return;
      keep.push(e);
      const [cx, cy] = e.x != null ? this.cellCenter(e.x, e.y) : [0, 0];
      if (e.type === 'explosion') {
        ctx.fillStyle = `rgba(255,235,180,${Math.max(0, 1 - k * 3)})`;
        ctx.beginPath(); ctx.arc(cx, cy, cs * (0.2 + k * 1.2), 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(255,90,60,${1 - k})`; ctx.lineWidth = 3 * (1 - k);
        ctx.beginPath(); ctx.arc(cx, cy, cs * (0.3 + k * 1.6), 0, Math.PI * 2); ctx.stroke();
      } else if (e.type === 'splash') {
        ctx.strokeStyle = `rgba(214,236,239,${1 - k})`; ctx.lineWidth = 2 * (1 - k);
        ctx.beginPath(); ctx.arc(cx, cy, cs * (0.15 + k * 0.9), 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, cs * (0.05 + k * 0.5), 0, Math.PI * 2); ctx.stroke();
      } else if (e.type === 'deflect') {
        ctx.strokeStyle = `rgba(124,196,255,${1 - k})`; ctx.lineWidth = 3;
        hexPath(ctx, cx, cy, cs * (0.3 + k * 0.5)); ctx.stroke();
      } else if (e.type === 'sonar') {
        const x = this.ox + e.x * cs, y = this.oy + e.y * cs;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, 4 * cs, 4 * cs); ctx.clip();
        ctx.strokeStyle = `rgba(116,217,196,${1 - k})`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x + 2 * cs, y + 2 * cs, k * cs * 3, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      } else if (e.type === 'torpedo') {
        const pts = e.path.map(([x, y]) => this.cellCenter(x, y));
        if (e.from) pts.unshift(this.cellCenter(e.from[0], e.from[1]));
        const upto = Math.max(1, Math.ceil(pts.length * Math.min(1, k * 1.4)));
        ctx.strokeStyle = `rgba(214,236,239,${0.8 * (1 - k * 0.6)})`; ctx.lineWidth = 2;
        ctx.beginPath();
        pts.slice(0, upto).forEach(([px, py], i) => { if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
        ctx.stroke();
        const [hx, hy] = pts[upto - 1] || [0, 0];
        ctx.fillStyle = C.foam;
        ctx.beginPath(); ctx.arc(hx, hy, cs * 0.1, 0, Math.PI * 2); ctx.fill();
        if (Math.random() < 0.6) this.particles.push({ x: hx + (Math.random() - 0.5) * 6, y: hy + (Math.random() - 0.5) * 6, vx: 0, vy: -4, r: 1.5 + Math.random() * 2, life: 0.7, age: 0, kind: 'bubble' });
      } else if (e.type === 'crate' || e.type === 'repair') {
        ctx.strokeStyle = e.type === 'crate' ? `rgba(224,170,69,${1 - k})` : `rgba(116,217,196,${1 - k})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy - k * cs * 0.6, cs * (0.3 + k * 0.4), 0, Math.PI * 2); ctx.stroke();
      } else if (e.type === 'blip') {
        ctx.strokeStyle = e.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2;
        ctx.strokeRect(cx - cs * 0.45, cy - cs * 0.45, cs * 0.9, cs * 0.9);
        ctx.globalAlpha = 1;
      }
    });
    this.effects = keep;
  };

  Renderer.prototype.drawLabels = function (ctx, v) {
    const S = v.size, cs = this.cs, ox = this.ox, oy = this.oy;
    const fs = Math.max(8, Math.round(cs * 0.42));
    ctx.font = `500 ${fs}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < S; i++) {
      const hot = this.hover && (this.hover[0] === i);
      ctx.fillStyle = hot ? C.brass : 'rgba(214,236,239,0.45)';
      ctx.fillText(M.LETTERS[i], ox + (i + 0.5) * cs, oy - cs * 0.5);
      const hotR = this.hover && (this.hover[1] === i);
      ctx.fillStyle = hotR ? C.brass : 'rgba(214,236,239,0.45)';
      ctx.fillText(String(i + 1), ox - cs * 0.55, oy + (i + 0.5) * cs);
    }
    if (this.hover && !this.preview && this.mode !== 'deploy') {
      const [x, y] = this.hover;
      ctx.strokeStyle = 'rgba(224,170,69,0.55)'; ctx.lineWidth = 1;
      ctx.strokeRect(ox + x * cs + 0.5, oy + y * cs + 0.5, cs - 1, cs - 1);
    }
    ctx.strokeStyle = 'rgba(224,170,69,0.4)'; ctx.lineWidth = 1;
    ctx.strokeRect(ox - 0.5, oy - 0.5, S * cs + 1, S * cs + 1);
  };

  root.MDF.Renderer = Renderer;
  root.MDF.COLORS_UI = C;
})(window);
