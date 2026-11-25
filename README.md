# Earth Time Machine

Pick any place on Earth and see it from every side, on one map that stays put while you switch views.

**Open it:** https://earthtimemachine.github.io

## Views (lenses)

| Lens | What it shows |
|---|---|
| Overview | Weather and air now, top alerts, latest Sentinel-2 pass, rulers through time, main crops, notable places, local headlines |
| Imagery | NASA daily (VIIRS/MODIS), Sentinel-2 (10 m, since 2016), Esri Wayback aerial photos (since 2014), Landsat (since 1984). Swipe-compare and time-lapse |
| Hazards | Cyclones (GDACS), IMD-style heat waves, heavy rain and flash floods, river floods (GloFAS), wildfires, air quality (CAMS), 16-day outlook |
| Routes | Road route between two places (OSRM), detour vs straight line, estimated shortcut links with water, rail and road crossings, slope and villages served |
| History | Who ruled the place across 2,000+ years with currency and capital, tectonic plate, the rock beneath, and where the land drifted (GPlates) |
| Economy | Top crops, services, manufacturing, universities, mines and quarries |
| Explore | Sights, restaurants (vegetarian filter) and places to stay |
| News | Local news (GDELT) newest first, ending on the selected or compared date |

The place, map view and dates are shared across lenses and kept in the link, so any view can be shared with the link button.

## Layout

- `index.html` — home page
- `app.html` — the app shell; `css/app.css` design system
- `js/core.js` (state, events, fetch), `js/map.js` (map and layers), `js/shell.js` (tabs, search, mobile sheet)
- `js/lenses/*.js` — one module per lens
- `data/` — simplified historical borders and plate boundaries; `vendor/` — Leaflet and Esri Wayback core
- `daily.html`, `hires.html`, `hazards.html`, `history.html`, `resources.html`, `explore.html`, `news.html` — redirects from the old pages

No build step: plain ES modules served by GitHub Pages.

## Place search

`js/search.js` powers every search box. By default it uses Photon (OpenStreetMap, search-as-you-type, typo-tolerant, biased to the map view) with Nominatim as fallback. To use Google's place search instead, put a Google Maps Platform key with **Places API (New)** enabled in `js/config.js`, restricted to the referrer `https://earthtimemachine.github.io/*`.

## Data sources

NASA GIBS, Microsoft Planetary Computer, Esri World Imagery and Wayback, Open-Meteo (forecast, archive, flood, air quality, elevation), GDACS, historical-basemaps (GPL-3.0), PB2002 plates, Macrostrat, GPlates Web Service, Wikipedia and Wikidata, OpenStreetMap (Nominatim, Overpass), GDELT, OSRM (OpenStreetMap routing).
