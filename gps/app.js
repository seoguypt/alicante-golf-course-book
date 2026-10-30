/* Golf GPS page logic. Distances: gps.js (same rules as tools/gps.py). Everything works offline except
   map tiles and the optional caddie relay. Nothing leaves the phone unless "Vraag caddie" is used. */
(function () {
  'use strict';
  var G = window.GolfGPS;
  var $ = function (id) { return document.getElementById(id); };
  var DEFAULT_RELAY = 'https://golf-caddie-relay.moneyfarm.workers.dev';  // deployed Cloudflare Worker (worker/)
  var CLUBS = ['D', '3W', '5W', '4H', '5H', '4i', '5i', '6i', '7i', '8i', '9i', 'PW', 'GW', 'SW', 'LW'];
  var LABEL = { D: 'Driver', '3W': 'Fairwayhout 3', '5W': 'Fairwayhout 5', '4H': 'Hybride 4', '5H': 'Hybride 5', '4i': 'IJzer 4', '5i': 'IJzer 5', '6i': 'IJzer 6',
    '7i': 'IJzer 7', '8i': 'IJzer 8', '9i': 'IJzer 9', PW: 'Pitching wedge', GW: 'Gap wedge', SW: 'Sand wedge', LW: 'Lob wedge' };
  var TYPICAL = { D: 210, '3W': 190, '5H': 170, '6i': 150, '7i': 140, '8i': 130, '9i': 120, PW: 105, SW: 80 };
  var ALIAS = { DR: 'D', DRIVER: 'D', FW: '3W', W3: '3W', '3H': '4H', H: '5H', HY: '5H', HYB: '5H', W5: '5W', P: 'PW', G: 'GW', S: 'SW', L: 'LW', AW: 'GW' };
  var st = { course: null, data: {}, book: {}, hole: 1, auto: true, pos: null, acc: null, res: null, wake: null, ball: null, picking: false, tab: 'kaart' };
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(t) { var e = $('toast'); e.textContent = t; e.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(function () { e.classList.remove('show'); }, 2200); }

  // ---------- clubs (Mijn afstanden) ----------
  function savedClubs() { try { var c = JSON.parse(ls('gps.clubs')); if (c && typeof c === 'object' && Object.keys(c).length) return c; } catch (e) {} return null; }
  function clubsObj() { return savedClubs() || TYPICAL; }
  function clubList() { var c = clubsObj(); return CLUBS.filter(function (k) { return c[k] > 0; }).map(function (k) { return { name: k, carry: +c[k] }; }); }
  function fav() { var f = parseInt(ls('gps.fav'), 10); if (f > 0) return f; var c = clubsObj(); return c.PW || 100; }
  function roll() { var r = ls('gps.roll'); r = r === null ? 5 : parseFloat(r); return isFinite(r) ? Math.max(0, Math.min(30, r)) : 5; }
  function tot(carry) { return Math.round(carry * (1 + roll() / 100)); }
  function parseCarries(str) {
    var out = {};
    String(str).split(/[,;\s]+/).forEach(function (t) {
      var m = t.match(/^([A-Za-z0-9]*?[A-Za-z])\s*[:=]?\s*(\d{2,3})$/) || t.match(/^(\d[A-Za-z]+)\s*[:=]?\s*(\d{2,3})$/);
      if (!m) return;
      var k = m[1].toUpperCase(); k = ALIAS[k] || k;
      var key = CLUBS.filter(function (c) { return c.toUpperCase() === k; })[0];
      var v = parseInt(m[2], 10);
      if (key && v >= 20 && v <= 350) out[key] = v;
    });
    return out;
  }
  function buildClubInputs(pref) {
    var box = $('clubInputs'), c = pref || savedClubs() || {}; box.innerHTML = '';
    CLUBS.forEach(function (k) {
      var l = document.createElement('label'); l.textContent = LABEL[k];
      var i = document.createElement('input'); i.type = 'number'; i.inputMode = 'numeric'; i.min = 20; i.max = 350; i.dataset.k = k;
      i.placeholder = TYPICAL[k] || ''; i.value = c[k] || ''; i.setAttribute('aria-label', LABEL[k] + ' carry in meter');
      l.appendChild(i); box.appendChild(l);
    });
    $('fav').value = ls('gps.fav') || ''; $('roll').value = ls('gps.roll') === null ? '' : ls('gps.roll');
  }
  function openDist(step) {
    var pref = null, m = location.hash.match(/carries=([^&]+)/i);
    if (m) pref = parseCarries(decodeURIComponent(m[1]));
    buildClubInputs(pref && Object.keys(pref).length ? pref : null);
    var r = location.hash.match(/roll=(\d{1,2})/i); if (r) $('roll').value = r[1];
    var f = location.hash.match(/fav=(\d{2,3})/i); if (f) $('fav').value = f[1];
    $('distStep').classList.toggle('hide', !step);
    $('distSheet').classList.remove('hide');
    setTimeout(function () { var i = $('clubInputs').querySelector('input'); if (i && !step) i.focus(); }, 50);
  }
  function closeDist() {
    $('distSheet').classList.add('hide');
    if (/carries=/i.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    var first = !ls('gps.onboarded'); ls('gps.onboarded', '1');
    planKey = null; render();
    if (first && !linked()) { showTab('caddie'); toast('Stap 2: koppel je bot (mag ook later)'); $('linkCard').scrollIntoView({ block: 'start' }); }
  }
  $('distSave').onclick = function () {
    var c = {};
    $('clubInputs').querySelectorAll('input').forEach(function (i) { var v = parseInt(i.value, 10); if (v >= 20 && v <= 350) c[i.dataset.k] = v; });
    if (Object.keys(c).length) ls('gps.clubs', JSON.stringify(c)); else ls('gps.clubs', null);
    var f = parseInt($('fav').value, 10); ls('gps.fav', f > 0 ? String(f) : null);
    var r = $('roll').value.trim(); ls('gps.roll', r === '' ? null : String(Math.max(0, Math.min(30, parseFloat(r) || 0))));
    toast(Object.keys(c).length ? 'Afstanden opgeslagen' : 'Geen afstanden ingevuld: typische tabel');
    closeDist();
  };
  $('distTypical').onclick = function () { ls('gps.clubs', null); toast('Typische tabel in gebruik'); closeDist(); };
  $('openDist').onclick = function () { openDist(false); };

  // ---------- course data ----------
  function loadCourse(id) {
    st.course = id; ls('gps.course', id); $('course').value = id;
    if (!st.book[id]) fetch(id + '-book.json').then(function (r) { return r.json(); }).then(function (b) { st.book[id] = b; render(); }).catch(function () {});
    if (st.data[id]) { afterLoad(); return; }
    fetch(id + '.json').then(function (r) { return r.json(); }).then(function (d) { st.data[id] = d; afterLoad(); })
      .catch(function () { st.err = 'Baangegevens laden mislukt. Controleer je verbinding.'; render(); });
  }
  function afterLoad() { if (st.auto) detect(true); render(); }
  function course() { return st.data[st.course]; }
  function cur() { var d = course(); return d ? d.holes[st.hole - 1] : null; }
  function bookHole() { var b = st.book[st.course]; return b ? b.holes[st.hole - 1] : null; }
  function detect(force) {
    var d = course(); if (!d || !st.pos) return;
    var r = G.detectHole(d, st.pos, force ? null : st.hole, 15);
    if (r.n && r.n !== st.hole) { st.hole = r.n; }
    st.off = r.off;
  }

  // ---------- render ----------
  function render() {
    var h = cur(), mapped = h && h.line;
    $('holeNo').textContent = 'Hole ' + st.hole;
    $('holePar').textContent = h ? ('Par ' + (h.par || '?') + ' · SI ' + (h.si || '?') + (h.geel ? ' · geel ' + h.geel + ' m' : '')) : '';
    $('auto').className = 'chip' + (st.auto ? ' on' : ''); $('auto').setAttribute('aria-pressed', st.auto ? 'true' : 'false');
    $('greenBox').classList.toggle('hide', !mapped); $('unmapped').classList.toggle('hide', !h || !!mapped);
    var s = $('status');
    if (st.err) { s.textContent = st.err; s.className = 'status bad'; }
    else if (!st.pos) { s.textContent = 'Wachten op GPS…'; s.className = 'status'; }
    else {
      var far = st.off != null && st.off > 400;
      s.textContent = 'GPS ±' + Math.round(st.acc) + ' m' + (st.acc > 15 ? ' (onnauwkeurig)' : '') + (st.auto ? ' · hole automatisch' : ' · hole handmatig') + (far ? ' · je lijkt niet op deze baan' : '');
      s.className = 'status' + ((st.acc > 15 || far) ? ' bad' : '');
    }
    st.res = (mapped && st.pos) ? G.compute(h, st.pos) : null;
    var r = st.res;
    $('gF').textContent = r && !r.flag_only ? r.green_front : '–'; $('gC').textContent = r ? r.green_centre : '–'; $('gB').textContent = r && !r.flag_only ? r.green_back : '–';
    $('flagNote').classList.toggle('hide', !(r && r.flag_only));
    hzList($('hazards'), r ? r.hazards : null, null, r ? 'Geen gekarteerde bunkers of water vooruit' : '–');
    var gp = r ? G.planFromPos(h, st.pos, clubList(), fav(), roll() / 100) : null, g0 = gp && gp.shots[0];
    $('clubAdv').innerHTML = g0 ? ('<b>' + esc(g0.club) + '</b>' + g0.carry + ' m' + (gp.fromTee && g0.total && g0.total !== g0.carry ? ' carry · ±' + g0.total + ' m totaal' : '')
      + '<span class="note2">' + (g0.kind === 'green' ? 'Naar het midden (' + r.green_centre + ' m)' : 'Lay-up: nog ' + g0.left + ' m daarna · ' + gp.n + ' slagen tot de green') + (gp.risky ? ' · let op: geen veilige landingsplek' : '') + '</span>')
      : (r ? '–' : 'Nog geen GPS-positie');
    if (st.ball && (st.ball.course !== st.course || st.ball.hole !== st.hole)) st.ball = null;
    renderBall(); drawMap(); renderPlan(); renderScore();
  }
  function hzList(box, list, shot, empty) {
    box.innerHTML = '';
    if (!list) { box.innerHTML = '<div class="hz">–</div>'; return; }
    if (!list.length) { box.innerHTML = '<div class="hz">' + esc(empty) + '</div>'; return; }
    list.slice(0, 6).forEach(function (z) {
      var danger = shot && shot >= z.reach - 5 && shot <= z.carry + 5;
      var e = document.createElement('div'); e.className = 'hz' + (/water/.test(z.kind) ? ' water' : '') + (danger ? ' danger' : '');
      e.innerHTML = '<span class="k">' + esc(z.label) + (danger ? ' · let op' : '') + '</span><span>bereik ' + z.reach + ' · carry ' + z.carry + ' m</span>';
      box.appendChild(e);
    });
  }

  // ---------- Mijn bal ----------
  function setBall(pos, src) { st.ball = { pos: pos, src: src, course: st.course, hole: st.hole, at: Date.now() }; stopPick(); render(); $('ballCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function startPick() {
    st.picking = true; document.body.classList.add('map-picking'); showTab('kaart');
    $('mapMsg').textContent = 'Tik op de kaart waar je bal ligt'; $('mapCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function stopPick() { st.picking = false; document.body.classList.remove('map-picking'); }
  $('barBall').onclick = function () {
    var h = cur(); if (!h || !h.line) { toast('Deze hole staat niet op de kaart'); return; }
    showTab('kaart');
    if (st.pos && st.acc <= 30 && G.lineDist(st.pos, h.line) < 400) setBall(st.pos.slice(), 'gps');
    else { startPick(); toast(st.pos ? 'GPS te onnauwkeurig of ver weg: tik op de kaart' : 'Geen GPS: tik op de kaart waar je bal ligt'); }
  };
  $('ballPick').onclick = startPick;
  $('ballClear').onclick = function () { st.ball = null; render(); };
  function shotTxt(x, first, fromTee) {
    if (x.kind === 'green') return '<b>' + esc(x.club) + '</b> naar de green <span class="t">(' + x.dist + ' m, carry ' + x.carry + ')</span>';
    var t = (fromTee && first && x.total && x.total !== x.carry) ? ' m carry, ±' + x.total + ' m totaal' : ' m';
    return '<b>' + esc(x.club) + '</b> ' + x.carry + t + ' <span class="t">→ nog ' + x.left + ' m</span>';
  }
  function renderBall() {
    var card = $('ballCard'), h = cur();
    if (!st.ball || !h || !h.line) { card.classList.add('hide'); return; }
    card.classList.remove('hide');
    var b = st.ball, r = G.compute(h, b.pos), p = G.planFromPos(h, b.pos, clubList(), fav(), roll() / 100);
    var off = Math.round(G.lineDist(b.pos, h.line));
    $('ballSrc').textContent = (b.src === 'gps' ? 'GPS' : 'gekozen op kaart') + ' · ' + new Date(b.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
    $('ballDist').innerHTML = r.flag_only ? '<div class="m" style="grid-column:1/-1"><span>Vlag (kaart)</span><b>' + r.green_centre + '</b></div>'
      : '<div><span>Voor</span><b>' + r.green_front + '</b></div><div class="m"><span>Midden</span><b>' + r.green_centre + '</b></div><div><span>Achter</span><b>' + r.green_back + '</b></div>';
    var s0 = p && p.shots[0], html = '';
    if (off > 80) html += '<p class="note warn">Je bal ligt ' + off + ' m van de holelijn. Klopt hole ' + st.hole + '?</p>';
    if (!s0) html += '–';
    else if (s0.kind === 'green') { var d = s0.carry - r.green_centre; html += '<b>' + esc(s0.club) + '</b> ' + s0.carry + ' m carry <span class="note2">' + (d === 0 ? 'precies naar het midden' : (d > 0 ? d + ' m langer dan midden' : (-d) + ' m korter dan midden')) + '</span>'; }
    else html += 'Green buiten bereik (' + r.green_centre + ' m). <b>' + esc(s0.club) + '</b> ' + s0.carry + ' m <span class="note2">Leg neer: nog ' + s0.left + ' m daarna' + (p.n > 1 ? ' (favoriet ' + fav() + ' m)' : '') + '</span>';
    if (p && p.risky) html += '<p class="note warn">Geen veilige landingsplek gevonden: dit plan landt bij een hindernis.</p>';
    $('ballShot').innerHTML = html;
    $('ballPlan').innerHTML = p && p.n > 1 ? p.shots.map(function (x, i) { return '<li>' + shotTxt(x, i === 0, p.fromTee) + '</li>'; }).join('') : '';
    $('ballLeft').textContent = p ? (p.n === 1 ? 'Nog 1 slag tot de green, dan putten.' : 'Nog ' + p.n + ' slagen tot de green, dan putten.') : '';
    hzList($('ballHz'), r.hazards, s0 ? s0.carry : null, 'Geen gekarteerde bunkers of water vooruit');
    st.ballPlan = p;
  }

  // ---------- Holeplan ----------
  var planKey = null;
  function renderPlan() {
    var h = cur(), bk = bookHole();
    $('planTitle').textContent = 'Hole ' + st.hole + (h ? ' · par ' + h.par + ' · SI ' + h.si : '');
    var key = st.course + ':' + st.hole + ':' + JSON.stringify(clubList()) + fav() + ':' + roll() + ':' + !!bk;
    if (key === planKey) return; planKey = key;
    if (h && h.line) {
      var p = G.planFromTee(h, clubList(), fav(), roll() / 100);
      $('planSub').textContent = 'Vanaf geel ' + (h.geel || '?') + ' m' + (p.mapLen && h.geel && Math.abs(p.mapLen - h.geel) > 15 ? ' (kaart ' + p.mapLen + ' m vanaf de gekarteerde tee)' : '') + ' · ' + (savedClubs() ? 'jouw afstanden' : 'typische tabel') + ' · uitrol ' + roll() + '%';
      $('planShots').innerHTML = p.shots.map(function (x, i) { return '<li>' + (i === 0 ? 'Afslag: ' : '') + shotTxt(x, i === 0, true) + '</li>'; }).join('')
        + (p.risky ? '<li class="t warn">Geen veilige landingsplek gevonden: kies zelf, dit plan landt bij een hindernis.</li>' : '');
      var hz = p.bands.map(function (b) { return { a: Math.round(b.a - p.s0), b: Math.round(b.b - p.s0), label: b.label, side: b.side, kind: b.kind }; }).filter(function (b) { return b.b > 0; });
      $('planHz').innerHTML = hz.length ? '<h3>Langs de lijn vanaf geel</h3>' + hz.map(function (b) { return '<div class="hz' + (/water/.test(b.kind) ? ' water' : '') + '"><span class="k">' + esc(b.label) + ' ' + b.side + '</span><span>' + Math.max(0, b.a) + '–' + b.b + ' m</span></div>'; }).join('') : '<h3>Langs de lijn</h3><div class="hz">Geen bunkers of water gekarteerd</div>';
    } else {
      $('planSub').textContent = 'Deze hole staat niet op de kaart; alleen het baanboek hieronder.'; $('planShots').innerHTML = ''; $('planHz').innerHTML = '';
    }
    function li(a) { return (a || []).map(function (t) { return '<li>' + esc(t) + '</li>'; }).join(''); }
    $('bookCard').classList.toggle('hide', !bk);
    if (bk) {
      $('bkPlan').innerHTML = li(bk.plan); $('bkGreen').innerHTML = li(bk.green); $('bkFacts').innerHTML = li(bk.feiten);
      $('bkOff').classList.toggle('hide', !bk.officieel); $('bkOffL').innerHTML = (bk.officieel || []).map(function (t) {
        var q = t.match(/“[^”]+”/g), src = t.split('“')[0].replace(/[:\s–-]+$/, '');
        return '<li>' + (q ? esc(q.join(' ')) + '<small class="src">Bron: ' + esc(src) + '</small>' : esc(t)) + '</li>'; }).join('');
      $('bkBook').classList.toggle('hide', !bk.boekjeImg);
      if (bk.boekjeImg) { $('bkImgA').href = bk.boekjeImg; $('bkImg').src = bk.boekjeImg; $('bkImg').alt = 'Caddyboekje hole ' + bk.n; $('bkBookT').textContent = (bk.boekje || '').replace(/\s*Afbeelding:\s*`[^`]*`\.?\s*$/, ''); }
      else $('bkImg').removeAttribute('src');
    }
  }
  window.__golf = { st: st, render: render, clubList: clubList, fav: fav, roll: roll, parseCarries: parseCarries };

  // ---------- tabs ----------
  var TABS = ['kaart', 'plan', 'caddie', 'score'];
  function showTab(t) {
    st.tab = t; try { sessionStorage.setItem('gps.tab', t); } catch (e) {}
    TABS.forEach(function (k) { var b = $('tab-' + k), on = k === t; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; $('p-' + k).classList.toggle('hide', !on); });
    if (t === 'kaart' && mv.map) setTimeout(function () { mv.map.invalidateSize(); drawMap(); }, 30);
  }
  TABS.forEach(function (k) { $('tab-' + k).onclick = function () { showTab(k); }; });

  $('prev').onclick = function () { st.auto = false; st.hole = st.hole > 1 ? st.hole - 1 : 18; render(); };
  $('next').onclick = function () { st.auto = false; st.hole = st.hole < 18 ? st.hole + 1 : 1; render(); };
  $('auto').onclick = function () { st.auto = true; detect(true); render(); };
  $('course').onchange = function () { st.auto = true; st.ball = null; loadCourse(this.value); };

  // ---------- map ----------
  var PNOA = 'https://www.ign.es/wmts/pnoa-ma?layer=OI.OrthoimageCoverage&style=default&tilematrixset=GoogleMapsCompatible&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/jpeg&TileMatrix={z}&TileCol={x}&TileRow={y}';
  var ATT_PNOA = 'PNOA cedido por © <a href="https://www.scne.es">Instituto Geográfico Nacional</a>, CC BY 4.0 · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ODbL';
  var ATT_OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, ODbL';
  // Touch phones: one finger scrolls the PAGE (map dragging off), pinch / +- zooms. Full screen turns dragging on.
  var COARSE = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || ('ontouchstart' in window);
  var mv = { mode: ls('gps.map') || 'sat', map: null, base: {}, feat: null, me: null, fitKey: null, tileErr: 0 };
  function setMode(m) {
    mv.mode = m; ls('gps.map', m);
    $('tSat').className = m === 'sat' ? 'on' : ''; $('tOsm').className = m === 'osm' ? 'on' : ''; $('tImg').className = m === 'img' ? 'on' : '';
    $('lmap').classList.toggle('hide', m === 'img'); $('smap').classList.toggle('hide', m !== 'img');
    if (m !== 'img') {
      ensureMap(); if (!mv.map) return;
      ['sat', 'osm'].forEach(function (k) { if (k === m) { if (!mv.map.hasLayer(mv.base[k])) mv.base[k].addTo(mv.map); } else if (mv.map.hasLayer(mv.base[k])) mv.map.removeLayer(mv.base[k]); });
      setTimeout(function () { mv.map.invalidateSize(); }, 50);
    }
    mv.fitKey = null; drawMap();
  }
  function setDrag() { if (!mv.map) return; var on = !COARSE || document.body.classList.contains('full'); if (on) mv.map.dragging.enable(); else mv.map.dragging.disable(); }
  function ensureMap() {
    if (mv.map || !window.L) return;
    mv.map = L.map('lmap', { zoomControl: true, attributionControl: true, maxZoom: 20, tap: false, scrollWheelZoom: !COARSE });
    mv.map.attributionControl.setPrefix(false);
    mv.base.sat = L.tileLayer(PNOA, { maxZoom: 20, maxNativeZoom: 19, attribution: ATT_PNOA });
    mv.base.osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 20, maxNativeZoom: 19, attribution: ATT_OSM });
    [mv.base.sat, mv.base.osm].forEach(function (t) { t.on('tileerror', function () { mv.tileErr++; if (mv.tileErr > 6 && !navigator.onLine) $('mapMsg').textContent = 'Geen internet: kies "Offline foto"'; }); t.on('tileload', function () { mv.tileErr = 0; }); });
    mv.feat = L.layerGroup().addTo(mv.map); mv.me = L.layerGroup().addTo(mv.map);
    mv.map.on('click', function (e) { if (st.picking) setBall([e.latlng.lat, e.latlng.lng], 'kaart'); });
    setDrag();
  }
  function hzStyle(k) { return k === 'bunker' ? { color: '#ffe066', weight: 2, fillColor: '#ffe066', fillOpacity: .35 } : { color: '#4dabf7', weight: 2, fillColor: '#4dabf7', fillOpacity: .35 }; }
  function aimPts() { var p = st.ball && st.ballPlan; return p ? [st.ball.pos].concat(p.shots.map(function (x) { return x.at; })) : null; }
  function drawMap() {
    var h = cur(), msg = '';
    $('mapCard').classList.toggle('hide', !(h && h.line));
    if (!h || !h.line || st.tab !== 'kaart') return;
    var cen = G.target(h), key = st.course + ':' + h.n + ':' + mv.mode;
    if (mv.mode === 'img') msg = drawStatic(h, cen);
    else if (mv.map) {
      if (mv.fitKey !== key) {
        mv.feat.clearLayers();
        L.polyline(h.line, { color: '#fff', weight: 3, dashArray: '6 6', interactive: false }).addTo(mv.feat);
        (h.hz || []).forEach(function (z) { L.polygon(z.g, Object.assign({ interactive: false }, hzStyle(z.k))).addTo(mv.feat); });
        if (h.green) L.polygon(h.green, { color: '#39ff14', weight: 3, fillOpacity: .15, interactive: false }).addTo(mv.feat); else L.circleMarker(cen, { radius: 7, color: '#fff', weight: 2, fillColor: '#39ff14', fillOpacity: 1, interactive: false }).addTo(mv.feat);
        mv.map.fitBounds(L.latLngBounds(h.line.concat(h.green || [])), { padding: [20, 20] });
        mv.fitKey = key;
      }
      mv.me.clearLayers();
      if (st.pos) {
        L.circle(st.pos, { radius: st.acc || 5, color: '#1c7ed6', weight: 1, fillColor: '#1c7ed6', fillOpacity: .18, interactive: false }).addTo(mv.me);
        if (!st.ball && st.res && st.res.green_centre >= 15) L.polyline([st.pos, cen], { color: '#fff', weight: 3, interactive: false }).addTo(mv.me)
          .bindTooltip(st.res.green_centre + ' m', { permanent: true, direction: 'center', className: 'dist-label' });
        L.circleMarker(st.pos, { radius: 9, color: '#fff', weight: 3, fillColor: '#e03131', fillOpacity: 1, interactive: false }).addTo(mv.me);
        if (!st.ball && !mv.map.getBounds().pad(-0.05).contains(st.pos)) msg = 'Je positie valt buiten beeld (zoom uit)';
      }
      var a = aimPts();
      if (a) {
        L.polyline(a, { color: '#ffd43b', weight: 4, dashArray: '10 6', interactive: false }).addTo(mv.me);
        st.ballPlan.shots.forEach(function (x) { L.circleMarker(x.at, { radius: 6, color: '#000', weight: 2, fillColor: '#ffd43b', fillOpacity: 1, interactive: false }).addTo(mv.me).bindTooltip(x.club + (x.kind === 'green' ? '' : ' → ' + x.left), { permanent: true, direction: 'right', offset: [8, 0], className: 'shot-label' }); });
        L.circleMarker(st.ball.pos, { radius: 9, color: '#000', weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(mv.me);
      }
    }
    $('mapMsg').textContent = st.picking ? 'Tik op de kaart waar je bal ligt' : (msg || (!st.pos && !st.ball ? 'Wachten op GPS… (of tik "Hier ligt mijn bal")' : ''));
  }
  function ns(tag, at) { var e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (var k in at) e.setAttribute(k, at[k]); return e; }
  var sv = { key: null, dyn: null, svg: null };
  function drawStatic(h, cen) {
    var im = h.img, box = $('smap');
    if (!im) { box.innerHTML = ''; sv.key = null; return 'Geen foto voor deze hole'; }
    var P = function (p) { return G.imgPx(im, p); }, pts = function (g) { return g.map(function (p) { return P(p).map(function (v) { return v.toFixed(1); }).join(','); }).join(' '); };
    var key = st.course + ':' + h.n;
    if (sv.key !== key) {
      box.innerHTML = '';
      var svg = ns('svg', { viewBox: '0 0 ' + im.w + ' ' + im.h, preserveAspectRatio: 'xMidYMid meet' });
      svg.appendChild(ns('image', { href: im.f, x: 0, y: 0, width: im.w, height: im.h }));
      svg.appendChild(ns('polyline', { points: pts(h.line), fill: 'none', stroke: '#fff', 'stroke-width': 3, 'stroke-dasharray': '8 8' }));
      (h.hz || []).forEach(function (z) { var b = z.k === 'bunker' ? '#ffe066' : '#4dabf7'; svg.appendChild(ns('polygon', { points: pts(z.g), fill: b, 'fill-opacity': .3, stroke: b, 'stroke-width': 2 })); });
      if (h.green) svg.appendChild(ns('polygon', { points: pts(h.green), fill: '#39ff14', 'fill-opacity': .15, stroke: '#39ff14', 'stroke-width': 3 }));
      else { var fp = P(cen); svg.appendChild(ns('circle', { cx: fp[0], cy: fp[1], r: 7, fill: '#39ff14', stroke: '#fff', 'stroke-width': 2 })); }
      sv.dyn = ns('g', {}); svg.appendChild(sv.dyn); box.appendChild(svg); sv.key = key; sv.svg = svg;
      svg.addEventListener('click', function (e) {
        if (!st.picking) return;
        var pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
        var q = pt.matrixTransform(svg.getScreenCTM().inverse());
        setBall(G.imgLatLng(cur().img, [q.x, q.y]), 'kaart');
      });
    }
    var g = sv.dyn, out = ''; while (g.firstChild) g.removeChild(g.firstChild);
    var bw = box.clientWidth || 300, bh = box.clientHeight || 300, k = Math.max(1, Math.min(4, Math.max(im.w / bw, im.h / bh)));
    function label(x, y, t, fill) {
      var w = (t.length * 9 + 12) * k;
      g.appendChild(ns('rect', { x: x - w / 2, y: y - 13 * k, width: w, height: 25 * k, rx: 4 * k, fill: fill, stroke: '#000', 'stroke-width': 1.5 * k }));
      var tx = ns('text', { x: x, y: y + 6 * k, 'text-anchor': 'middle', 'font-size': 16 * k, 'font-weight': 900, fill: '#000' }); tx.textContent = t; g.appendChild(tx);
    }
    if (st.pos) {
      var m = P(st.pos), c = P(cen), r = Math.max(4, (st.acc || 5) * im.sc);
      if (m[0] < 0 || m[1] < 0 || m[0] > im.w || m[1] > im.h) out = 'Je positie valt buiten deze foto';
      g.appendChild(ns('circle', { cx: m[0], cy: m[1], r: r, fill: '#1c7ed6', 'fill-opacity': .2, stroke: '#1c7ed6', 'stroke-width': 2 }));
      if (!st.ball && st.res && st.res.green_centre >= 15) {
        g.appendChild(ns('line', { x1: m[0], y1: m[1], x2: c[0], y2: c[1], stroke: '#fff', 'stroke-width': 2.5 * k }));
        label((m[0] + c[0]) / 2, (m[1] + c[1]) / 2, st.res.green_centre + ' m', '#fff');
      }
      g.appendChild(ns('circle', { cx: m[0], cy: m[1], r: 8 * k, fill: '#e03131', stroke: '#fff', 'stroke-width': 3 * k }));
    }
    var a = aimPts();
    if (a) {
      var px = a.map(P);
      g.appendChild(ns('polyline', { points: px.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '), fill: 'none', stroke: '#ffd43b', 'stroke-width': 3.5 * k, 'stroke-dasharray': (10 * k) + ' ' + (6 * k) }));
      st.ballPlan.shots.forEach(function (x, i) { var p = px[i + 1]; g.appendChild(ns('circle', { cx: p[0], cy: p[1], r: 6 * k, fill: '#ffd43b', stroke: '#000', 'stroke-width': 2 * k })); label(p[0] + 34 * k, p[1], x.club + (x.kind === 'green' ? '' : ' → ' + x.left), '#ffd43b'); });
      g.appendChild(ns('circle', { cx: px[0][0], cy: px[0][1], r: 8 * k, fill: '#fff', stroke: '#000', 'stroke-width': 3 * k }));
    }
    return out;
  }
  $('tSat').onclick = function () { setMode('sat'); };
  $('tOsm').onclick = function () { setMode('osm'); };
  $('tImg').onclick = function () { setMode('img'); };
  $('enlarge').onclick = function () {
    var full = document.body.classList.toggle('full');
    $('enlarge').innerHTML = '<svg width="22" height="22"><use href="#' + (full ? 'i-close' : 'i-expand') + '"/></svg>';
    $('enlarge').setAttribute('aria-label', full ? 'Kaart verkleinen' : 'Kaart vergroten');
    setDrag(); mv.fitKey = null; setTimeout(function () { if (mv.map) mv.map.invalidateSize(); drawMap(); }, 60);
  };
  window.addEventListener('offline', function () { if (mv.mode !== 'img') setMode('img'); });

  // ---------- caddie relay (page -> relay -> player's OWN bot webhook -> relay -> page) ----------
  function rnd(n) { var a = new Uint8Array(n); crypto.getRandomValues(a); return btoa(String.fromCharCode.apply(null, a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function sess() {
    var s = null; try { s = JSON.parse(sessionStorage.getItem('gps.sess')); } catch (e) {}
    if (!s || !s.id) { s = { id: rnd(18), tok: rnd(24) }; try { sessionStorage.setItem('gps.sess', JSON.stringify(s)); } catch (e) {} }
    return s;
  }
  function cfg() { return { hook: ls('gps.hook') || '', auth: ls('gps.auth') || '', relay: (ls('gps.relay') || DEFAULT_RELAY).replace(/\/+$/, '') }; }
  function linked() { var c = cfg(); return !!(c.hook && c.auth); }
  // Accepts "https://… Authorization: Bearer …", "Bearer …", a bare key, JSON, any order, or one at a time.
  function parseLink(t) {
    var out = {}; t = String(t || '');
    var u = t.match(/https:\/\/[^\s"'<>]+/i); if (u) out.url = u[0].replace(/[),.;\]}]+$/, '');
    else if (/http:\/\/\S+/i.test(t)) out.badUrl = true;
    var rest = u ? t.replace(u[0], ' ') : t, m;
    if ((m = rest.match(/authorization["']?\s*[:=]\s*["']?([^\r\n"'}]+)/i))) out.auth = m[1].trim().replace(/[,;]+$/, '');
    else if ((m = rest.match(/\b(Bearer|Basic|Token)\s+([A-Za-z0-9._~+\/=-]{8,})/i))) out.auth = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() + ' ' + m[2];
    else {
      var toks = rest.split(/[\s"',;{}:]+/).filter(function (x) { return /^[A-Za-z0-9._~+\/=-]{16,}$/.test(x) && !/^(authorization|webhook)/i.test(x); });
      toks.sort(function (a, b) { return b.length - a.length; });
      if (toks[0]) out.auth = 'Bearer ' + toks[0];
    }
    if (out.auth && /^(bearer|basic|token)$/i.test(out.auth)) delete out.auth;
    return out;
  }
  function ck(id, ok, txt) { var e = $(id); e.className = ok ? 'ok' : ''; e.querySelector('use').setAttribute('href', ok ? '#i-check' : '#i-dot'); e.querySelector('span').textContent = txt; }
  function linkUI() {
    var c = cfg();
    ck('ckUrl', !!c.hook, c.hook ? 'Webhook-adres' : 'Webhook-adres ontbreekt');
    ck('ckKey', !!c.auth, c.auth ? 'Sleutel' : 'Sleutel ontbreekt');
    $('linkState').textContent = linked() ? 'Gekoppeld. Plak opnieuw om te wijzigen.' : 'Nog niet gekoppeld. Je bot stuurt je een koppeling: kopieer die en plak hem hieronder.';
    $('linkPaste').placeholder = linked() ? 'Gekoppeld (plak opnieuw om te wijzigen)' : 'Plak het webhook-adres en de sleutel (samen of na elkaar)';
    $('sRelay').value = c.relay;
  }
  $('linkPaste').addEventListener('input', function () {
    var p = parseLink(this.value), got = [];
    if (p.badUrl && !p.url) { lmsg('Het adres moet met https:// beginnen.', 'bad'); return; }
    if (p.url) { ls('gps.hook', p.url); got.push('adres'); }
    if (p.auth) { ls('gps.auth', p.auth); got.push('sleutel'); }
    if (!got.length) { if (this.value.trim()) lmsg('Ik herken hier geen webhook-adres of sleutel in.', 'bad'); return; }
    this.value = ''; linkUI();
    lmsg(linked() ? 'Opgeslagen. Tik nu op Test koppeling.' : (p.url ? 'Adres gevonden. Plak nu ook de sleutel.' : 'Sleutel gevonden. Plak nu ook het webhook-adres.'), 'good');
  });
  function lmsg(t, cls) { var e = $('linkMsg'); e.textContent = t; e.className = 'meta' + (cls ? ' ' + cls : ''); }
  $('sSave').onclick = function () { var r = $('sRelay').value.trim(); if (r && !/^https:\/\//.test(r)) { toast('Relay-adres moet met https:// beginnen'); return; } ls('gps.relay', r && r !== DEFAULT_RELAY ? r : null); linkUI(); toast('Opgeslagen'); };
  $('sClear').onclick = function () { if (!confirm('Koppeling met je bot wissen?')) return; ['gps.hook', 'gps.auth', 'gps.relay'].forEach(function (k) { ls(k, null); }); linkUI(); lmsg(''); toast('Koppeling gewist'); };

  function errText(x) {
    if (x.s === 409) { try { sessionStorage.removeItem('gps.sess'); } catch (e) {} return 'Sessie verlopen. Probeer het nog een keer.'; }
    if (x.s === 429) return 'Even wachten en dan opnieuw proberen.';
    if (x.s === 502 && (x.j.upstreamStatus === 401 || x.j.upstreamStatus === 403)) return 'Je bot weigert de sleutel. Plak de koppeling opnieuw.';
    if (x.s === 502 && x.j.upstreamStatus === 404) return 'Het webhook-adres bestaat niet (meer). Vraag je bot om een nieuwe koppeling.';
    if (x.s === 502) return 'Je bot is niet bereikbaar' + (x.j.upstreamStatus ? ' (' + x.j.upstreamStatus + ')' : '') + '. Controleer het webhook-adres.';
    if (x.s === 400 && /webhook/i.test(x.j.error || '')) return 'Dit webhook-adres wordt niet geaccepteerd. Plak de koppeling opnieuw.';
    return 'Versturen mislukt (' + (x.j.error || x.s) + ').';
  }
  var poll = { t: null, n: 0 };
  function stopPoll() { if (poll.t) clearTimeout(poll.t); poll.t = null; $('ask').disabled = false; $('linkTest').disabled = false; $('barAsk').disabled = false; }
  function fallbackPos() { var d = course(), h = cur() || (d && d.holes[0]); if (h && h.line) return { p: h.line[0], a: 0, hole: st.hole }; var h1 = d && d.holes.filter(function (x) { return x.line; })[0]; return h1 ? { p: h1.line[0], a: 0, hole: h1.n } : null; }
  function ask(question, test, done) {
    var c = cfg();
    if (!c.hook || !c.auth) { done({ err: 'Nog niet gekoppeld. Plak eerst de koppeling van je bot.', nolink: true }); return; }
    var where = st.ball ? { p: st.ball.pos, a: st.ball.src === 'gps' ? st.acc : 0, hole: st.hole } : (st.pos ? { p: st.pos, a: st.acc, hole: st.hole } : (test ? fallbackPos() : null));
    if (!where) { done({ err: 'Nog geen GPS-positie. Tik "Hier ligt mijn bal" en kies je plek op de kaart.' }); return; }
    var s = sess(), since = Date.now() - 1000, body = {
      session: s.id, replyToken: s.tok, course: st.course, hole: where.hole, lat: +where.p[0].toFixed(6), lon: +where.p[1].toFixed(6), accuracy: Math.round(where.a || 0),
      question: question, webhookUrl: c.hook, authHeader: c.auth };
    if (test) body.test = true;
    var sc = savedClubs(); if (sc) { body.carries = sc; body.rollPct = roll(); }
    stopPoll(); $('ask').disabled = $('linkTest').disabled = $('barAsk').disabled = true;
    done({ stage: 'sending' });
    fetch(c.relay + '/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { s: r.status, j: j }; }); })
      .then(function (x) {
        if (x.s !== 202) { stopPoll(); done({ err: errText(x) }); return; }
        done({ stage: 'waiting' }); poll.n = 0;
        var max = test ? 20 : 40;
        (function tick() {
          poll.t = setTimeout(function () {
            fetch(c.relay + '/reply/' + encodeURIComponent(s.id) + '?since=' + since, { headers: { 'X-Reply-Token': s.tok }, cache: 'no-store' })
              .then(function (r) { return r.status === 200 ? r.json() : null; })
              .then(function (j) { if (j && j.reply) { stopPoll(); done({ reply: j.reply, at: j.at }); } else if (++poll.n >= max) { stopPoll(); done({ err: test ? 'Je bot antwoordde niet binnen een minuut. Staat de webhook-routine aan?' : 'Nog geen antwoord na 2 minuten. Kijk in je chat met de bot of probeer opnieuw.' }); } else tick(); },
                function () { if (++poll.n >= max) { stopPoll(); done({ err: 'Geen internetverbinding.' }); } else tick(); });
          }, 3000);
        })();
      }, function () { stopPoll(); done({ err: 'Geen internetverbinding (of de relay is onbereikbaar).' }); });
  }
  function hist() { try { return JSON.parse(sessionStorage.getItem('gps.chat')) || []; } catch (e) { return []; } }
  function renderHist() {
    var h = hist().slice(0, -1).reverse();  // newest answer is shown above; older ones here
    $('history').innerHTML = h.length ? '<h3>Eerder deze ronde</h3>' + h.map(function (x) { return '<div class="qa"><div class="q">' + esc('Hole ' + x.hole + ': ' + x.q) + '</div><div class="a">' + esc(x.a) + '</div></div>'; }).join('') : '';
  }
  function doAsk() {
    var q = $('askQ').value.trim() || 'geef me advies voor deze slag', hole = st.hole;
    showTab('caddie');
    ask(q, false, function (r) {
      var m = $('replyMeta');
      if (r.stage === 'sending') { $('reply').textContent = ''; m.textContent = 'Versturen…'; m.className = 'meta'; return; }
      if (r.stage === 'waiting') { m.textContent = 'Caddie denkt na…'; return; }
      if (r.err) { m.textContent = r.err; m.className = 'meta bad'; if (r.nolink) $('linkCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      m.textContent = 'Caddie · ' + new Date(r.at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) + ' · ' + q; m.className = 'meta';
      $('reply').textContent = r.reply; $('askQ').value = '';
      var h = hist(); h.push({ q: q, a: r.reply, hole: hole, at: r.at }); h = h.slice(-12); try { sessionStorage.setItem('gps.chat', JSON.stringify(h)); } catch (e) {}
      renderHist();
    });
  }
  $('ask').onclick = doAsk;
  $('askQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') doAsk(); });
  $('barAsk').onclick = function () { if (!linked()) { showTab('caddie'); $('linkCard').scrollIntoView({ behavior: 'smooth', block: 'start' }); toast('Koppel eerst je bot'); return; } doAsk(); };
  $('linkTest').onclick = function () {
    ask('TEST', true, function (r) {
      if (r.stage === 'sending') { lmsg('Testen…'); return; }
      if (r.stage === 'waiting') { lmsg('Je bot is bereikt, wachten op antwoord…'); return; }
      if (r.err) { lmsg(r.err, 'bad'); return; }
      lmsg('Gelukt! Je bot antwoordde: ' + r.reply, 'good');
    });
  };

  // ---------- scorekaart ----------
  var NOTE = {
    'la-finca': 'La Finca: de RFEG noemt ook een tijdelijke lay-out met par 68. Vraag bij de start welke lay-out geldt; deze kaart telt met de pars uit het baanboek.',
    'las-ramblas': 'Las Ramblas: pars volgens de club (hole 4 par 5, hole 10 par 3; OpenStreetMap zegt bij beide par 4).'
  };
  function card() { var c = null; try { c = JSON.parse(ls('gps.score.' + st.course)); } catch (e) {} if (!c || !c.players) { c = { players: [] }; try { (JSON.parse(ls('gps.players')) || []).forEach(function (p) { c.players.push({ name: p.name, hcp: p.hcp, s: [] }); }); } catch (e) {} } return c; }
  function saveCard(c) { ls('gps.score.' + st.course, JSON.stringify(c)); ls('gps.players', JSON.stringify(c.players.map(function (p) { return { name: p.name, hcp: p.hcp }; }))); }
  function pars() { var d = course(); return d ? d.holes.map(function (h) { return h.par || 4; }) : []; }
  function sis() { var d = course(); return d ? d.holes.map(function (h) { return h.si || 18; }) : []; }
  function recv(hcp, si) { if (!(hcp > 0)) return 0; var ph = Math.round(hcp); return Math.floor(ph / 18) + (si <= ph % 18 ? 1 : 0); }
  function stb(p, i) { var s = p.s[i]; if (!s) return null; return Math.max(0, 2 + pars()[i] + recv(p.hcp, sis()[i]) - s); }
  function vs(n) { return n === 0 ? 'E' : (n > 0 ? '+' + n : String(n)); }
  function sum(p, a, b) { var t = 0, par = 0, pts = 0, n = 0, P = pars(); for (var i = a; i < b; i++) if (p.s[i]) { t += p.s[i]; par += P[i]; pts += stb(p, i); n++; } return { t: t, d: t - par, pts: pts, n: n }; }
  function renderScore() {
    var c = card(), i = st.hole - 1, P = pars(), S = sis(), on = ls('gps.stbf') === '1';
    $('scHoleT').textContent = 'Hole ' + st.hole; $('scHoleP').textContent = P.length ? 'Par ' + P[i] + ' · SI ' + S[i] : '';
    $('stbf').checked = on;
    var box = $('scNow'); box.innerHTML = '';
    if (!c.players.length) box.innerHTML = '<p class="sub">Voeg hieronder spelers toe. Tik + om slagen te tellen; de eerste tik zet par.</p>';
    c.players.forEach(function (p, k) {
      var tot = sum(p, 0, 18), r = document.createElement('div'); r.className = 'prow';
      r.innerHTML = '<div class="nm">' + esc(p.name) + '<small>' + (p.hcp != null ? 'hcp ' + p.hcp + ' · ' : '') + (tot.n ? vs(tot.d) + ' na ' + tot.n + (on ? ' · ' + tot.pts + ' pt' : '') : 'nog geen score') + '</small></div>'
        + '<button class="sq" aria-label="Eén slag minder voor ' + esc(p.name) + '">−</button><div class="val">' + (p.s[i] || '–') + '</div><button class="sq" aria-label="Eén slag meer voor ' + esc(p.name) + '">+</button>';
      var b = r.querySelectorAll('button');
      b[0].onclick = function () { var cc = card(), q = cc.players[k]; if (q.s[i] > 1) q.s[i]--; else q.s[i] = null; saveCard(cc); renderScore(); };
      b[1].onclick = function () { var cc = card(), q = cc.players[k]; q.s[i] = q.s[i] ? Math.min(15, q.s[i] + 1) : P[i]; saveCard(cc); renderScore(); };
      box.appendChild(r);
    });
    // table
    var T = $('scTable'), h = '<thead><tr><th>Hole</th><th>Par</th><th>SI</th>' + c.players.map(function (p, k) { return '<th>' + esc(p.name) + ' <button class="x" data-k="' + k + '" aria-label="' + esc(p.name) + ' verwijderen" style="border:0;background:none;font-weight:900;min-width:32px;min-height:32px">×</button></th>'; }).join('') + '</tr></thead><tbody>';
    function cell(p, i) { var s = p.s[i]; if (!s) return '<td>·</td>'; var d = s - P[i]; return '<td><span class="' + (d < 0 ? 'under' : d > 0 ? 'over' : '') + '">' + s + '</span>' + (on ? ' <small>' + stb(p, i) + '</small>' : '') + '</td>'; }
    function totRow(lbl, a, b) { var par = 0; for (var j = a; j < b; j++) par += P[j] || 0; return '<tr class="tot"><td>' + lbl + '</td><td>' + par + '</td><td></td>' + c.players.map(function (p) { var x = sum(p, a, b); return '<td>' + (x.n ? x.t + ' (' + vs(x.d) + ')' + (on ? ' ' + x.pts + 'pt' : '') : '–') + '</td>'; }).join('') + '</tr>'; }
    for (var j = 0; j < P.length; j++) {
      h += '<tr data-h="' + (j + 1) + '"' + (j === i ? ' class="cur"' : '') + '><td>' + (j + 1) + '</td><td>' + P[j] + '</td><td>' + S[j] + '</td>' + c.players.map(function (p) { return cell(p, j); }).join('') + '</tr>';
      if (j === 8) h += totRow('Uit', 0, 9);
    }
    if (P.length) h += totRow('In', 9, 18) + totRow('Totaal', 0, 18);
    T.innerHTML = h + '</tbody>';
    T.querySelectorAll('tr[data-h]').forEach(function (tr) { tr.onclick = function () { st.auto = false; st.hole = +tr.dataset.h; render(); }; });
    T.querySelectorAll('button.x').forEach(function (bt) { bt.onclick = function (e) { e.stopPropagation(); var cc = card(), p = cc.players[+bt.dataset.k]; if (!confirm(p.name + ' verwijderen van de scorekaart?')) return; cc.players.splice(+bt.dataset.k, 1); saveCard(cc); renderScore(); }; });
    $('scNote').textContent = (NOTE[st.course] || '') + (on ? ' Stableford: vereenvoudigd met je handicap als slagen (niet de officiële course handicap van de tee).' : '');
  }
  $('pAdd').onclick = function () {
    var n = $('pName').value.trim(); if (!n) { $('pName').focus(); return; }
    var hc = parseFloat(String($('pHcp').value).replace(',', '.')), c = card();
    c.players.push({ name: n.slice(0, 20), hcp: isFinite(hc) ? Math.max(0, Math.min(54, hc)) : null, s: [] }); saveCard(c);
    $('pName').value = ''; $('pHcp').value = ''; renderScore();
  };
  $('stbf').onchange = function () { ls('gps.stbf', this.checked ? '1' : null); renderScore(); };
  $('scReset').onclick = function () { if (!confirm('Nieuwe ronde: alle scores op deze baan wissen? Spelers blijven staan.')) return; var c = card(); c.players.forEach(function (p) { p.s = []; }); saveCard(c); renderScore(); toast('Scores gewist'); };
  function copyText(txt, ok) {
    function fallback() { var t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); toast(ok); } catch (e) { prompt('Kopieer deze tekst:', txt); } t.remove(); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { toast(ok); }, fallback); else fallback();
  }
  $('scCopy').onclick = function () {
    var c = card(), d = course(), P = pars(), on = ls('gps.stbf') === '1';
    var lines = [(d ? d.name : st.course) + ' · ' + new Date().toLocaleDateString('nl-NL')];
    c.players.forEach(function (p) {
      var o = sum(p, 0, 9), i2 = sum(p, 9, 18), t = sum(p, 0, 18);
      lines.push(p.name + (p.hcp != null ? ' (hcp ' + p.hcp + ')' : '') + ': ' + (t.n ? t.t + ' slagen (' + vs(t.d) + ')' + ' · uit ' + (o.n ? o.t : '–') + ' · in ' + (i2.n ? i2.t : '–') + (on ? ' · ' + t.pts + ' stableford' : '') + ' · ' + t.n + ' holes' : 'geen score'));
      lines.push('  ' + P.map(function (_, j) { return p.s[j] || '-'; }).join(' '));
    });
    if (!c.players.length) lines.push('Nog geen spelers');
    copyText(lines.join('\n'), 'Scorekaart gekopieerd');
  };

  // ---------- settings ----------
  $('copy').onclick = function () {
    var d = course(), where = st.ball ? st.ball.pos : st.pos;
    var txt = where ? ('Locatie: ' + where[0].toFixed(6) + ',' + where[1].toFixed(6) + ' – ' + (d ? d.name : st.course) + ' hole ' + st.hole
      + (st.res ? (st.res.flag_only ? ', ' + st.res.green_centre + ' m tot de vlag (kaart)' : ', ' + st.res.green_centre + ' m tot midden (voor ' + st.res.green_front + ', achter ' + st.res.green_back + ')') : '') + (st.ball ? '' : ' – GPS ±' + Math.round(st.acc) + ' m'))
      : ((d ? d.name : st.course) + ' hole ' + st.hole + ' – nog geen GPS-positie');
    copyText(txt, 'Gekopieerd – plak in je caddie-chat');
  };
  function wakeTxt(on) { $('wake').textContent = 'Scherm aan houden: ' + (on ? 'aan' : 'uit'); $('wake').setAttribute('aria-pressed', on ? 'true' : 'false'); }
  $('wake').onclick = function () {
    if (!('wakeLock' in navigator)) { toast('Niet ondersteund op deze telefoon'); return; }
    if (st.wake) { st.wantWake = false; st.wake.release(); st.wake = null; wakeTxt(false); return; }
    st.wantWake = true; navigator.wakeLock.request('screen').then(function (w) { st.wake = w; wakeTxt(true);
      w.addEventListener('release', function () { if (st.wake === w) { st.wake = null; wakeTxt(false); } }); })
      .catch(function () { toast('Scherm aan houden lukt niet'); });
  };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && st.wantWake && !st.wake && 'wakeLock' in navigator)
      navigator.wakeLock.request('screen').then(function (w) { st.wake = w; wakeTxt(true); }).catch(function () {});
  });
  $('saveOffline').onclick = function () {
    var d = course(); if (!d) return;
    var fs = d.holes.filter(function (h) { return h.img; }).map(function (h) { return h.img.f; });
    if (!('caches' in window)) { toast('Offline opslaan niet ondersteund'); return; }
    caches.open('golf-gps-img').then(function (c) { return c.addAll(fs); }).then(function () { toast(fs.length + " holefoto's opgeslagen"); }, function () { toast('Opslaan mislukt'); });
  };

  function startGPS() {
    if (!('geolocation' in navigator)) { st.err = 'Deze browser heeft geen GPS-toegang.'; render(); return; }
    navigator.geolocation.watchPosition(function (p) {
      st.err = null; st.pos = [p.coords.latitude, p.coords.longitude]; st.acc = p.coords.accuracy;
      if (st.auto) detect(false); else { var d = course(); if (d) st.off = G.detectHole(d, st.pos, null).off; }
      render();
    }, function (e) {
      st.err = e.code === 1 ? 'Locatie geweigerd. Sta locatie toe voor deze site in je browserinstellingen (of tik "Hier ligt mijn bal").' : 'Geen GPS-signaal (' + e.message + ')';
      render();
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
  }

  // ---------- start ----------
  linkUI(); renderHist();
  var t0 = null; try { t0 = sessionStorage.getItem('gps.tab'); } catch (e) {}
  showTab(TABS.indexOf(t0) >= 0 ? t0 : 'kaart');
  setMode(navigator.onLine === false ? 'img' : mv.mode);
  loadCourse(ls('gps.course') || 'la-finca');
  if (!ls('gps.onboarded') || /carries=/i.test(location.hash)) openDist(!ls('gps.onboarded'));
  startGPS();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
