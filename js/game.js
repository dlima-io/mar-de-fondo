/* Mar de Fondo — controlador del modo práctica: flujo de la partida, interfaz, chat y zumbidos.
   La mesa local (LocalTable) hace de "servidor": junta las órdenes y llama al motor.
   Para el modo online, esta parte se reemplaza por un adaptador que habla con la base en la nube. */
(function (root) {
  'use strict';
  const M = root.MDF, Bots = M.Bots, Snd = M.Sound;
  const $ = id => document.getElementById(id);
  const ME = 'p0';
  const BOT_NAMES = ['Lucía', 'Pablo', 'Martín', 'Sofi', 'Nacho', 'Caro', 'Juli', 'Fede'];
  const DEPLOY_SECONDS = 60;
  const BUZZ_SENDER_MS = 60000;
  const BUZZ_RECIPIENT_MS = 30000;
  const AUTO_BUZZ_LEFT_MS = 10000;
  const DIR_NAMES = { up: 'el norte', down: 'el sur', left: 'el oeste', right: 'el este' };

  const st = {
    game: null,
    phase: 'menu',            // menu | deploy | plan | resolving | over
    settings: { name: '', bots: 3 },
    action: 'shot',
    order: null,
    ready: {},
    orders: {},
    deadline: 0,
    phaseTotal: 25000,
    botPlan: {},              // pid -> { readyAt }
    rand: M.makeRand(Date.now() & 0xffffffff),
    chat: { tabs: { general: [] }, order: ['general'], active: 'general', unread: {} },
    lastBuzzSent: -1e9,
    lastBuzzedAt: {},         // destinatario -> ms
    botBuzzDone: false,
    autoBuzzDone: false,
    deployType: 'acorazado',
    deployHoriz: true,
    hover: null,
    lastSecond: null,
    timers: [],
  };
  let R = null;

  const now = () => Date.now();
  const later = (fn, ms) => { const id = setTimeout(fn, ms); st.timers.push(id); return id; };
  const clearTimers = () => { st.timers.forEach(clearTimeout); st.timers = []; };
  const P = pid => M.getPlayer(st.game, pid);
  const meP = () => P(ME);
  const nameOf = pid => (P(pid) ? P(pid).name : '¿?');
  const shipName = t => M.SHIP_DEFS[t].name;
  const coord = (x, y) => M.coord(x, y);

  /* ---------- inicio ---------- */
  function init() {
    R = new M.Renderer($('board'));
    root.addEventListener('resize', () => R.resize());
    if (root.ResizeObserver) new ResizeObserver(() => R.resize()).observe($('sea'));
    backdrop();

    try { $('nameInput').value = root.localStorage.getItem('mdf.name') || ''; } catch (e) { /* sin almacenamiento */ }
    $('botsSeg').addEventListener('click', e => {
      const b = e.target.closest('button[data-n]');
      if (!b) return;
      st.settings.bots = +b.dataset.n;
      [...$('botsSeg').children].forEach(x => x.classList.toggle('on', x === b));
    });
    $('startBtn').addEventListener('click', () => { Snd.unlock(); startGame(); });
    $('tutBtn').addEventListener('click', () => { Snd.unlock(); startGame(true); });
    $('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') { Snd.unlock(); startGame(); } });
    $('againBtn').addEventListener('click', () => { $('over').hidden = true; startGame(); });
    $('menuBtn').addEventListener('click', () => { $('over').hidden = true; toMenu(); });
    $('soundBtn').addEventListener('click', () => { Snd.on = !Snd.on; Snd.unlock(); soundLabel(); });
    soundLabel();

    const cv = $('board');
    cv.addEventListener('mousemove', e => onHover(cellFromEvent(e)));
    cv.addEventListener('mouseleave', () => onHover(null));
    cv.addEventListener('click', e => onCellClick(cellFromEvent(e)));
    cv.addEventListener('contextmenu', e => { if (st.phase === 'deploy') { e.preventDefault(); rotate(); } });
    document.addEventListener('keydown', onKey);

    $('chatForm').addEventListener('submit', e => {
      e.preventDefault();
      const t = $('chatInput').value.trim();
      if (!t) return;
      $('chatInput').value = '';
      sendChat(t);
    });
    $('chatTabs').addEventListener('click', e => {
      const b = e.target.closest('button[data-tab]');
      if (b) { st.chat.active = b.dataset.tab; st.chat.unread[b.dataset.tab] = 0; renderChat(); }
    });
    $('players').addEventListener('click', e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      if (b.dataset.act === 'buzz') sendBuzz(b.dataset.pid);
      if (b.dataset.act === 'dm') openDM(b.dataset.pid);
    });
    $('orderPanel').addEventListener('click', onPanelClick);

    setInterval(tick, 200);
    renderPanel(); renderPlayers(); renderChat();
  }

  function soundLabel() { $('soundBtn').textContent = 'Sonido: ' + (Snd.on ? 'sí' : 'no'); }

  function backdrop() {
    const g = M.createGame({ seed: 4242, players: [0, 1, 2, 3].map(i => ({ id: 'd' + i, name: 'd', isBot: true })) });
    g.players.forEach(p => M.placeRandom(g, p.id));
    M.startBattle(g);
    const rand = M.makeRand(7);
    for (let i = 0; i < 9; i++) {
      const o = {};
      g.players.forEach(p => { o[p.id] = Bots.decide(M.viewFor(g, p.id), rand); });
      M.resolveRound(g, o);
    }
    const v = JSON.parse(JSON.stringify(M.viewFor(g, 'zz')));
    v.me = null; v.storm = 0; v.nextStorm = 0; v.fogs = []; v.myFogs = [];
    R.mode = 'idle';
    R.setView(v);
  }

  function endTutorial() {
    if (st.tut) st.tut.destroy();
    st.tut = null;
    $('clock').hidden = false;
  }

  function toMenu() {
    clearTimers();
    endTutorial();
    st.phase = 'menu';
    $('hud').hidden = true;
    $('menu').hidden = false;
    R.pending = null; R.preview = null; R.deployShip = null;
    backdrop();
    renderPanel(); renderPlayers();
  }

  function startGame(tutorial) {
    clearTimers();
    endTutorial();
    $('over').hidden = true;
    const name = ($('nameInput').value.trim() || 'Vos').slice(0, 16);
    try { root.localStorage.setItem('mdf.name', name); } catch (e) { /* sin almacenamiento */ }
    st.settings.name = name;
    const pool = BOT_NAMES.filter(n => n.toLowerCase() !== name.toLowerCase());
    const bots = tutorial ? pool.slice(0, 2) : M.shuffle(pool, st.rand).slice(0, st.settings.bots);
    const players = [{ id: ME, name, isBot: false }].concat(bots.map((n, i) => ({ id: 'p' + (i + 1), name: n, isBot: true })));
    st.game = M.createGame({ seed: tutorial ? 20261028 : (Math.random() * 1e9) | 0, players, roundSeconds: 25 });
    if (tutorial) { st.tut = M.Tutorial.create(api); $('clock').hidden = true; }
    st.game.players.forEach(p => { if (p.isBot) M.placeRandom(st.game, p.id); });

    st.chat = { tabs: { general: [] }, order: ['general'], active: 'general', unread: {} };
    st.lastBuzzSent = -1e9; st.lastBuzzedAt = {};
    st.deployType = 'acorazado'; st.deployHoriz = true;
    $('menu').hidden = true;
    $('hud').hidden = false;

    st.phase = 'deploy';
    st.ready = {};
    st.phaseTotal = DEPLOY_SECONDS * 1000;
    st.deadline = st.tut ? Infinity : now() + st.phaseTotal;
    st.autoBuzzDone = false; st.botBuzzDone = true;
    st.botPlan = {};
    st.game.players.forEach(p => {
      if (!p.isBot) return;
      st.botPlan[p.id] = { readyAt: st.tut ? now() + 400 : st.rand() < 0.12 ? Infinity : now() + 3000 + st.rand() * 9000 };
    });
    R.mode = 'deploy';
    R.pending = null; R.preview = null;
    refreshView();
    sys('general', `Zarpamos. ${st.game.players.length} capitanes en un océano de ${st.game.size}x${st.game.size}.`);
    sys('general', 'Ubicá tu flota dentro de tu sector, marcado en dorado. La franja violeta de los bordes es donde llega la tormenta.');
    if (st.tut) st.tut.start();
    else {
      later(() => botSay(randomBot(), Bots.line('start', st.rand)), 1800);
      later(() => botSay(randomBot(), Bots.line('start', st.rand)), 4200);
    }
    renderAll();
  }

  /* pasa de tutorial a partida normal con los mismos rivales */
  function resumeNormal() {
    endTutorial();
    const g = st.game;
    st.phaseTotal = g.roundSeconds * 1000;
    st.deadline = now() + st.phaseTotal;
    st.botBuzzDone = false; st.autoBuzzDone = false;
    g.players.forEach(p => {
      if (!p.isBot || !(p.alive || p.ghost) || st.ready[p.id]) return;
      st.botPlan[p.id] = { readyAt: now() + 1500 + st.rand() * 9000 };
    });
    g.players.forEach(p => { if (p.isBot && st.ready[p.id] && !st.orders[p.id]) st.orders[p.id] = Bots.decide(M.viewFor(g, p.id), st.rand); });
    sys('general', 'Fin del tutorial. Ahora la partida sigue en serio: 25 segundos por ronda.');
    R.coach = null;
    renderAll();
  }

  /* ---------- despliegue ---------- */
  function rotate() { st.deployHoriz = !st.deployHoriz; onHover(st.hover); }

  function finishDeploy() {
    M.startBattle(st.game);
    R.mode = 'aim';
    R.deployShip = null;
    sys('general', 'Fin del despliegue. Las fronteras desaparecen: empieza la batalla.');
    beginRound();
  }

  /* ---------- rondas ---------- */
  function beginRound() {
    const g = st.game;
    st.phase = 'plan';
    st.order = null;
    st.ready = {};
    st.orders = {};
    st.action = meP().alive ? 'shot' : 'fog';
    st.phaseTotal = g.roundSeconds * 1000;
    st.deadline = st.tut ? Infinity : now() + st.phaseTotal;
    st.botBuzzDone = false;
    st.autoBuzzDone = false;
    st.botPlan = {};
    g.players.forEach(p => {
      if (!p.isBot || !(p.alive || p.ghost)) return;
      const hang = !st.tut && p.alive && st.rand() < 0.12;
      st.botPlan[p.id] = { readyAt: st.tut ? now() + 500 : hang ? Infinity : now() + (p.alive ? 1500 + st.rand() * 9000 : 1000 + st.rand() * 8000) };
    });
    R.pending = null;
    R.divingPreview = false;
    refreshView();
    if (!st.tut && st.rand() < 0.14) later(() => botSay(randomBot(), Bots.line('random', st.rand)), 2000 + st.rand() * 8000);
    renderAll();
    if (st.tut) st.tut.onBeginRound();
  }

  function tick() {
    if (st.phase !== 'deploy' && st.phase !== 'plan') return;
    const t = now();
    const left = st.deadline - t;
    if (!st.tut) updateClock(left);

    st.game.players.forEach(p => {
      const plan = st.botPlan[p.id];
      if (!plan || st.ready[p.id] || t < plan.readyAt) return;
      if (st.phase === 'plan' && !st.tut) st.orders[p.id] = Bots.decide(M.viewFor(st.game, p.id), st.rand);
      st.ready[p.id] = true;
      renderPlayers();
    });

    // un bot apura al humano
    if (st.phase === 'plan' && !st.tut && !st.botBuzzDone && t - (st.deadline - st.phaseTotal) > 12000 && meP().alive && !st.ready[ME]) {
      st.botBuzzDone = true;
      const b = randomBot(true);
      if (b && st.rand() < 0.5) receiveBuzz(b.id);
    }
    // zumbido automático a falta de 10 s
    if (!st.tut && !st.autoBuzzDone && left <= AUTO_BUZZ_LEFT_MS) {
      st.autoBuzzDone = true;
      const lazy = st.game.players.filter(p => mustAnswer(p) && !st.ready[p.id]);
      if (lazy.length) {
        sys('general', `Quedan 10 segundos. Zumbido automático para ${lazy.map(p => p.name).join(', ')}.`, 'buzz');
        lazy.forEach(p => {
          if (p.id === ME) receiveBuzz(null);
          else wakeBot(p.id);
        });
      }
    }

    const waiting = st.game.players.filter(p => mustAnswer(p) && !st.ready[p.id]);
    if (!waiting.length || left <= 0) {
      if (st.phase === 'deploy') finishDeploy();
      else resolve();
    }
  }

  function mustAnswer(p) { return st.phase === 'deploy' ? true : p.alive; }

  function resolve() {
    st.phase = 'resolving';
    if (!st.tut) updateClock(0);
    const g = st.game;
    if (meP().alive || meP().ghost) {
      if (st.order) st.orders[ME] = st.order;
    }
    if (st.tut) st.tut.fillOrders(st.orders);
    const before = snapshotView();
    const roundNo = g.round;
    const events = M.resolveRound(g, st.orders);
    R.setView(before);
    R.pending = null;
    renderAll();
    const dur = playEvents(events, roundNo);
    later(() => {
      if (st.game !== g) return;
      if (g.phase === 'over') showOver();
      else {
        beginRound();
        if (st.tut) st.tut.onResolved(events);
      }
    }, dur + (st.tut ? 1600 : 900));
  }

  /* ---------- animación y crónica ---------- */
  function playEvents(events, roundNo) {
    let delay = 150;
    let sounds = 0;
    const me = ME;
    const step = (fn, extra) => { const d = delay; later(fn, d); delay += extra == null ? 110 : extra; };
    const hits = [], misses = [];
    let torpedoes = 0, stormHits = 0;

    events.filter(e => e.type === 'torpedo').forEach(e => {
      torpedoes++;
      step(() => R.fx('torpedo', null, null, { path: e.path }), 0);
    });
    if (torpedoes) delay += 700;

    events.forEach(e => {
      switch (e.type) {
        case 'hit':
          hits.push(coord(e.x, e.y));
          step(() => { R.fx('explosion', e.x, e.y); if (sounds++ < 6) Snd.boom(); });
          if (e.owner === me && e.by !== me) step(() => {}, 0);
          break;
        case 'miss': case 'rock':
          misses.push(coord(e.x, e.y));
          step(() => { R.fx('splash', e.x, e.y); if (sounds++ < 6) Snd.splash(); }, 70);
          break;
        case 'deflect':
          step(() => R.fx('deflect', e.x, e.y));
          break;
        case 'stormHit':
          stormHits++;
          step(() => R.fx('explosion', e.x, e.y), 60);
          break;
      }
    });
    if (stormHits) later(() => { R.lightning(); Snd.thunder(); }, 200);
    later(() => { refreshView(); }, Math.min(delay, 1400));

    // crónica
    const lines = [];
    const meEv = [];
    if (hits.length || misses.length) {
      lines.push(`${hits.length ? `${hits.length} ${hits.length === 1 ? 'impacto' : 'impactos'} (${hits.slice(0, 6).join(', ')}${hits.length > 6 ? '…' : ''})` : 'Ningún impacto'}, ${misses.length} al agua.`);
    }
    if (torpedoes) lines.push(torpedoes === 1 ? 'Un torpedo cruzó el mapa.' : `${torpedoes} torpedos cruzaron el mapa.`);

    events.forEach(e => {
      switch (e.type) {
        case 'hit':
          if (e.by === me && e.owner === me) meEv.push(['alert', `Te pegaste a vos mismo en ${coord(e.x, e.y)}.`]);
          else if (e.by === me) meEv.push(['me-only', `Le diste a algo en ${coord(e.x, e.y)}.`]);
          else if (e.owner === me) meEv.push(['alert', `Te dieron en tu ${shipName(e.ship)} (${coord(e.x, e.y)}).`]);
          break;
        case 'miss':
          if (e.dodged === me) meEv.push(['me-only', `Tu submarino esquivó un disparo en ${coord(e.x, e.y)}.`]);
          break;
        case 'deflect':
          lines.push(`Algo desvió un disparo en ${coord(e.x, e.y)}.`);
          if (e.owner === me) meEv.push(['me-only', `Tu escudo bloqueó un impacto en ${coord(e.x, e.y)}.`]);
          break;
        case 'sunk': {
          const c = e.cells[0];
          lines.push(e.storm ? `La tormenta hundió un ${shipName(e.ship)} en ${coord(c[0], c[1])}.` : `Se hundió un ${shipName(e.ship)} en ${coord(c[0], c[1])}.`);
          if (e.owner === me) meEv.push(['alert', `Hundieron tu ${shipName(e.ship)}. Perdiste su habilidad.`]);
          else if (e.by.includes(me)) meEv.push(['me-only', `¡Hundiste un ${shipName(e.ship)}!`]);
          break;
        }
        case 'reward':
          if (e.pid === me) meEv.push(['me-only', e.ok ? `Recompensa: reparaste la casilla ${coord(e.x, e.y)}.` : 'Recompensa: no tenías nada para reparar.']);
          break;
        case 'repair':
          if (e.pid === me) meEv.push(['me-only', e.ok ? `Reparaste la casilla ${coord(e.x, e.y)}.` : 'No había nada para reparar.']);
          later(() => e.ok && e.pid === me && R.fx('repair', e.x, e.y), 300);
          break;
        case 'sonar':
          if (e.pid === me) {
            meEv.push(['me-only', `Sonar en ${coord(e.x, e.y)}–${coord(e.x + 3, e.y + 3)}: ${e.count} ${e.count === 1 ? 'casilla ocupada' : 'casillas ocupadas'}.`]);
            later(() => { R.fx('sonar', e.x, e.y); Snd.ping(); }, 100);
          }
          break;
        case 'dive': if (e.pid === me) meEv.push(['me-only', 'Tu submarino se sumergió esta ronda.']); break;
        case 'shieldUp': if (e.pid === me) meEv.push(['me-only', 'Escudo deflector activado.']); break;
        case 'smokeUp': if (e.pid === me) meEv.push(['me-only', 'Cortina de humo: el sonar no te ve por 3 rondas.']); break;
        case 'fog': lines.push(`Un fantasma tiró niebla sobre ${coord(e.x + 1, e.y + 1)}.`); break;
        case 'crate':
          lines.push(`Alguien se llevó la caja de ${coord(e.x, e.y)}.`);
          later(() => R.fx('crate', e.x, e.y), 400);
          if (e.pid === me) {
            meEv.push(['me-only', e.wild ? `Te llevaste la caja: ${M.WILDS[e.wild].name}.` : 'Te llevaste la caja, pero ya tenías 3 comodines.']);
            later(() => { Snd.chime(); toast(e.wild ? `Comodín: ${M.WILDS[e.wild].name}` : 'Caja vacía para vos: ya tenés 3 comodines', 'good'); }, 500);
          }
          break;
        case 'crateSpawn': lines.push(`Cayó una caja de suministros en ${coord(e.x, e.y)}.`); break;
        case 'stormHit': if (e.owner === me) meEv.push(['alert', `La tormenta dañó tu ${shipName(e.ship)}.`]); break;
        case 'stormWarning': lines.push('La tormenta llega en 2 rondas. Los bordes del mapa van a dañar a los barcos que queden ahí.'); break;
        case 'stormAdvance': lines.push('La tormenta avanza hacia el centro.'); break;
        case 'eliminated':
          lines.push(e.pid === me ? 'Te quedaste sin flota. Ahora sos un fantasma: cada ronda podés tirar niebla.' : `${nameOf(e.pid)} se quedó sin flota y ahora es un fantasma.`);
          break;
      }
    });

    sys('general', `Ronda ${roundNo}. ` + (lines.shift() || 'Calma chicha.'));
    lines.forEach(l => sys('general', l));
    meEv.forEach(([k, l]) => sys('general', l, k));
    const bad = meEv.find(x => x[0] === 'alert');
    const good = meEv.find(x => x[0] === 'me-only');
    if (bad) later(() => toast(bad[1]), 600);
    else if (good) later(() => toast(good[1], 'good'), 600);

    botReactions(events);
    return delay;
  }

  function botReactions(events) {
    if (st.tut) return;
    const said = new Set();
    const say = (pid, kind, vars, p) => {
      if (said.has(pid) || st.rand() > p) return;
      said.add(pid);
      later(() => botSay(P(pid), Bots.line(kind, st.rand, vars)), 900 + st.rand() * 2500);
    };
    events.forEach(e => {
      if (e.type === 'eliminated' && P(e.pid).isBot) say(e.pid, 'eliminated', {}, 0.9);
      if (e.type === 'sunk') {
        if (P(e.owner).isBot) say(e.owner, 'sunkMe', { ship: shipName(e.ship) }, 0.6);
        e.by.forEach(b => { if (b !== e.owner && P(b).isBot) say(b, 'sunkOther', {}, 0.5); });
      }
      if (e.type === 'hit' && e.owner !== e.by && P(e.owner).isBot) say(e.owner, 'hitMe', {}, 0.25);
      if (e.type === 'crate' && P(e.pid).isBot) say(e.pid, 'crate', {}, 0.3);
    });
  }

  /* ---------- interacción con el mapa ---------- */
  function cellFromEvent(e) {
    const r = $('board').getBoundingClientRect();
    return R.cellAt(e.clientX - r.left, e.clientY - r.top);
  }

  function onHover(cell) {
    st.hover = cell;
    R.hover = cell;
    if (st.phase === 'deploy') {
      if (!cell || st.ready[ME]) { R.deployShip = null; return; }
      const [x, y] = cell;
      R.deployShip = { type: st.deployType, x, y, horiz: st.deployHoriz, ok: M.canPlace(st.game, ME, st.deployType, x, y, st.deployHoriz) };
      return;
    }
    if (st.phase !== 'plan' || st.ready[ME] || !cell) { R.preview = null; return; }
    R.preview = shapeFor(orderFromCell(cell));
  }

  function onCellClick(cell) {
    if (!cell) return;
    Snd.unlock();
    if (st.phase === 'deploy') {
      if (st.ready[ME]) return;
      const [x, y] = cell;
      const own = meP().ships.find(s => s.cells.some(c => c.x === x && c.y === y));
      if (own && own.type !== st.deployType) {
        st.deployType = own.type; st.deployHoriz = own.horiz;
        onHover(cell); renderPanel();
        return;
      }
      if (M.placeShip(st.game, ME, st.deployType, x, y, st.deployHoriz)) {
        Snd.tick();
        const next = M.FLEET.find(t => !meP().ships.some(s => s.type === t));
        if (next) st.deployType = next;
        refreshView(); onHover(cell); renderPanel();
      } else {
        toast('Ahí no entra: tiene que quedar dentro de tu sector, sin islas ni otros barcos.');
      }
      return;
    }
    if (st.phase !== 'plan' || st.ready[ME]) return;
    const o = orderFromCell(cell);
    if (!o) {
      if (st.action === 'torpedo') toast('Elegí una casilla al norte, sur, este u oeste de tu submarino.');
      return;
    }
    if (st.tut) { const err = st.tut.checkOrder(o); if (err) { toast(err); return; } }
    setOrder(o);
  }

  function orderFromCell(cell) {
    if (!cell) return null;
    const [x, y] = cell, g = st.game;
    switch (st.action) {
      case 'shot': return { type: 'shot', x, y };
      case 'salva': return { type: 'salva', x, y };
      case 'sonar': { const [ax, ay] = M.clampArea(g, x - 1, y - 1, 4); return { type: 'sonar', x: ax, y: ay }; }
      case 'misil': { const [ax, ay] = M.clampArea(g, x, y, 2); return { type: 'wild', wild: 'misil', x: ax, y: ay }; }
      case 'torpedo': { const dir = M.torpedoDirFromCell(g, ME, x, y); return dir ? { type: 'torpedo', dir } : null; }
      case 'fog': return { type: 'fog', x, y };
    }
    return null;
  }

  /* forma a dibujar para una orden, sin revelar barcos ajenos */
  function shapeFor(o) {
    if (!o) return null;
    const g = st.game;
    switch (o.type) {
      case 'shot': return { cells: [[o.x, o.y]] };
      case 'salva': return { cells: M.crossCells(g, o.x, o.y) };
      case 'sonar': return { area: { x: o.x, y: o.y, w: 4, h: 4 }, color: M.COLORS_UI.sonar };
      case 'wild': return o.wild === 'misil' ? { area: { x: o.x, y: o.y, w: 2, h: 2 }, cells: M.areaCells(g, o.x, o.y, 2, 2), color: M.COLORS_UI.signal } : null;
      case 'torpedo': return { path: safeTorpedoLine(o.dir) };
      case 'fog': { const [ax, ay] = M.clampArea(g, o.x - 1, o.y - 1, 3); return { area: { x: ax, y: ay, w: 3, h: 3 }, color: '#c8d2dc' }; }
    }
    return null;
  }

  function safeTorpedoLine(dir) {
    const g = st.game, S = g.size, sub = meP().ships.find(s => s.type === 'submarino');
    if (!sub) return [];
    const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[dir];
    let best = sub.cells[0];
    sub.cells.forEach(c => { if (c.x * d[0] + c.y * d[1] > best.x * d[0] + best.y * d[1]) best = c; });
    const isl = M.islandSet(g), path = [[best.x, best.y]];
    let x = best.x + d[0], y = best.y + d[1];
    while (x >= 0 && y >= 0 && x < S && y < S) {
      path.push([x, y]);
      if (isl.has(M.key(x, y, S))) break;
      x += d[0]; y += d[1];
    }
    return path;
  }

  function setOrder(o) {
    st.order = o;
    const sh = shapeFor(o);
    R.pending = sh ? { cells: sh.cells, area: sh.area, path: sh.path } : null;
    if (o.type === 'inmersion') R.divingPreview = true; else R.divingPreview = false;
    Snd.tick();
    renderPanel();
  }

  function describe(o) {
    if (!o) return '';
    const c = (x, y) => `<span class="coord">${coord(x, y)}</span>`;
    switch (o.type) {
      case 'shot': return `Disparo a ${c(o.x, o.y)}`;
      case 'salva': return `Salva en cruz sobre ${c(o.x, o.y)}`;
      case 'sonar': return `Sonar sobre ${c(o.x, o.y)} a ${c(o.x + 3, o.y + 3)}`;
      case 'torpedo': return `Torpedo hacia ${DIR_NAMES[o.dir]}`;
      case 'inmersion': return 'Inmersión del submarino';
      case 'fog': { const [ax, ay] = M.clampArea(st.game, o.x - 1, o.y - 1, 3); return `Niebla sobre ${c(ax + 1, ay + 1)}`; }
      case 'wild':
        if (o.wild === 'misil') return `Misil sobre ${c(o.x, o.y)} a ${c(o.x + 1, o.y + 1)}`;
        return M.WILDS[o.wild].name;
    }
    return '';
  }

  function onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    if (st.phase === 'deploy' && (e.key === 'r' || e.key === 'R')) { rotate(); }
    if (e.key === 'Enter' && st.phase === 'plan' && st.order && !st.ready[ME]) confirmOrder();
    if (e.key === 'Escape' && st.phase === 'plan' && !st.ready[ME]) { st.order = null; R.pending = null; R.divingPreview = false; renderPanel(); }
  }

  function confirmOrder() {
    if (!st.order) return;
    if (st.tut) { const err = st.tut.checkOrder(st.order); if (err) { toast(err); return; } }
    st.ready[ME] = true;
    st.orders[ME] = st.order;
    R.preview = null;
    renderAll();
  }

  /* ---------- panel de órdenes ---------- */
  function onPanelClick(e) {
    const b = e.target.closest('button[data-cmd]');
    if (!b || b.disabled) return;
    Snd.unlock();
    const cmd = b.dataset.cmd, arg = b.dataset.arg;
    if (cmd === 'ship') { st.deployType = arg; renderPanel(); }
    if (cmd === 'rotate') rotate();
    if (cmd === 'random') { M.placeRandom(st.game, ME); refreshView(); renderPanel(); }
    if (cmd === 'deployReady') {
      if (meP().ships.length < M.FLEET.length) { toast('Te faltan barcos por ubicar.'); return; }
      st.ready[ME] = true; R.deployShip = null; renderAll();
    }
    if (cmd === 'deployEdit') { st.ready[ME] = false; renderAll(); }
    if (cmd === 'action') {
      if (st.tut) { const err = st.tut.checkAction(arg); if (err) { toast(err); return; } }
      const instant = { inmersion: { type: 'inmersion' }, escudo: { type: 'wild', wild: 'escudo' }, reparacion: { type: 'wild', wild: 'reparacion' }, humo: { type: 'wild', wild: 'humo' } }[arg];
      st.action = arg;
      if (instant) setOrder(instant);
      else { st.order = null; R.pending = null; R.divingPreview = false; renderPanel(); }
    }
    if (cmd === 'confirm') confirmOrder();
    if (cmd === 'change') { st.ready[ME] = false; delete st.orders[ME]; renderAll(); }
  }

  function renderPanel() {
    renderPanelInner();
    if (st.tut) st.tut.decorate();
  }

  function renderPanelInner() {
    const el = $('orderPanel');
    const g = st.game;
    if (st.phase === 'menu' || !g) { el.innerHTML = '<h2>Puesto de mando</h2><p class="hint">Elegí tu nombre y la cantidad de rivales para zarpar.</p>'; return; }
    const me = meP();

    if (st.phase === 'deploy') {
      const placed = t => me.ships.some(s => s.type === t);
      const all = M.FLEET.every(placed);
      if (st.ready[ME]) {
        el.innerHTML = `<h2>Despliegue <em>listo</em></h2>
          <p class="order-line">Flota en posición. Esperando a los demás.</p>
          <div class="row"><button class="btn ghost" data-cmd="deployEdit">Mover barcos</button></div>`;
        return;
      }
      el.innerHTML = `<h2>Ubicá tu flota</h2>
        <div class="actions">${M.FLEET.map(t => `
          <button class="act ${st.deployType === t ? 'on' : ''}" data-cmd="ship" data-arg="${t}">
            <b>${shipName(t)}</b><small>${M.SHIP_DEFS[t].size} casillas${placed(t) ? ' · ubicado' : ''}</small>
          </button>`).join('')}
        </div>
        <p class="hint">Clic para ubicar. <span class="kbd">R</span> o clic derecho para girar. Clic sobre un barco para moverlo.</p>
        <div class="row" style="margin-top:10px">
          <button class="btn ghost" data-cmd="rotate">Girar</button>
          <button class="btn ghost" data-cmd="random">Al azar</button>
        </div>
        <div class="row" style="margin-top:8px"><button class="btn" data-cmd="deployReady" ${all ? '' : 'disabled'}>Listo para zarpar</button></div>`;
      return;
    }

    if (st.phase === 'over') { el.innerHTML = '<h2>Fin de la partida</h2>'; return; }

    const resolving = st.phase === 'resolving';
    const locked = st.ready[ME] || resolving;

    if (!me.alive) {
      el.innerHTML = `<h2>Sos un fantasma <em>R${g.round}</em></h2>
        <p class="hint" style="margin-top:0">Tu flota se hundió, pero seguís jugando: cada ronda podés tapar una zona de 3x3 con niebla para los demás.</p>
        <div class="actions"><button class="act wide on" data-cmd="action" data-arg="fog" ${locked ? 'disabled' : ''}><b>Niebla</b><small>Tapá una zona del mapa durante una ronda</small></button></div>
        <p class="order-line ${st.order ? '' : 'muted'}">${resolving ? 'Resolviendo ronda…' : st.order ? describe(st.order) : 'Elegí dónde tirar la niebla'}</p>
        ${confirmRow(locked, resolving)}`;
      return;
    }

    const ab = (id) => {
      const a = M.ABILITIES[id];
      const ship = me.ships.find(s => s.type === a.ship);
      const sunk = !ship || ship.sunk;
      const cd = me.cooldowns[id];
      const dis = locked || sunk || cd > 0;
      const note = sunk ? `Sin ${shipName(a.ship).toLowerCase()}` : cd > 0 ? `Lista en ${cd} ${cd === 1 ? 'ronda' : 'rondas'}` : a.desc;
      return `<button class="act ${st.action === id ? 'on' : ''}" data-cmd="action" data-arg="${id}" ${dis ? 'disabled' : ''}>
        <b>${a.name}</b><small>${note}</small>${cd > 0 && !sunk ? `<span class="cd">${cd}r</span>` : ''}</button>`;
    };
    const wilds = me.wilds.map((w, i) => {
      if (me.wilds.indexOf(w) !== i) return '';
      const n = me.wilds.filter(x => x === w).length;
      return `<button class="act wild ${st.action === w ? 'on' : ''}" data-cmd="action" data-arg="${w}" ${locked ? 'disabled' : ''}>
        <b>${M.WILDS[w].name}${n > 1 ? ' ×' + n : ''}</b><small>${M.WILDS[w].desc}</small></button>`;
    }).join('');

    const fleet = me.ships.map(s => `
      <div class="fleet-row ${s.sunk ? 'sunk' : ''}"><span>${shipName(s.type)}</span>
        <div class="pips">${s.cells.map(c => `<i class="pip ${c.hit ? 'hit' : ''}"></i>`).join('')}</div></div>`).join('');
    const badges = [
      me.shield ? `<span class="badge shield">Escudo activo</span>` : '',
      me.smokeScreen ? `<span class="badge smoke">Oculto del sonar · ${me.smokeScreen}r</span>` : '',
    ].join('');

    const prompt = {
      shot: 'Elegí una casilla para disparar',
      salva: 'Elegí el centro de la cruz',
      torpedo: 'Elegí una casilla al norte, sur, este u oeste de tu submarino',
      sonar: 'Elegí la zona de 4x4',
      misil: 'Elegí la zona de 2x2',
    }[st.action] || 'Elegí tu jugada';

    el.innerHTML = `<h2>Tu jugada <em>R${g.round}</em></h2>
      <div class="actions">
        <button class="act ${st.action === 'shot' ? 'on' : ''}" data-cmd="action" data-arg="shot" ${locked ? 'disabled' : ''}><b>Disparo</b><small>Una casilla</small></button>
        ${ab('salva')}${ab('torpedo')}${ab('inmersion')}${ab('sonar')}
        ${wilds}
      </div>
      <p class="order-line ${st.order ? '' : 'muted'}">${resolving ? 'Resolviendo ronda…' : st.order ? describe(st.order) : prompt}</p>
      ${confirmRow(locked, resolving)}
      ${badges ? `<div class="badges">${badges}</div>` : ''}
      <div class="fleet">${fleet}</div>`;
  }

  function confirmRow(locked, resolving) {
    if (resolving) return '';
    if (st.ready[ME]) return `<div class="row"><button class="btn ghost" data-cmd="change">Cambiar jugada</button></div>`;
    return `<div class="row"><button class="btn" data-cmd="confirm" ${st.order ? '' : 'disabled'}>Confirmar jugada</button></div>`;
  }

  /* ---------- jugadores ---------- */
  function renderPlayers() {
    const ul = $('players');
    const g = st.game;
    if (!g) { ul.innerHTML = '<li class="player"><span class="name"><i>Sin partida</i></span></li>'; $('readyCount').textContent = ''; return; }
    const t = now();
    const senderWait = Math.max(0, BUZZ_SENDER_MS - (t - st.lastBuzzSent));
    const answering = g.players.filter(p => mustAnswer(p));
    $('readyCount').textContent = (st.phase === 'plan' || st.phase === 'deploy') ? `${answering.filter(p => st.ready[p.id]).length}/${answering.length} listos` : '';
    ul.innerHTML = g.players.map(p => {
      const meRow = p.id === ME;
      let state = '', cls = '';
      if (!p.alive && st.phase !== 'deploy') { state = 'fantasma'; cls = 'ghost'; }
      else if (st.phase === 'plan' || st.phase === 'deploy') { state = st.ready[p.id] ? 'listo' : 'pensando…'; cls = st.ready[p.id] ? 'ready' : ''; }
      else if (st.phase === 'resolving') state = 'al ataque';
      const canBuzz = !meRow && (st.phase === 'plan' || st.phase === 'deploy') && mustAnswer(p) && !st.ready[p.id];
      const recWait = Math.max(0, BUZZ_RECIPIENT_MS - (t - (st.lastBuzzedAt[p.id] || -1e9)));
      const buzzTitle = senderWait ? `Podés zumbar de nuevo en ${Math.ceil(senderWait / 1000)} s` : recWait ? `${p.name} recibió un zumbido hace poco` : `Mandale un zumbido a ${p.name}`;
      return `<li class="player ${p.alive || st.phase === 'deploy' ? '' : 'out'}">
        <span class="dot" style="background:${p.color}"></span>
        <span class="name">${esc(p.name)}${meRow ? ' <i>vos</i>' : ''}</span>
        <span class="state ${cls}">${state}</span>
        ${meRow ? '' : `<button class="mini" data-act="dm" data-pid="${p.id}" title="Mensaje privado a ${esc(p.name)}">Privado</button>`}
        ${canBuzz ? `<button class="mini buzz" data-act="buzz" data-pid="${p.id}" title="${esc(buzzTitle)}" ${senderWait || recWait ? 'disabled' : ''}>Zumbar</button>` : ''}
      </li>`;
    }).join('');
    if (st.tut) st.tut.decorate();
  }

  /* ---------- zumbidos ---------- */
  function sendBuzz(pid) {
    const t = now();
    if (t - st.lastBuzzSent < BUZZ_SENDER_MS) { toast(`Podés zumbar de nuevo en ${Math.ceil((BUZZ_SENDER_MS - (t - st.lastBuzzSent)) / 1000)} s.`); return; }
    if (t - (st.lastBuzzedAt[pid] || -1e9) < BUZZ_RECIPIENT_MS) { toast(`${nameOf(pid)} recibió un zumbido hace poco.`); return; }
    st.lastBuzzSent = t;
    st.lastBuzzedAt[pid] = t;
    sys('general', `${st.settings.name} le mandó un zumbido a ${nameOf(pid)}.`, 'buzz');
    Snd.buzz();
    wakeBot(pid, true);
    renderPlayers();
    if (st.tut) st.tut.onBuzz(pid);
  }

  function wakeBot(pid, talk) {
    const plan = st.botPlan[pid];
    if (plan && !st.ready[pid]) plan.readyAt = Math.min(plan.readyAt, now() + 800 + st.rand() * 2000);
    if (talk || st.rand() < 0.4) later(() => botSay(P(pid), Bots.line('buzzed', st.rand)), 600 + st.rand() * 900);
  }

  function receiveBuzz(fromPid) {
    const t = now();
    if (t - (st.lastBuzzedAt[ME] || -1e9) < BUZZ_RECIPIENT_MS && fromPid) return;
    st.lastBuzzedAt[ME] = t;
    const from = fromPid ? nameOf(fromPid) : 'El sistema';
    if (fromPid) {
      sys('general', `${from} te mandó un zumbido.`, 'buzz');
      later(() => botSay(P(fromPid), Bots.line('buzzHuman', st.rand, { name: st.settings.name })), 400);
    }
    const sea = $('sea');
    sea.classList.remove('shake'); void sea.offsetWidth; sea.classList.add('shake');
    Snd.buzz();
    toast(fromPid ? `${from} te mandó un zumbido` : 'Zumbido: te quedan 10 segundos', 'buzz');
    flashTitle();
  }

  let titleTimer = null;
  function flashTitle() {
    if (!document.hidden) return;
    clearInterval(titleTimer);
    let n = 0;
    const base = 'Mar de Fondo';
    titleTimer = setInterval(() => {
      document.title = n++ % 2 ? base : '¡Zumbido! · ' + base;
      if (!document.hidden || n > 20) { clearInterval(titleTimer); document.title = base; }
    }, 700);
  }

  /* ---------- chat ---------- */
  function addMsg(tab, msg) {
    if (!st.chat.tabs[tab]) { st.chat.tabs[tab] = []; st.chat.order.push(tab); }
    msg.round = st.game ? st.game.round : 0;
    st.chat.tabs[tab].push(msg);
    if (st.chat.tabs[tab].length > 250) st.chat.tabs[tab].shift();
    if (tab !== st.chat.active) st.chat.unread[tab] = (st.chat.unread[tab] || 0) + 1;
    renderChat();
  }
  function sys(tab, text, kind) { addMsg(tab, { kind: kind || 'sys', text }); }
  function botSay(p, text, tab) {
    if (!p || !st.game || st.phase === 'menu') return;
    addMsg(tab || 'general', { kind: 'player', from: p.id, text });
  }
  function randomBot(aliveOnly) {
    const bots = st.game.players.filter(p => p.isBot && (!aliveOnly || p.alive));
    return bots.length ? M.pick(bots, st.rand) : null;
  }

  function openDM(pid) {
    if (!st.chat.tabs[pid]) { st.chat.tabs[pid] = []; st.chat.order.push(pid); sys(pid, `Conversación privada con ${nameOf(pid)}. Nadie más la ve.`); }
    st.chat.active = pid;
    st.chat.unread[pid] = 0;
    renderChat();
    $('chatInput').focus();
  }

  function sendChat(text) {
    const tab = st.chat.active;
    if (!st.game) return;
    addMsg(tab, { kind: 'player', from: ME, text });
    if (tab === 'general') {
      if (st.rand() < 0.3) { const b = randomBot(); later(() => botSay(b, Bots.line('random', st.rand)), 1500 + st.rand() * 3000); }
    } else if (P(tab) && P(tab).isBot && st.rand() < 0.85) {
      const smokes = Object.keys(st.game.markers).filter(k => st.game.markers[k].kind === 'smoke');
      const k = smokes.length ? +M.pick(smokes, st.rand) : Math.floor(st.rand() * st.game.size * st.game.size);
      const S = st.game.size;
      later(() => botSay(P(tab), Bots.line('dm', st.rand, { coord: coord(k % S, Math.floor(k / S)) }), tab), 1500 + st.rand() * 2500);
    }
  }

  function renderChat() {
    const c = st.chat;
    $('chatTabs').innerHTML = c.order.map(t => {
      const label = t === 'general' ? 'General' : nameOf(t);
      const u = c.unread[t];
      return `<button type="button" role="tab" class="tab ${t === c.active ? 'on' : ''}" data-tab="${t}" aria-selected="${t === c.active}">${esc(label)}${u ? `<span class="unread">${u}</span>` : ''}</button>`;
    }).join('');
    const box = $('msgs');
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.innerHTML = '';
    (c.tabs[c.active] || []).forEach(m => {
      const d = document.createElement('div');
      d.className = 'msg ' + (m.kind === 'player' ? '' : m.kind === 'sys' ? 'sys' : 'sys ' + m.kind);
      if (m.kind === 'player') {
        const p = P(m.from);
        const b = document.createElement('b');
        b.textContent = p ? p.name : '';
        b.style.color = p ? p.color : '';
        d.appendChild(b);
        d.appendChild(document.createTextNode(m.text));
      } else {
        d.textContent = m.text;
      }
      box.appendChild(d);
    });
    if (atBottom || box.dataset.tab !== c.active) box.scrollTop = box.scrollHeight;
    box.dataset.tab = c.active;
    $('chatInput').placeholder = c.active === 'general' ? 'Mensaje para todos' : `Mensaje privado para ${nameOf(c.active)}`;
  }

  /* ---------- varios ---------- */
  function toast(text, kind) {
    const d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.textContent = text;
    $('toasts').appendChild(d);
    setTimeout(() => d.remove(), 3200);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  }

  function updateClock(left) {
    const secs = Math.max(0, Math.ceil(left / 1000));
    $('clockNum').textContent = secs;
    const frac = Math.max(0, Math.min(1, left / st.phaseTotal));
    $('clockArc').style.strokeDashoffset = (113.1 * (1 - frac)).toFixed(1);
    $('clock').classList.toggle('low', left < 10000 && st.phase !== 'resolving');
    if (st.phase === 'plan' && secs <= 5 && secs > 0 && secs !== st.lastSecond && !st.ready[ME] && meP().alive) Snd.tick();
    st.lastSecond = secs;
    if (secs !== st.lastSecondPlayers) { st.lastSecondPlayers = secs; renderPlayers(); }
  }

  function renderHud() {
    const g = st.game;
    if (!g) return;
    $('hudRound').textContent = st.phase === 'deploy' ? '—' : g.round;
    const lvl = M.stormLevel(g);
    $('hudStorm').textContent = lvl > 0 ? 'activa' : st.phase === 'deploy' ? 'ronda 10' : `en ${M.STORM_START - g.round}`;
  }

  function refreshView() { R.setView(snapshotView()); }
  function snapshotView() {
    const v = JSON.parse(JSON.stringify(M.viewFor(st.game, ME)));
    if (st.tut) st.tut.patchView(v);
    return v;
  }

  function renderAll() { renderPanel(); renderPlayers(); renderHud(); }

  function showOver() {
    st.phase = 'over';
    clearTimers();
    const g = st.game;
    const w = g.winner ? P(g.winner) : null;
    $('overTitle').textContent = !w ? 'Empate' : w.id === ME ? '¡Ganaste!' : `Ganó ${w.name}`;
    $('overSub').textContent = !w
      ? `Las últimas flotas se hundieron juntas en la ronda ${g.round}.`
      : w.id === ME ? `Último barco a flote después de ${g.round} rondas.` : `Resistió ${g.round} rondas. Vos terminaste en el puesto ${meP().stats.place || '—'}.`;
    const rows = g.players.slice().sort((a, b) => (a.stats.place || 99) - (b.stats.place || 99) || b.stats.sinks - a.stats.sinks);
    $('overBody').innerHTML = rows.map(p => `<tr>
      <td>${p.stats.place || '—'}º</td>
      <td><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${p.color};margin-right:6px"></span>${esc(p.name)}${p.id === ME ? ' (vos)' : ''}</td>
      <td class="num">${p.stats.shots}</td><td class="num">${p.stats.hits}</td><td class="num">${p.stats.sinks}</td></tr>`).join('');
    sys('general', $('overTitle').textContent + '.');
    renderAll();
    later(() => { $('over').hidden = false; }, 600);
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 0);

  const api = {
    st, ME, coord, nameOf, shipName,
    get R() { return R; },
    refreshView, renderAll, sys, botSay, toast, later,
    startGame, toMenu, resumeNormal,
  };
  root.MDF.debug = st;
  root.MDF.debugView = () => R;
})(window);
