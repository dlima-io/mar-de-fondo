/* Mar de Fondo — bots para el modo práctica.
   Solo usan la información que vería un jugador (viewFor). */
(function (root) {
  'use strict';
  const M = root.MDF;

  function decide(view, rand) {
    const S = view.size, me = view.me;
    const K = (x, y) => y * S + x;
    const isl = new Set(view.islands);
    const mk = view.markers;

    if (!me.alive) {
      const smokes = Object.keys(mk).filter(k => mk[k].kind === 'smoke');
      const k = smokes.length && rand() < 0.7 ? +M.pick(smokes, rand) : Math.floor(rand() * S * S);
      return { type: 'fog', x: k % S, y: Math.floor(k / S) };
    }

    const own = new Set();
    let damaged = false, subDamaged = false;
    me.ships.forEach(s => s.cells.forEach(c => {
      own.add(K(c.x, c.y));
      if (c.hit && !s.sunk) { damaged = true; if (s.type === 'submarino') subDamaged = true; }
    }));
    const known = k => mk[k] || isl.has(k) || own.has(k);
    const ready = ab => {
      const ship = me.ships.find(s => s.type === M.ABILITIES[ab].ship);
      return ship && !ship.sunk && me.cooldowns[ab] === 0;
    };
    const inB = (x, y) => x >= 0 && y >= 0 && x < S && y < S;

    // casillas candidatas alrededor de humo ajeno
    const score = new Map();
    const add = (x, y, v) => {
      if (!inB(x, y)) return;
      const k = K(x, y);
      if (known(k)) return;
      score.set(k, (score.get(k) || 0) + v);
    };
    const enemySmoke = (x, y) => inB(x, y) && mk[K(x, y)] && mk[K(x, y)].kind === 'smoke' && !own.has(K(x, y));
    Object.keys(mk).forEach(ks => {
      const k = +ks, m = mk[k], x = k % S, y = Math.floor(k / S);
      if (own.has(k)) return;
      if (m.kind === 'deflect') { score.set(k, (score.get(k) || 0) + 5); return; }
      if (m.kind !== 'smoke') return;
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([dx, dy]) => {
        add(x + dx, y + dy, 2);
        if (enemySmoke(x - dx, y - dy)) add(x + dx, y + dy, 3);
      });
    });
    me.sonar.forEach(s => {
      if (view.round - s.round > 4 || !s.count) return;
      const cells = M.areaCells(view, s.x, s.y, 4, 4).filter(([x, y]) => !known(K(x, y)));
      cells.forEach(([x, y]) => add(x, y, (s.count / Math.max(1, cells.length)) * 4));
    });

    let best = null, bestScore = 0;
    score.forEach((v, k) => { const j = v + rand() * 0.5; if (j > bestScore) { bestScore = j; best = k; } });

    // defensa
    if (damaged && me.wilds.includes('reparacion') && rand() < 0.7) return { type: 'wild', wild: 'reparacion' };
    if (damaged && me.wilds.includes('escudo') && me.shield === 0 && rand() < 0.6) return { type: 'wild', wild: 'escudo' };
    if (subDamaged && ready('inmersion') && rand() < 0.4) return { type: 'inmersion' };
    if (me.wilds.includes('humo') && me.smokeScreen === 0 && rand() < 0.2) return { type: 'wild', wild: 'humo' };

    if (best != null && bestScore >= 1.5) {
      const x = best % S, y = Math.floor(best / S);
      if (ready('salva') && rand() < 0.75) return { type: 'salva', x, y };
      if (me.wilds.includes('misil') && rand() < 0.5) return { type: 'wild', wild: 'misil', x: Math.max(0, x - (rand() < 0.5 ? 1 : 0)), y: Math.max(0, y - (rand() < 0.5 ? 1 : 0)) };
      return { type: 'shot', x, y };
    }

    if (ready('sonar') && rand() < 0.8) {
      let bx = 0, by = 0, bs = -1e9;
      for (let t = 0; t < 40; t++) {
        const x = Math.floor(rand() * (S - 3)), y = Math.floor(rand() * (S - 3));
        let s = 0;
        M.areaCells(view, x, y, 4, 4).forEach(([cx, cy]) => { const k = K(cx, cy); if (own.has(k)) s -= 4; else if (!known(k)) s += 1; });
        if (s > bs) { bs = s; bx = x; by = y; }
      }
      return { type: 'sonar', x: bx, y: by };
    }

    if (view.crates.length && rand() < 0.55) {
      const c = M.pick(view.crates, rand);
      return { type: 'shot', x: c.x, y: c.y };
    }

    if (ready('torpedo') && rand() < 0.3) return { type: 'torpedo', dir: M.pick(['up', 'down', 'left', 'right'], rand) };

    // disparo al azar, en damero y lejos de la propia flota
    let bx = 0, by = 0, bs = -1e9;
    for (let t = 0; t < 80; t++) {
      const x = Math.floor(rand() * S), y = Math.floor(rand() * S);
      const k = K(x, y);
      if (known(k)) continue;
      let s = rand();
      if ((x + y) % 2 === 0) s += 1;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => own.has(K(x + dx, y + dy)));
      if (near) s -= 2;
      if (M.inStorm(view, x, y, view.storm)) s -= 0.5;
      if (s > bs) { bs = s; bx = x; by = y; }
    }
    return { type: 'shot', x: bx, y: by };
  }

  /* ---------- chat de los bots ---------- */
  const LINES = {
    start: ['Que gane el mejor. O sea, yo.', 'Tengo café y tengo torpedos.', 'Nadie toque mi lancha.', 'Arranquemos que a las 16 tengo daily.'],
    hitMe: ['¡Ey! ¿Quién fue?', 'Eso dolió.', 'Ya sé quién fue. Bueno, no, pero sospecho.', 'Me están cazando, avisen.'],
    sunkMe: ['Mi pobre {ship}...', 'Descansá en paz, {ship}.', 'Esto no queda así.'],
    sunkOther: ['Uno menos 😎', '¿Alguien vio ese humo? Era mío.', 'Ese fue mi tiro, que conste en actas.'],
    crate: ['¡Caja para mí!', 'Gracias, logística.', 'Me tocó algo lindo.'],
    random: ['Hay mucho humo en el centro...', '¿Alianza contra el que va ganando?', 'Estoy tirando con los ojos cerrados.', 'Jajaja qué caos.', 'Alguien está muy callado...', 'Ojo con la tormenta.'],
    buzzed: ['¡Ya va, ya va!', 'Perdón, estaba en una call.', 'Estoy, estoy.', 'Che, no me zumbes que me asusto.', 'Volví, volví.'],
    buzzHuman: ['Dale {name}, que nos dormimos.', '{name}, ¿seguís ahí?', 'Despertate {name} 😴'],
    eliminated: ['Me hundieron todo. Ahora soy un fantasma y tengo niebla.', 'GG. Voy a molestar desde el más allá.'],
    dm: ['Trato hecho. Por ahora 😏', '¿Y yo qué gano?', 'Vi humo cerca de {coord}, te lo regalo.', 'Ok, no te tiro. Esta ronda.', 'Mmm, lo pienso.', 'No confío en nadie, pero dale.', 'Si me traicionás te zumbo toda la tarde.'],
  };
  function line(kind, rand, vars) {
    let s = M.pick(LINES[kind], rand);
    Object.keys(vars || {}).forEach(k => { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }

  root.MDF.Bots = { decide, line };
})(typeof window !== 'undefined' ? window : globalThis);
