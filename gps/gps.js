/* Distance logic for the Alicante golf GPS page. Plain JS, works in browser and node. */
(function (root) {
  var R = 6371000, rad = Math.PI / 180;
  function dist(a, b) {
    var p1 = a[0] * rad, p2 = b[0] * rad, dp = p2 - p1, dl = (b[1] - a[1]) * rad;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function minD(me, g) { var m = Infinity; for (var i = 0; i < g.length; i++) m = Math.min(m, dist(me, g[i])); return m; }
  function maxD(me, g) { var m = 0; for (var i = 0; i < g.length; i++) m = Math.max(m, dist(me, g[i])); return m; }
  function centroid(g) { var a = 0, b = 0; for (var i = 0; i < g.length; i++) { a += g[i][0]; b += g[i][1]; } return [a / g.length, b / g.length]; }
  // distance from point to polyline (segments), local flat projection — used for hole detection
  function lineDist(me, line) {
    var kx = Math.cos(me[0] * rad) * R * rad, ky = R * rad, best = Infinity;
    for (var i = 0; i < line.length - 1; i++) {
      var ax = (line[i][1] - me[1]) * kx, ay = (line[i][0] - me[0]) * ky;
      var bx = (line[i + 1][1] - me[1]) * kx, by = (line[i + 1][0] - me[0]) * ky;
      var dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      var t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
      var px = ax + t * dx, py = ay + t * dy;
      best = Math.min(best, Math.sqrt(px * px + py * py));
    }
    if (line.length === 1) best = dist(me, line[0]);
    return best;
  }
  // nearest mapped hole; with hysteresis: keep `current` unless another is >margin m nearer
  function detectHole(course, me, current, margin) {
    margin = margin == null ? 15 : margin;
    var best = null, bestD = Infinity, curD = Infinity;
    course.holes.forEach(function (h) {
      if (!h.line) return;
      var d = lineDist(me, h.line);
      if (d < bestD) { bestD = d; best = h.n; }
      if (h.n === current) curD = d;
    });
    if (current != null && curD < Infinity && curD - bestD < margin) return { n: current, off: Math.round(curD) };
    return { n: best, off: Math.round(bestD) };
  }
  var KIND = { bunker: 'Bunker', water_hazard: 'Water', lateral_water_hazard: 'Water (zijkant)', water: 'Water' };
  // Same rules as tools/gps.py. opts.aheadOnly (default true) also drops hazards that lie entirely
  // behind the player (every point farther from the green centre than the player is).
  function compute(hole, me, opts) {
    opts = opts || {};
    if (!hole || !hole.line) return null;
    var line = hole.line, flag = line[line.length - 1], g = hole.green, cen = g ? centroid(g) : flag;
    // no green mapped near the flag: centre = OSM flag (end of hole line), no front/back
    var out = { hole: hole.n, flag_only: !g, green_front: g ? Math.round(minD(me, g)) : null, green_centre: Math.round(dist(me, cen)),
      green_back: g ? Math.round(maxD(me, g)) : Math.round(dist(me, cen)), to_flag_osm: Math.round(dist(me, line[line.length - 1])),
      from_tee: Math.round(dist(me, line[0])), hazards: [] };
    var meToCen = dist(me, cen);
    (hole.hz || []).forEach(function (f) {
      var reach = minD(me, f.g), carry = maxD(me, f.g);
      if (carry >= out.green_back + 30) return;
      if (opts.aheadOnly !== false && minD(cen, f.g) > meToCen) return;
      out.hazards.push({ kind: f.k, label: KIND[f.k] || f.k, reach: Math.round(reach), carry: Math.round(carry) });
    });
    out.hazards.sort(function (a, b) { return a.reach - b.reach; });
    return out;
  }
  // clubs: [{name, carry}] ; returns {club, carry, mode, note}
  function adviseClub(clubs, res) {
    clubs = clubs.filter(function (c) { return c.carry > 0; }).sort(function (a, b) { return b.carry - a.carry; });
    if (!clubs.length || !res) return null;
    var d = res.green_centre, longest = clubs[0], shortest = clubs[clubs.length - 1];
    if (d > longest.carry + 10) {
      // too far to reach: longest club whose landing spot is not inside a hazard (5 m margin)
      var hz = res.hazards.filter(function (h) { return h.reach > 20; });
      for (var i = 0; i < clubs.length; i++) {
        var c = clubs[i], bad = hz.filter(function (h) { return c.carry >= h.reach - 5 && c.carry <= h.carry + 5; })[0];
        if (!bad) {
          var block = null;
          if (i > 0) block = hz.filter(function (h) { return clubs[0].carry >= h.reach - 5 && clubs[0].carry <= h.carry + 5; })[0];
          var note = (i === 0 ? 'Green buiten bereik' : 'Lay-up: blijf kort van ' + (block ? block.label.toLowerCase() + ' (' + block.reach + ' m)' : 'de hindernis'))
            + '; nog ' + (d - c.carry) + ' m na deze slag';
          return { club: c.name, carry: c.carry, mode: i === 0 ? 'vol' : 'layup', note: note };
        }
      }
      return { club: shortest.name, carry: shortest.carry, mode: 'layup', note: 'Overal hindernissen; speel kort en veilig' };
    }
    if (d < shortest.carry - 15) return { club: shortest.name, carry: shortest.carry, mode: 'kort', note: 'Korter dan je kortste club: halve slag of chip' };
    var best = clubs[0];
    clubs.forEach(function (c) { if (Math.abs(c.carry - d) < Math.abs(best.carry - d)) best = c; });
    var diff = best.carry - d;
    return { club: best.name, carry: best.carry, mode: 'green',
      note: diff === 0 ? 'Precies je carry' : (diff > 0 ? best.carry + ' m carry, ' + diff + ' m langer dan midden' : best.carry + ' m carry, ' + (-diff) + ' m korter dan midden') };
  }
  // pixel position on the static georeferenced hole image (see tools/render_gps_imgs.py)
  function imgPx(img, p) {
    var x = (p[1] - img.c[1]) * img.kx, y = (p[0] - img.c[0]) * img.ky, c = Math.cos(img.th), s = Math.sin(img.th);
    var rx = x * c - y * s, ry = x * s + y * c;
    return [img.w / 2 + (img.ox || 0) + rx * img.sc, img.h / 2 + (img.oy || 0) - ry * img.sc];
  }

  // ---------- shot planning along the hole line ----------
  // local flat projection of p onto the polyline: s = metres along the line from line[0], lat = signed offset (+ = right)
  function proj(line, p) {
    var o = line[0], kx = Math.cos(o[0] * rad) * R * rad, ky = R * rad, acc = 0, best = null;
    function xy(q) { return [(q[1] - o[1]) * kx, (q[0] - o[0]) * ky]; }
    var P = xy(p);
    for (var i = 0; i < line.length - 1; i++) {
      var A = xy(line[i]), B = xy(line[i + 1]), dx = B[0] - A[0], dy = B[1] - A[1], L = Math.sqrt(dx * dx + dy * dy) || 1e-9;
      var t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / (L * L);
      var last = i === line.length - 2, first = i === 0;
      var tc = Math.max(first ? -Infinity : 0, Math.min(last ? Infinity : 1, t));
      var X = A[0] + tc * dx, Y = A[1] + tc * dy, d = Math.sqrt((P[0] - X) * (P[0] - X) + (P[1] - Y) * (P[1] - Y));
      var side = (dx * (P[1] - A[1]) - dy * (P[0] - A[0])) > 0 ? -1 : 1; // + = right of travel direction
      if (!best || d < best.d) best = { s: acc + tc * L, lat: side * d, d: d };
      acc += L;
    }
    return { s: best.s, lat: best.lat };
  }
  function inPoly(p, g) {
    var x = p[1], y = p[0], c = false;
    for (var i = 0, j = g.length - 1; i < g.length; j = i++) {
      var xi = g[i][1], yi = g[i][0], xj = g[j][1], yj = g[j][0];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c;
    }
    return c;
  }
  function lineLen(line) { var t = 0; for (var i = 0; i < line.length - 1; i++) t += dist(line[i], line[i + 1]); return t; }
  // point at distance s along the line (extrapolates past the ends)
  function pointAt(line, s) {
    var acc = 0;
    for (var i = 0; i < line.length - 1; i++) {
      var L = dist(line[i], line[i + 1]);
      if (s <= acc + L || i === line.length - 2) {
        var t = L ? (s - acc) / L : 0; if (i === 0 && s < 0) t = s / (L || 1);
        return [line[i][0] + (line[i + 1][0] - line[i][0]) * t, line[i][1] + (line[i + 1][1] - line[i][1]) * t];
      }
      acc += L;
    }
    return line[line.length - 1];
  }
  // hazards near the line as bands [a, b] in metres along the line (bunkers/water within maxLat m of the line)
  function bands(hole, maxLat) {
    maxLat = maxLat == null ? 25 : maxLat;
    var out = [];
    (hole.hz || []).forEach(function (f) {
      var a = Infinity, b = -Infinity, ml = Infinity, sl = 0;
      f.g.forEach(function (q) { var r = proj(hole.line, q); a = Math.min(a, r.s); b = Math.max(b, r.s); ml = Math.min(ml, Math.abs(r.lat)); sl += r.lat; });
      if (ml > maxLat) return;
      out.push({ kind: f.k, label: KIND[f.k] || f.k, a: a, b: b, side: ml < 3 ? 'op de lijn' : (sl > 0 ? 'rechts' : 'links') });
    });
    return out.sort(function (x, y) { return x.a - y.a; });
  }
  // Plan the shots from position s0 (metres along the line) to the green target.
  // clubs [{name, carry}], fav = preferred approach distance. Fewest shots first, then the approach closest to fav,
  // then the longest first shot. Landing spots inside a hazard band (±5 m) are not allowed, except the green itself.
  function planShots(hole, s0, clubs, fav, opts) {
    opts = opts || {};
    clubs = clubs.filter(function (c) { return c.carry > 0; }).sort(function (a, b) { return b.carry - a.carry; });
    if (!hole || !hole.line || !clubs.length) return null;
    var tgt = target(hole), L = proj(hole.line, tgt).s, B = opts.bands || bands(hole);
    fav = fav || 100;
    // a landing spot is bad when the line point there (±6 m) is inside a bunker/water or within 8 m of one
    var HZ = (hole.hz || []).map(function (f) { return { k: f.k, label: KIND[f.k] || f.k, g: f.g.concat([f.g[0]]) }; });
    function nearHz(q) {
      for (var i = 0; i < HZ.length; i++) { var g = HZ[i].g; if (inPoly(q, g) || lineDist(q, g) <= 8) return HZ[i]; }
      return null;
    }
    function inBand(x) {
      if (opts.relaxed) return null;
      for (var d = -6; d <= 6; d += 6) { var h = nearHz(pointAt(hole.line, x + d)); if (h) return h; }
      return null;
    }
    var memo = {};
    function best(s, depth) {
      var R = L - s, key = Math.round(s) + ':' + depth;
      if (key in memo) return memo[key];
      var res = null;
      // driver only off the tee (first shot of a plan from the tee)
      var cl = (depth === 0 && opts.fromTee) ? clubs : clubs.filter(function (c) { return c.name !== 'D'; });
      if (!cl.length) cl = clubs;
      var longest = cl[0].carry;
      if (R <= longest + 10) {
        var fc = cl[0]; cl.forEach(function (c) { if (Math.abs(c.carry - R) < Math.abs(fc.carry - R)) fc = c; });
        res = { n: 1, pen: 0, shots: [{ club: fc.name, carry: fc.carry, from: s, land: L, dist: Math.round(R), kind: 'green' }] };
      } else if (depth < 6) {
        cl.forEach(function (c) {
          // off the tee the ball rolls out (opts.roll, e.g. 0.05); elsewhere plan on carry only
          var tot = (depth === 0 && opts.fromTee && opts.roll) ? Math.round(c.carry * (1 + opts.roll)) : c.carry;
          var land = s + c.carry, rest = s + tot;
          if (rest >= L - 15 || inBand(land) || (rest !== land && inBand(rest))) return;
          var r = best(rest, depth + 1); if (!r) return;
          var pen = r.n === 1 ? Math.round(Math.abs((L - rest) - fav) / 10) : r.pen;
          var cand = { n: r.n + 1, pen: pen, shots: [{ club: c.name, carry: c.carry, total: tot, from: s, land: rest, dist: c.carry, kind: 'layup' }].concat(r.shots) };
          if (!res || cand.n < res.n || (cand.n === res.n && (cand.pen < res.pen || (cand.pen === res.pen && c.carry > res.shots[0].carry)))) res = cand;
        });
      }
      memo[key] = res; return res;
    }
    var r = best(s0, 0);
    if (!r && !opts.relaxed) { var rr = planShots(hole, s0, clubs, fav, { bands: B, relaxed: true, fromTee: opts.fromTee, roll: opts.roll }); if (rr) rr.risky = true; return rr; }
    if (!r) return { shots: [], n: 0, L: L, s0: s0, bands: B, blocked: true };
    r.shots.forEach(function (x) { x.left = Math.round(L - (x.kind === 'green' ? L : x.land)); x.at = pointAt(hole.line, Math.min(x.land, L)); if (x.kind === 'green') x.at = tgt; });
    return { shots: r.shots, n: r.n, L: L, s0: s0, bands: B };
  }
  // plan from the yellow tee: the book's yellow length vs the mapped line
  function planFromTee(hole, clubs, fav, roll) {
    if (!hole || !hole.line) return null;
    var L = proj(hole.line, target(hole)).s, s0 = hole.geel ? L - hole.geel : 0;
    var p = planShots(hole, s0, clubs, fav, { fromTee: true, roll: roll || 0 }); if (p) p.mapLen = Math.round(lineLen(hole.line)); return p;
  }
  // plan from any position (ball): remaining = straight distance to the green centre, like compute()
  function planFromPos(hole, me, clubs, fav, roll) {
    if (!hole || !hole.line) return null;
    var L = proj(hole.line, target(hole)).s, rem = dist(me, target(hole));
    var tee = dist(me, hole.line[0]) <= 30;  // standing on the (mapped) tee: driver allowed, roll-out counts
    var p = planShots(hole, L - rem, clubs, fav, { fromTee: tee, roll: tee ? (roll || 0) : 0 });
    if (p) p.fromTee = tee;
    return p;
  }
  function imgLatLng(img, px) {
    var rx = (px[0] - img.w / 2 - (img.ox || 0)) / img.sc, ry = -(px[1] - img.h / 2 - (img.oy || 0)) / img.sc, c = Math.cos(img.th), s = Math.sin(img.th);
    var x = rx * c + ry * s, y = -rx * s + ry * c;
    return [img.c[0] + y / img.ky, img.c[1] + x / img.kx];
  }
  function target(hole) { return hole.green ? centroid(hole.green) : hole.line[hole.line.length - 1]; }
  var api = { inPoly: inPoly, proj: proj, lineLen: lineLen, pointAt: pointAt, bands: bands, planShots: planShots, planFromTee: planFromTee, planFromPos: planFromPos, imgLatLng: imgLatLng, target: target, imgPx: imgPx, dist: dist, centroid: centroid, lineDist: lineDist, detectHole: detectHole, compute: compute, adviseClub: adviseClub };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GolfGPS = api;
})(this);
