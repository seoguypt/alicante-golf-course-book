#!/usr/bin/env python3
"""Usage: gps.py <course> <hole> <lat> <lon>
Distances (m) from the player's position to the hole's green (front/centre/back)
and to mapped bunkers/water, from OpenStreetMap features in feats.json."""
import json, math, sys
course, hole, lat, lon = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
feats = json.load(open(f"/workspace/coursebook/{course}/feats.json"))
def dist(a, b):
    R=6371000; p1,p2=math.radians(a[0]),math.radians(b[0]); dp=p2-p1; dl=math.radians(b[1]-a[1])
    h=math.sin(dp/2)**2+math.cos(p1)*math.cos(p2)*math.sin(dl/2)**2; return 2*R*math.asin(math.sqrt(h))
me=(lat,lon)
holes=[f for f in feats if f['tags'].get('golf')=='hole' and str(f['tags'].get('ref'))==str(hole)]
if not holes: print(json.dumps({"error":f"hole {hole} not mapped"})); sys.exit()
line=holes[0]['geom']; tee, flag = line[0], line[-1]
def near(f, pt, r=60): return min(dist(g, pt) for g in f['geom']) < r
greens=[f for f in feats if f['tags'].get('golf')=='green' and f.get('geom')]
green=min(greens, key=lambda f: min(dist(g, flag) for g in f['geom']))
if min(dist(g, flag) for g in green['geom']) > 60:
    print(json.dumps({"course":course,"hole":hole,"green_not_mapped":True,"to_flag_osm":round(dist(me,flag)),
      "from_tee":round(dist(me,tee)),"off_hole_line_m":round(min(dist(me,p) for p in line)),
      "note":"No green mapped at this hole; distance is to the flag at the end of the mapped hole line."})); sys.exit()
gd=[dist(me,g) for g in green['geom']]
cen=(sum(g[0] for g in green['geom'])/len(green['geom']), sum(g[1] for g in green['geom'])/len(green['geom']))
# corridor: features within 40 m of the hole line
def seg_near(f): return any(min(dist(g,p) for p in line) < 80 for g in f['geom'])
out={"course":course,"hole":hole,"to_flag_osm":round(dist(me,flag)),"green_front":round(min(gd)),
     "green_centre":round(dist(me,cen)),"green_back":round(max(gd)),"from_tee":round(dist(me,tee)),
     "off_hole_line_m":round(min(dist(me,p) for p in line)),"hazards":[]}
for f in feats:
    k=f['tags'].get('golf') or f['tags'].get('natural')
    if k in ('bunker','water_hazard','lateral_water_hazard','water') and f.get('geom') and seg_near(f):
        d=[dist(me,g) for g in f['geom']]
        if max(d) < out["green_back"]+30:
            out["hazards"].append({"kind":k,"reach":round(min(d)),"carry":round(max(d))})
out["hazards"].sort(key=lambda h:h["reach"])
print(json.dumps(out))
