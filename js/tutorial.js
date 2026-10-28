/* Mar de Fondo — tutorial guiado.
   Partida sin reloj contra dos rivales que solo hacen lo que pide el guion.
   Cada paso es un cartel: algunos se leen y siguen con "Siguiente", otros esperan una jugada concreta. */
(function (root) {
  'use strict';
  const M = root.MDF;

  function create(ui) {
    const st = ui.st, ME = ui.ME;
    const $ = id => document.getElementById(id);
    const T = { i: -1, patch: null, events: [], buzzed: false };
    const g = () => st.game;
    const me = () => M.getPlayer(g(), ME);
    const rival = n => g().players[n];          // 1 = primera rival, 2 = segundo rival
    const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
    const cellOf = c => [c.x, c.y];
    const targetShip = () => rival(1).ships.find(s => s.type === 'fragata');
    const tc = i => cellOf(targetShip().cells[i]);
    const C = (x, y) => `<b class="c">${ui.coord(x, y)}</b>`;

    /* ---------- datos que arma el guion ---------- */
    function waterCell() {
      const S = g().size, occ = M.occupancy(g()), isl = M.islandSet(g());
      const mine = me().ships.flatMap(s => s.cells);
      let best = null, bestD = 1e9;
      for (let y = 3; y < S - 3; y++) for (let x = 3; x < S - 3; x++) {
        const k = M.key(x, y, S);
        if (occ.has(k) || isl.has(k) || g().markers[k] || g().crates.some(c => c.x === x && c.y === y)) continue;
        const d = Math.min(...mine.map(c => Math.abs(c.x - x) + Math.abs(c.y - y)));
        if (d >= 2 && d < bestD) { bestD = d; best = [x, y]; }
      }
      return best || [Math.floor(S / 2), Math.floor(S / 2)];
    }
    function sonarArea() {
      const ship = rival(2).ships.find(s => s.type === 'acorazado');
      const c = ship.cells[1];
      const [x, y] = M.clampArea(g(), c.x - 1, c.y - 1, 4);
      return { x, y, w: 4, h: 4 };
    }
    function areaHasRival(o) {
      return rival(2).ships.some(s => !s.sunk && s.cells.some(c => c.x >= o.x && c.y >= o.y && c.x < o.x + 4 && c.y < o.y + 4));
    }
    function crate() {
      if (!g().crates.length) {
        const [x, y] = waterCell();
        g().crates.push({ id: g().nextCrateId++, x, y });
        ui.refreshView();
      }
      return g().crates[0];
    }
    const ev = type => T.events.filter(e => e.type === type);

    /* ---------- guion ---------- */
    const actionLabel = { shot: 'Disparo', salva: 'Salva en cruz', sonar: 'Sonar' };
    function roundHl(action) {
      if (st.ready[ME] || st.phase !== 'plan') return null;
      if (st.action !== action) return `#orderPanel button[data-arg="${action}"]`;
      if (st.order && !checkOrder(st.order)) return '#orderPanel button[data-cmd="confirm"]';
      return null;
    }

    const steps = [
      {
        kind: 'info', title: 'Bienvenido a Mar de Fondo', next: 'Empezar',
        text: () => `Vas a jugar una partida de práctica contra ${rival(1).name} y ${rival(2).name}. No hay reloj: avanzás a tu ritmo. Todos comparten este mismo océano y los barcos de los demás están escondidos.`,
      },
      {
        kind: 'deploy', title: 'Ubicá tu flota',
        text: 'Tus barcos solo pueden ir dentro del recuadro dorado, que es tu sector secreto. Tocá el mapa para ubicar cada barco, o usá <b>Al azar</b>. Con los cuatro ubicados, tocá <b>Listo para zarpar</b>.',
        hl: () => {
          if (st.ready[ME]) return null;
          return me().ships.length < M.FLEET.length ? '#orderPanel button[data-cmd="random"]' : '#orderPanel button[data-cmd="deployReady"]';
        },
      },
      {
        kind: 'info', title: 'Empieza la batalla',
        text: 'Las fronteras desaparecen. En cada ronda, todos eligen una jugada en secreto y después se ejecutan todas a la vez. Tus jugadas están en el panel de la derecha, y abajo de todo ves el estado de tu flota.',
        hl: () => '#orderPanel',
      },
      {
        kind: 'round', title: 'Tu primer disparo', action: 'shot',
        text: () => `<b>Disparo</b> ya está elegido. Tocá la casilla marcada en el mapa (${C(...tc(0))}) y después <b>Confirmar jugada</b>.`,
        mark: () => ({ cells: [tc(0)] }),
        check: o => same([o.x, o.y], tc(0)) ? null : 'Para este paso, tocá la casilla marcada en el mapa.',
        hl: () => roundHl('shot'),
      },
      {
        kind: 'info', title: '¡Impacto!',
        text: 'Donde pegaste salió fuego y humo. El humo lo ven todos los jugadores, pero nadie sabe quién disparó ni de quién es el barco. Para vos es una pista: ahí hay un barco.',
        mark: () => ({ cells: [tc(0)], quiet: true }),
      },
      {
        kind: 'round', title: 'Rematá', action: 'shot',
        text: () => `Los barcos ocupan varias casillas en línea, así que conviene seguir al lado del humo. Tocá ${C(...tc(1))} y confirmá.`,
        mark: () => ({ cells: [tc(1)] }),
        check: o => same([o.x, o.y], tc(1)) ? null : 'Para este paso, tocá la casilla marcada al lado del humo.',
        hl: () => roundHl('shot'),
        enter: () => {
          const target = me().ships.find(s => s.type === 'acorazado').cells[1];
          const [wx, wy] = waterCell();
          T.bots = {
            [rival(2).id]: { type: 'shot', x: target.x, y: target.y },
            [rival(1).id]: { type: 'shot', x: wx, y: wy },
          };
        },
      },
      {
        kind: 'info', title: 'También te dieron',
        text: () => `Esta ronda alguien le pegó a tu Acorazado: mirá el fuego sobre tu barco y la marca roja en tu flota, en el panel. El círculo blanco ${ev('miss').length ? `en ${C(ev('miss')[0].x, ev('miss')[0].y)} ` : ''}es un disparo que cayó al agua.`,
        hl: () => '#orderPanel .fleet',
      },
      {
        kind: 'round', title: 'Salva en cruz', action: 'salva',
        text: () => `Cada barco tiene una habilidad. El Acorazado dispara a 5 casillas en cruz. Elegí <b>Salva en cruz</b> en el panel, tocá ${C(...tc(1))} para centrarla y confirmá.`,
        mark: () => ({ cells: [tc(1)], cross: true }),
        check: o => same([o.x, o.y], tc(1)) ? null : 'Para este paso, centrá la salva en la casilla marcada.',
        hl: () => roundHl('salva'),
      },
      {
        kind: 'info', title: '¡Hundido!',
        text: () => {
          const r = ev('reward').find(e => e.pid === ME);
          return `Las cruces marcan un barco hundido: era la Fragata radar de ${rival(1).name}, que ahora se quedó sin sonar. ${r && r.ok ? 'Como premio por hundirlo se reparó la casilla dañada de tu Acorazado.' : 'Hundir un barco te da como premio una reparación.'} La salva queda recargando: el número en su botón dice cuántas rondas faltan.`;
        },
        hl: () => '#orderPanel button[data-arg="salva"]',
      },
      {
        kind: 'round', title: 'Sonar', action: 'sonar',
        text: 'Tu Fragata radar revisa una zona de 4x4 y te dice cuántas casillas con barcos enemigos hay, sin decir cuáles. Elegí <b>Sonar</b>, tocá dentro de la zona marcada y confirmá.',
        mark: () => ({ area: sonarArea() }),
        check: o => areaHasRival(o) ? null : 'Para este paso, tocá dentro de la zona marcada.',
        hl: () => roundHl('sonar'),
      },
      {
        kind: 'info', title: 'Lectura del sonar',
        text: () => {
          const s = ev('sonar').find(e => e.pid === ME);
          const n = s ? s.count : 0;
          return `El número en la esquina de la zona es ${n}: hay ${n} ${n === 1 ? 'casilla ocupada' : 'casillas ocupadas'} por barcos enemigos ahí adentro. Solo vos ves esa lectura. Es una buena zona para disparar en las próximas rondas.`;
        },
      },
      {
        kind: 'round', title: 'Caja de suministros', action: 'shot',
        text: () => { const c = crate(); return `Cada tanto cae una caja en el mapa, a la vista de todos, y se la lleva el primero que le dispara. Tocá la caja en ${C(c.x, c.y)} y confirmá.`; },
        mark: () => { const c = crate(); return { cells: [[c.x, c.y]] }; },
        check: o => { const c = crate(); return same([o.x, o.y], [c.x, c.y]) ? null : 'Para este paso, dispará a la caja marcada.'; },
        hl: () => roundHl('shot'),
      },
      {
        kind: 'info', title: 'Comodín',
        text: () => {
          const c = ev('crate').find(e => e.pid === ME);
          const w = c && c.wild ? M.WILDS[c.wild] : null;
          return `${w ? `Te tocó <b>${w.name}</b>: ${w.desc.toLowerCase()}.` : 'Te llevaste un comodín.'} Aparece en tu panel con borde punteado y se usa una sola vez, en lugar de tu jugada de la ronda.`;
        },
        hl: () => '#orderPanel .act.wild',
      },
      {
        kind: 'info', title: 'La tormenta',
        text: 'Así se ve la tormenta. Desde la ronda 10, los bordes del mapa dañan a los barcos que quedan ahí, y cada 3 rondas avanza hacia el centro (la línea punteada marca hasta dónde llega después). Conviene no dejar barcos en las orillas.',
        enter: () => { T.patch = v => { v.storm = 2; v.nextStorm = 3; }; ui.refreshView(); ui.R.lightning(); },
        leave: () => { T.patch = null; ui.refreshView(); },
      },
      {
        kind: 'info', title: 'Si te hunden todo',
        text: 'No quedás afuera: pasás a ser un fantasma. Cada ronda podés tapar una zona de 3x3 con niebla para que los demás no vean qué pasa ahí.',
      },
      {
        kind: 'buzz', title: 'Zumbidos',
        text: () => `En la lista de tripulación ves quién ya eligió su jugada. ${rival(2).name} sigue pensando: tocá <b>Zumbar</b> al lado de su nombre para apurarlo. Le tiembla la pantalla y le suena un aviso.`,
        enter: () => {
          const p = rival(2);
          st.ready[p.id] = false;
          st.botPlan[p.id] = { readyAt: Infinity };
          T.buzzed = false;
          ui.renderAll();
        },
        hl: () => T.buzzed ? null : `#players button[data-act="buzz"][data-pid="${rival(2).id}"]`,
      },
      {
        kind: 'info', title: 'Chat',
        text: 'En <b>General</b> escriben todos, y ahí también aparece la crónica de cada ronda. Con <b>Privado</b> abrís una conversación que solo ve esa persona: sirve para armar alianzas, y para traicionarlas.',
        hl: () => '.chat',
      },
      {
        kind: 'end', title: '¡Listo, capitán!',
        text: 'Ya sabés lo básico. En una partida de verdad cada ronda dura 25 segundos y los rivales disparan por su cuenta. Gana el último con barcos a flote.',
      },
    ];

    /* ---------- motor del guion ---------- */
    const cur = () => steps[T.i] || {};
    const val = (x) => (typeof x === 'function' ? x() : x);

    function go(i) {
      const old = cur();
      if (old.leave) old.leave();
      T.i = i;
      const s = cur();
      if (s.enter) s.enter();
      renderCard();
      ui.renderAll();
      decorate();
    }

    function renderCard() {
      const s = cur(), el = $('coach');
      if (!el) return;
      const n = steps.length;
      let btns = '';
      if (s.kind === 'info') btns = `<button class="btn" type="button" data-c="next">${s.next || 'Siguiente'}</button>`;
      if (s.kind === 'end') btns = `<button class="btn" type="button" data-c="play">Jugar una partida</button>
        <button class="btn ghost" type="button" data-c="keep">Seguir con esta</button>`;
      const waiting = { deploy: 'Esperando que ubiques tu flota', round: 'Esperando tu jugada', buzz: 'Esperando el zumbido' }[s.kind];
      el.innerHTML = `
        <div class="coach-head">
          <span>Tutorial · ${T.i + 1} de ${n}</span>
          <button type="button" class="coach-exit" data-c="exit">Salir</button>
        </div>
        <div class="coach-bar"><i style="width:${((T.i + 1) / n * 100).toFixed(1)}%"></i></div>
        <h3>${s.title}</h3>
        <p>${val(s.text)}</p>
        ${btns ? `<div class="coach-btns">${btns}</div>` : `<p class="coach-wait">${waiting}</p>`}`;
      el.hidden = false;
      // el cartel va arriba si lo marcado está en la mitad de abajo
      // el cartel se ubica del lado opuesto a lo que hay que mirar: la marca o, si no hay, tu flota
      const mk = s.mark ? s.mark() : null;
      let y;
      if (mk) y = mk.area ? mk.area.y + 2 : mk.cells[0][1];
      else {
        const cells = me().ships.flatMap(sh => sh.cells);
        y = cells.length ? cells.reduce((a, c) => a + c.y, 0) / cells.length : me().sector.y + me().sector.h / 2;
      }
      el.classList.toggle('top', y > g().size * 0.5);
      el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    }

    function onCardClick(e) {
      const b = e.target.closest('button[data-c]');
      if (!b) return;
      const c = b.dataset.c;
      if (c === 'next') go(T.i + 1);
      if (c === 'exit') ui.toMenu();
      if (c === 'play') ui.startGame(false);
      if (c === 'keep') ui.resumeNormal();
    }

    function decorate() {
      document.querySelectorAll('.coach-hl').forEach(el => el.classList.remove('coach-hl'));
      const s = cur();
      const sel = s.hl ? s.hl() : null;
      if (sel) document.querySelectorAll(sel).forEach(el => el.classList.add('coach-hl'));
      const R = ui.R;
      if (R) R.coach = s.mark && st.phase !== 'deploy' ? s.mark() : null;
    }

    function checkAction(arg) {
      const s = cur();
      if (s.kind === 'round') return arg === s.action ? null : `Para este paso elegí ${actionLabel[s.action]}.`;
      return 'Seguí las indicaciones del cartel del tutorial.';
    }

    function checkOrder(o) {
      const s = cur();
      if (s.kind !== 'round') return s.kind === 'end' ? null : 'Leé el cartel del tutorial y seguí sus pasos.';
      if (!o) return 'Elegí una casilla en el mapa.';
      const type = o.type === 'wild' ? o.wild : o.type;
      if (type !== s.action) return `Para este paso elegí ${actionLabel[s.action]}.`;
      return s.check ? s.check(o) : null;
    }

    const coachEl = $('coach');
    if (coachEl) coachEl.addEventListener('click', onCardClick);

    return {
      start() { T.i = -1; go(0); },
      onBeginRound() { if (T.i <= 1) go(2); else decorate(); },
      onResolved(events) {
        T.events = events;
        T.bots = null;
        if (cur().kind === 'round') go(T.i + 1);
      },
      onBuzz(pid) {
        if (cur().kind !== 'buzz' || pid !== rival(2).id || T.buzzed) return;
        T.buzzed = true;
        decorate();
        ui.later(() => go(T.i + 1), 2600);
      },
      fillOrders(orders) {
        g().players.forEach(p => { if (p.isBot) orders[p.id] = (T.bots && T.bots[p.id]) || { type: 'pass' }; });
      },
      patchView(v) { if (T.patch) T.patch(v); },
      checkAction, checkOrder, decorate,
      destroy() {
        const s = cur();
        if (s.leave) s.leave();
        T.i = -1;
        if (coachEl) { coachEl.hidden = true; coachEl.innerHTML = ''; coachEl.removeEventListener('click', onCardClick); }
        document.querySelectorAll('.coach-hl').forEach(el => el.classList.remove('coach-hl'));
        if (ui.R) ui.R.coach = null;
      },
    };
  }

  root.MDF.Tutorial = { create };
})(window);
