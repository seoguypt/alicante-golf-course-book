# Alicante Golf Course Book – hole images

Hole-by-hole images for three golf courses near Alicante, Spain, used by a golf caddie bot (Grok Bot template):

- `la-finca/` – La Finca Golf (Algorfa), holes 1–18
- `las-ramblas/` – Las Ramblas Golf (Orihuela Costa), holes 1–18
- `las-colinas/` – Las Colinas Golf & Country Club, holes 1–18

Per hole there are two images:

- `hole-N-sat.png` – satellite map with pins and distances (default card)
- `hole-N-drawn.png` – drawn (schematic) version of the same hole

Raw URL pattern: `https://raw.githubusercontent.com/seoguypt/alicante-golf-course-book/main/<course>/hole-<N>-<sat|drawn>.png`

The clubs' own official hole images are **not** included here; they remain the copyright of the clubs and can be viewed on their websites (lasramblasgolf.com, lascolinasgolf.com).

Distances on the maps are measured along the OpenStreetMap hole line from the mapped tee marker and are guidance only. Map legends are in English.

## Attribution

- Satellite imagery: PNOA cedido por © Instituto Geográfico Nacional (scne.es), CC BY 4.0
- Course features: © OpenStreetMap contributors, ODbL

The derived map images in this repository are made available under the same terms (CC BY 4.0 for the imagery, ODbL for the OpenStreetMap-derived course features). Please keep the attribution above when reusing them.

## GPS rangefinder (`gps/`)

A mobile web page for use during a round: <https://seoguypt.github.io/alicante-golf-course-book/gps/>

It uses the phone's GPS (in the browser, nothing is sent anywhere) to show distances to the front, middle and back of the green, mapped bunkers and water ahead (reach/carry), par, and a club suggestion based on your own carry distances (saved on the phone). The hole is detected automatically from the nearest OpenStreetMap hole line, with a manual −/+ override. Interface in Dutch. Distances come from the OpenStreetMap course map (© OpenStreetMap contributors, ODbL), not from today's flag position, and are accurate to a few metres plus the phone's GPS error. Las Ramblas hole 5 is not mapped, so no distances there.

The map panel shows your live position (dot + GPS accuracy circle, line to the green centre) with three views: *Satelliet* (IGN PNOA tiles, Leaflet), *Kaart* (OpenStreetMap tiles) and *Foto (offline)* (a georeferenced PNOA image per hole in `gps/img/`, tee at the bottom, cached for offline use). Imagery: PNOA cedido por © Instituto Geográfico Nacional (scne.es), CC BY 4.0. Leaflet (BSD-2) is included in `gps/leaflet/`.
