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
  function target(hole) { return hole.green ? centroid(hole.green) : hole.line[hole.line.length - 1]; }
  var api = { target: target, imgPx: imgPx, dist: dist, centroid: centroid, lineDist: lineDist, detectHole: detectHole, compute: compute, adviseClub: adviseClub };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GolfGPS = api;
})(this);
