/* Mar de Fondo — motor de reglas.
   Funciones puras sobre un objeto de estado serializable (salvo game.rand).
   Pensado para correr igual en el navegador (modo práctica) o en una función
   en la nube (modo online): recibe las órdenes de la ronda y devuelve eventos. */
(function (root) {
  'use strict';

  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  const SHIP_DEFS = {
    acorazado: { name: 'Acorazado', size: 4 },
    submarino: { name: 'Submarino', size: 3 },
    fragata: { name: 'Fragata radar', size: 3 },
    lancha: { name: 'Lancha rápida', size: 2 },
  };
  const FLEET = ['acorazado', 'submarino', 'fragata', 'lancha'];

  const ABILITIES = {
    salva: { name: 'Salva en cruz', ship: 'acorazado', cd: 3, target: 'cross', desc: '5 casillas en cruz' },
    torpedo: { name: 'Torpedo', ship: 'submarino', cd: 2, target: 'dir', desc: 'En línea hasta chocar' },
    inmersion: { name: 'Inmersión', ship: 'submarino', cd: 3, target: 'none', desc: 'Inmune esta ronda' },
    sonar: { name: 'Sonar', ship: 'fragata', cd: 2, target: 'area4', desc: 'Cuenta barcos en 4x4' },
  };

  const WILDS = {
    escudo: { name: 'Escudo deflector', target: 'none', desc: 'Frena el próximo impacto' },
    reparacion: { name: 'Reparación', target: 'none', desc: 'Arregla una casilla' },
    humo: { name: 'Cortina de humo', target: 'none', desc: 'Invisible al sonar 3 rondas' },
    misil: { name: 'Misil 2x2', target: 'area2', desc: 'Golpea una zona de 2x2' },
  };
  const WILD_KEYS = Object.keys(WILDS);
  const MAX_WILDS = 3;

  const COLORS = ['#f2b134', '#53c6dc', '#ee6f5c', '#9bd36a', '#c49af2', '#f59ac6'];

  const STORM_START = 10;   // primera ronda con tormenta
  const STORM_EVERY = 3;    // rondas entre cada avance
  const CRATE_EVERY = 4;    // cada cuántas rondas cae una caja
  const CRATE_FIRST = 3;    // primera ronda con caja

  const key = (x, y, S) => y * S + x;
  const coord = (x, y) => LETTERS[x] + '-' + (y + 1);

  function makeRand(seed) {
    let s = (seed >>> 0) || 0x9e3779b9;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }
  const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /* ---------- creación ---------- */

  function createGame(opts) {
    const rand = makeRand(opts.seed || Date.now());
    const n = opts.players.length;
    const size = n <= 4 ? 20 : 24;
    const cols = n <= 4 ? 2 : 3;
    const rows = 2;
    const sw = size / cols, sh = size / rows;
    const sectors = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        sectors.push({ x: c * sw, y: r * sh, w: sw, h: sh });
    shuffle(sectors, rand);

    const game = {
      size,
      round: 0,
      phase: 'deploy',
      roundSeconds: opts.roundSeconds || 25,
      islands: [],
      markers: {},       // k -> { kind: splash|smoke|wreck|deflect, round }
      crates: [],        // { id, x, y }
      fogs: [],          // { x, y, by, until }
      nextCrateId: 1,
      winner: null,
      players: opts.players.map((p, i) => ({
        id: p.id,
        name: p.name,
        isBot: !!p.isBot,
        color: COLORS[i % COLORS.length],
        sector: sectors[i],
        ships: [],
        alive: true,
        ghost: false,
        cooldowns: { salva: 0, torpedo: 0, inmersion: 0, sonar: 0 },
        wilds: [],
        shield: 0,
        smokeScreen: 0,
        diving: false,
        sonar: [],
        stats: { shots: 0, hits: 0, sinks: 0, place: 0 },
      })),
    };
    Object.defineProperty(game, 'rand', { value: rand, enumerable: false, writable: true });
    generateIslands(game);
    return game;
  }

  function generateIslands(game) {
    const S = game.size, rand = game.rand;
    const set = new Set();
    const target = Math.round(S * S * 0.045);
    const clusters = Math.round(S / 3.2);
    const seeds = [];
    for (let i = 0; i < clusters; i++) {
      const x = 2 + Math.floor(rand() * (S - 4));
      const y = 2 + Math.floor(rand() * (S - 4));
      seeds.push([x, y]);
      set.add(key(x, y, S));
    }
    let guard = 0;
    while (set.size < target && guard++ < 5000) {
      const [sx, sy] = pick(seeds, rand);
      const arr = [...set].filter(k => Math.abs((k % S) - sx) + Math.abs(Math.floor(k / S) - sy) < 4);
      const k = pick(arr.length ? arr : [key(sx, sy, S)], rand);
      const x = k % S + Math.round(rand() * 2 - 1);
      const y = Math.floor(k / S) + Math.round(rand() * 2 - 1);
      if (x >= 1 && y >= 1 && x < S - 1 && y < S - 1) set.add(key(x, y, S));
    }
    game.islands = [...set];
  }

  /* ---------- despliegue ---------- */

  function shipCells(type, x, y, horiz) {
    const n = SHIP_DEFS[type].size, cells = [];
    for (let i = 0; i < n; i++) cells.push(horiz ? [x + i, y] : [x, y + i]);
    return cells;
  }

  function canPlace(game, pid, type, x, y, horiz) {
    const p = getPlayer(game, pid), S = game.size, sec = p.sector;
    const isl = islandSet(game);
    const taken = new Set();
    p.ships.forEach(s => { if (s.type !== type) s.cells.forEach(c => taken.add(key(c.x, c.y, S))); });
    return shipCells(type, x, y, horiz).every(([cx, cy]) =>
      cx >= sec.x && cy >= sec.y && cx < sec.x + sec.w && cy < sec.y + sec.h &&
      !isl.has(key(cx, cy, S)) && !taken.has(key(cx, cy, S)));
  }

  function placeShip(game, pid, type, x, y, horiz) {
    if (!canPlace(game, pid, type, x, y, horiz)) return false;
    const p = getPlayer(game, pid);
    p.ships = p.ships.filter(s => s.type !== type);
    p.ships.push({
      type, x, y, horiz, sunk: false,
      cells: shipCells(type, x, y, horiz).map(([cx, cy]) => ({ x: cx, y: cy, hit: false, hitRound: -1 })),
    });
    p.ships.sort((a, b) => FLEET.indexOf(a.type) - FLEET.indexOf(b.type));
    return true;
  }

  function placeRandom(game, pid, onlyMissing) {
    const p = getPlayer(game, pid), sec = p.sector, rand = game.rand;
    if (!onlyMissing) p.ships = [];
    for (const type of FLEET) {
      if (p.ships.some(s => s.type === type)) continue;
      for (let t = 0; t < 800; t++) {
        const horiz = rand() < 0.5;
        const x = sec.x + Math.floor(rand() * sec.w);
        const y = sec.y + Math.floor(rand() * sec.h);
        if (placeShip(game, pid, type, x, y, horiz)) break;
      }
    }
  }

  function startBattle(game) {
    game.players.forEach(p => { if (p.ships.length < FLEET.length) placeRandom(game, p.id, true); });
    game.phase = 'battle';
    game.round = 1;
  }

  /* ---------- consultas ---------- */

  function getPlayer(game, pid) { return game.players.find(p => p.id === pid); }
  function islandSet(game) {
    if (!game._isl || game._islSrc !== game.islands) {
      Object.defineProperty(game, '_isl', { value: new Set(game.islands), enumerable: false, writable: true, configurable: true });
      Object.defineProperty(game, '_islSrc', { value: game.islands, enumerable: false, writable: true, configurable: true });
    }
    return game._isl;
  }

  function occupancy(game) {
    const S = game.size, m = new Map();
    game.players.forEach(p => p.ships.forEach((s, si) => s.cells.forEach((c, ci) =>
      m.set(key(c.x, c.y, S), { pid: p.id, si, ci }))));
    return m;
  }

  function shipOf(p, type) { return p.ships.find(s => s.type === type); }

  function canUse(game, pid, ability) {
    const p = getPlayer(game, pid);
    if (!p || !p.alive) return false;
    const ab = ABILITIES[ability];
    const ship = shipOf(p, ab.ship);
    return !!ship && !ship.sunk && p.cooldowns[ability] === 0;
  }

  function stormLevel(game, round) {
    const r = round == null ? game.round : round;
    if (r < STORM_START) return 0;
    const maxL = Math.ceil(game.size / 2);
    return Math.min(maxL, 1 + Math.floor((r - STORM_START) / STORM_EVERY));
  }
  function inStorm(game, x, y, level) {
    const S = game.size;
    return Math.min(x, y, S - 1 - x, S - 1 - y) < level;
  }

  function areaCells(game, x, y, w, h) {
    const out = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const cx = x + i, cy = y + j;
      if (cx >= 0 && cy >= 0 && cx < game.size && cy < game.size) out.push([cx, cy]);
    }
    return out;
  }
  function crossCells(game, x, y) {
    return [[x, y], [x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
      .filter(([cx, cy]) => cx >= 0 && cy >= 0 && cx < game.size && cy < game.size);
  }
  function clampArea(game, x, y, w) {
    const S = game.size;
    return [Math.max(0, Math.min(S - w, x)), Math.max(0, Math.min(S - w, y))];
  }

  /* recorrido del torpedo: no daña a la propia flota ni a restos hundidos */
  function torpedoPath(game, pid, dir) {
    const p = getPlayer(game, pid), S = game.size;
    const sub = shipOf(p, 'submarino');
    if (!sub) return { path: [], impact: null };
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    if (!d) return { path: [], impact: null };
    let best = sub.cells[0];
    sub.cells.forEach(c => { if (c.x * d[0] + c.y * d[1] > best.x * d[0] + best.y * d[1]) best = c; });
    const occ = occupancy(game), isl = islandSet(game);
    const path = [];
    let x = best.x + d[0], y = best.y + d[1];
    while (x >= 0 && y >= 0 && x < S && y < S) {
      const k = key(x, y, S);
      path.push([x, y]);
      if (isl.has(k)) return { path, impact: null, rock: [x, y] };
      const o = occ.get(k);
      if (o && o.pid !== pid) {
        const ship = getPlayer(game, o.pid).ships[o.si];
        if (!ship.sunk) return { path, impact: [x, y] };
      }
      x += d[0]; y += d[1];
    }
    return { path, impact: null };
  }

  function torpedoDirFromCell(game, pid, x, y) {
    const sub = shipOf(getPlayer(game, pid), 'submarino');
    if (!sub) return null;
    const cx = sub.cells.reduce((a, c) => a + c.x, 0) / sub.cells.length;
    const cy = sub.cells.reduce((a, c) => a + c.y, 0) / sub.cells.length;
    const dx = x - cx, dy = y - cy;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return null;
    return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  }

  /* valida una orden; devuelve la orden normalizada o null */
  function validateOrder(game, pid, o) {
    const p = getPlayer(game, pid);
    if (!o || !p) return null;
    const S = game.size;
    const inB = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < S && y < S;
    if (!p.alive) {
      if (p.ghost && o.type === 'fog' && inB(o.x, o.y)) return { type: 'fog', ...pos(clampArea(game, o.x - 1, o.y - 1, 3)) };
      return null;
    }
    switch (o.type) {
      case 'shot': return inB(o.x, o.y) ? { type: 'shot', x: o.x, y: o.y } : null;
      case 'salva': return canUse(game, pid, 'salva') && inB(o.x, o.y) ? { type: 'salva', x: o.x, y: o.y } : null;
      case 'torpedo': return canUse(game, pid, 'torpedo') && ['up', 'down', 'left', 'right'].includes(o.dir) ? { type: 'torpedo', dir: o.dir } : null;
      case 'inmersion': return canUse(game, pid, 'inmersion') ? { type: 'inmersion' } : null;
      case 'sonar': return canUse(game, pid, 'sonar') && inB(o.x, o.y) ? { type: 'sonar', ...pos(clampArea(game, o.x, o.y, 4)) } : null;
      case 'wild': {
        if (!p.wilds.includes(o.wild)) return null;
        if (o.wild === 'misil') return inB(o.x, o.y) ? { type: 'wild', wild: 'misil', ...pos(clampArea(game, o.x, o.y, 2)) } : null;
        return { type: 'wild', wild: o.wild };
      }
      case 'pass': return { type: 'pass' };
    }
    return null;
  }
  const pos = ([x, y]) => ({ x, y });

  /* ---------- resolución de una ronda ---------- */

  function resolveRound(game, rawOrders) {
    const S = game.size, rand = game.rand, r = game.round;
    const events = [];
    const isl = islandSet(game);
    const orders = {};
    game.players.forEach(p => { orders[p.id] = validateOrder(game, p.id, rawOrders[p.id]); });

    const occ = occupancy(game);
    const sunkAtStart = new Set();
    game.players.forEach(p => p.ships.forEach((s, si) => { if (s.sunk) sunkAtStart.add(p.id + ':' + si); }));
    const removeWild = (p, w) => { const i = p.wilds.indexOf(w); if (i >= 0) p.wilds.splice(i, 1); };

    // 1. acciones defensivas e información
    game.players.forEach(p => {
      const o = orders[p.id];
      if (!o) return;
      if (o.type === 'inmersion') {
        p.diving = true; p.cooldowns.inmersion = ABILITIES.inmersion.cd + 1;
        events.push({ type: 'dive', pid: p.id, private: true });
      } else if (o.type === 'wild' && o.wild === 'escudo') {
        p.shield += 1; removeWild(p, 'escudo');
        events.push({ type: 'shieldUp', pid: p.id, private: true });
      } else if (o.type === 'wild' && o.wild === 'humo') {
        p.smokeScreen = 3; removeWild(p, 'humo');
        events.push({ type: 'smokeUp', pid: p.id, private: true });
      } else if (o.type === 'wild' && o.wild === 'reparacion') {
        removeWild(p, 'reparacion');
        const c = repairOne(game, p);
        events.push({ type: 'repair', pid: p.id, x: c && c.x, y: c && c.y, ok: !!c, private: true });
      } else if (o.type === 'sonar') {
        p.cooldowns.sonar = ABILITIES.sonar.cd + 1;
        let count = 0;
        areaCells(game, o.x, o.y, 4, 4).forEach(([cx, cy]) => {
          const oc = occ.get(key(cx, cy, S));
          if (!oc || oc.pid === p.id) return;
          const owner = getPlayer(game, oc.pid);
          if (owner.smokeScreen > 0 || owner.ships[oc.si].sunk) return;
          count++;
        });
        p.sonar.push({ x: o.x, y: o.y, w: 4, h: 4, count, round: r });
        if (p.sonar.length > 6) p.sonar.shift();
        events.push({ type: 'sonar', pid: p.id, x: o.x, y: o.y, count, private: true });
      } else if (o.type === 'fog') {
        game.fogs.push({ x: o.x, y: o.y, by: p.id, until: r + 1 });
        events.push({ type: 'fog', pid: p.id, x: o.x, y: o.y });
      }
    });

    // 2. ataques simultáneos
    const attacks = [];
    game.players.forEach(p => {
      const o = orders[p.id];
      if (!o) return;
      if (o.type === 'shot') attacks.push({ pid: p.id, kind: 'shot', cells: [[o.x, o.y]] });
      else if (o.type === 'salva') {
        p.cooldowns.salva = ABILITIES.salva.cd + 1;
        attacks.push({ pid: p.id, kind: 'salva', cells: crossCells(game, o.x, o.y), center: [o.x, o.y] });
      } else if (o.type === 'wild' && o.wild === 'misil') {
        removeWild(p, 'misil');
        attacks.push({ pid: p.id, kind: 'misil', cells: areaCells(game, o.x, o.y, 2, 2), center: [o.x, o.y] });
      } else if (o.type === 'torpedo') {
        p.cooldowns.torpedo = ABILITIES.torpedo.cd + 1;
        const t = torpedoPath(game, p.id, o.dir);
        events.push({ type: 'torpedo', pid: p.id, path: t.path, impact: t.impact });
        attacks.push({ pid: p.id, kind: 'torpedo', cells: t.impact ? [t.impact] : [], sweep: t.path });
      }
    });

    const hitters = new Map();     // 'pid:si' -> Set(attacker)
    const crateClaims = new Map(); // crateId -> Set(pid)
    const crateAt = new Map(game.crates.map(c => [key(c.x, c.y, S), c]));
    const claim = (k, pid) => {
      const c = crateAt.get(k);
      if (!c) return;
      if (!crateClaims.has(c.id)) crateClaims.set(c.id, new Set());
      crateClaims.get(c.id).add(pid);
    };

    shuffle(attacks, rand).forEach(a => {
      const attacker = getPlayer(game, a.pid);
      attacker.stats.shots++;
      (a.sweep || []).forEach(([x, y]) => claim(key(x, y, S), a.pid));
      a.cells.forEach(([x, y]) => {
        const k = key(x, y, S);
        claim(k, a.pid);
        if (isl.has(k)) { events.push({ type: 'rock', x, y, by: a.pid, kind: a.kind }); return; }
        const o = occ.get(k);
        if (!o || sunkAtStart.has(o.pid + ':' + o.si)) {
          if (!o) setMarker(game, k, 'splash', r);
          events.push({ type: 'miss', x, y, by: a.pid, kind: a.kind });
          return;
        }
        const owner = getPlayer(game, o.pid);
        const ship = owner.ships[o.si];
        const cell = ship.cells[o.ci];
        if (ship.type === 'submarino' && owner.diving) {
          if (!cell.hit) setMarker(game, k, 'splash', r);
          events.push({ type: 'miss', x, y, by: a.pid, kind: a.kind, dodged: o.pid });
          return;
        }
        if (cell.hit) {
          if (cell.hitRound === r) addHitter(hitters, o, a.pid);
          events.push({ type: 'rehit', x, y, by: a.pid, kind: a.kind });
          return;
        }
        if (owner.shield > 0) {
          owner.shield--;
          setMarker(game, k, 'deflect', r);
          events.push({ type: 'deflect', x, y, by: a.pid, owner: o.pid, kind: a.kind });
          return;
        }
        cell.hit = true; cell.hitRound = r;
        setMarker(game, k, 'smoke', r);
        addHitter(hitters, o, a.pid);
        if (o.pid !== a.pid) attacker.stats.hits++;
        events.push({ type: 'hit', x, y, by: a.pid, owner: o.pid, ship: ship.type, kind: a.kind });
      });
    });

    // 3. hundimientos y recompensas
    checkSinks(game, hitters, events, r);

    // 4. cajas de suministros
    crateClaims.forEach((set, id) => {
      const crate = game.crates.find(c => c.id === id);
      const pids = [...set];
      const winner = getPlayer(game, pick(pids, rand));
      game.crates = game.crates.filter(c => c.id !== id);
      if (winner.wilds.length < MAX_WILDS) {
        const w = pick(WILD_KEYS, rand);
        winner.wilds.push(w);
        events.push({ type: 'crate', pid: winner.id, wild: w, x: crate.x, y: crate.y });
      } else {
        events.push({ type: 'crate', pid: winner.id, wild: null, x: crate.x, y: crate.y });
      }
    });

    // 5. tormenta
    const level = stormLevel(game, r);
    if (level > 0) {
      const stormHitters = new Map();
      game.players.forEach(p => {
        if (!p.alive) return;
        p.ships.forEach((s, si) => {
          if (s.sunk || (s.type === 'submarino' && p.diving)) return;
          const exposed = s.cells.filter(c => !c.hit && inStorm(game, c.x, c.y, level));
          if (!exposed.length) return;
          const c = pick(exposed, rand);
          c.hit = true; c.hitRound = r;
          setMarker(game, key(c.x, c.y, S), 'smoke', r);
          stormHitters.set(p.id + ':' + si, new Set());
          events.push({ type: 'stormHit', x: c.x, y: c.y, owner: p.id, ship: s.type });
        });
      });
      checkSinks(game, stormHitters, events, r, true);
    }

    // 6. eliminaciones
    const aliveBefore = game.players.filter(p => p.alive).length;
    const fallen = [];
    game.players.forEach(p => {
      if (p.alive && p.ships.every(s => s.sunk)) {
        p.alive = false; p.ghost = true; fallen.push(p);
        events.push({ type: 'eliminated', pid: p.id });
      }
    });
    fallen.forEach(p => { p.stats.place = aliveBefore - fallen.length + 1; });

    // 7. limpieza y próxima ronda
    game.players.forEach(p => {
      p.diving = false;
      if (p.smokeScreen > 0) p.smokeScreen--;
      Object.keys(p.cooldowns).forEach(k => { if (p.cooldowns[k] > 0) p.cooldowns[k]--; });
    });
    game.fogs = game.fogs.filter(f => f.until > r);

    const alive = game.players.filter(p => p.alive);
    if (alive.length <= 1) {
      game.phase = 'over';
      game.winner = alive.length ? alive[0].id : null;
      if (alive[0]) alive[0].stats.place = 1;
      events.push({ type: 'gameOver', winner: game.winner });
      return events;
    }

    if ((r + 1 - CRATE_FIRST) % CRATE_EVERY === 0 && r + 1 >= CRATE_FIRST) {
      const c = spawnCrate(game, occ, r + 1);
      if (c) events.push({ type: 'crateSpawn', x: c.x, y: c.y });
    }
    if (r + 2 === STORM_START) events.push({ type: 'stormWarning', rounds: 2 });
    const nextLevel = stormLevel(game, r + 1);
    if (nextLevel > level) events.push({ type: 'stormAdvance', level: nextLevel });

    game.round = r + 1;
    return events;
  }

  function addHitter(map, o, pid) {
    const k = o.pid + ':' + o.si;
    if (!map.has(k)) map.set(k, new Set());
    map.get(k).add(pid);
  }

  function setMarker(game, k, kind, round) {
    const cur = game.markers[k];
    if (cur && cur.kind === 'wreck') return;
    if (cur && cur.kind === 'smoke' && kind !== 'wreck') return;
    game.markers[k] = { kind, round };
  }

  function checkSinks(game, hitters, events, r, byStorm) {
    const S = game.size;
    hitters.forEach((set, k) => {
      const [pid, si] = k.split(':');
      const owner = getPlayer(game, pid);
      const ship = owner.ships[+si];
      if (ship.sunk || !ship.cells.every(c => c.hit)) return;
      ship.sunk = true;
      ship.cells.forEach(c => { game.markers[key(c.x, c.y, S)] = { kind: 'wreck', round: r }; });
      const by = [...set];
      events.push({ type: 'sunk', owner: owner.id, ship: ship.type, by, storm: !!byStorm, cells: ship.cells.map(c => [c.x, c.y]) });
      by.forEach(b => {
        if (b === owner.id) return;
        const hp = getPlayer(game, b);
        hp.stats.sinks++;
        const c = repairOne(game, hp);
        events.push({ type: 'reward', pid: b, x: c && c.x, y: c && c.y, ok: !!c, private: true });
      });
    });
  }

  function repairOne(game, p) {
    const S = game.size;
    const damaged = [];
    p.ships.forEach(s => { if (!s.sunk) s.cells.forEach(c => { if (c.hit) damaged.push(c); }); });
    if (!damaged.length) return null;
    const c = pick(damaged, game.rand);
    c.hit = false; c.hitRound = -1;
    delete game.markers[key(c.x, c.y, S)];
    return c;
  }

  function spawnCrate(game, occ, forRound) {
    const S = game.size, isl = islandSet(game);
    const level = stormLevel(game, forRound + 1);
    const free = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const k = key(x, y, S);
      if (isl.has(k) || occ.has(k) || game.markers[k] || inStorm(game, x, y, level + 1)) continue;
      if (game.crates.some(c => c.x === x && c.y === y)) continue;
      free.push([x, y]);
    }
    if (!free.length) return null;
    const [x, y] = pick(free, game.rand);
    const c = { id: game.nextCrateId++, x, y };
    game.crates.push(c);
    return c;
  }

  /* ---------- lo que puede ver cada jugador ---------- */

  function viewFor(game, pid) {
    const me = getPlayer(game, pid);
    return {
      size: game.size,
      round: game.round,
      phase: game.phase,
      islands: game.islands,
      markers: game.markers,
      crates: game.crates,
      fogs: game.fogs.filter(f => f.by !== pid),
      myFogs: game.fogs.filter(f => f.by === pid),
      storm: stormLevel(game),
      nextStorm: stormLevel(game, game.round + 1),
      players: game.players.map(p => ({ id: p.id, name: p.name, color: p.color, alive: p.alive, ghost: p.ghost, isBot: p.isBot })),
      me: me && {
        id: me.id, alive: me.alive, ghost: me.ghost, sector: me.sector, ships: me.ships, cooldowns: me.cooldowns,
        wilds: me.wilds, shield: me.shield, smokeScreen: me.smokeScreen, sonar: me.sonar,
      },
    };
  }

  root.MDF = root.MDF || {};
  Object.assign(root.MDF, {
    LETTERS, SHIP_DEFS, FLEET, ABILITIES, WILDS, WILD_KEYS, COLORS, STORM_START,
    key, coord, makeRand, shuffle, pick,
    createGame, canPlace, placeShip, placeRandom, startBattle, shipCells,
    getPlayer, islandSet, occupancy, canUse, stormLevel, inStorm,
    areaCells, crossCells, clampArea, torpedoPath, torpedoDirFromCell,
    validateOrder, resolveRound, viewFor,
  });
})(typeof window !== 'undefined' ? window : globalThis);
