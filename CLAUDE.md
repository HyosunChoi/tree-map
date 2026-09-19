# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install dependencies
- `npm run dev` — start Vite dev server (http://localhost:5173)
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the production build locally

There is no test suite, linter, or type checker configured in this project.

## Project purpose

A mobile-first personal field-note app for logging trees encountered while walking. Current scope (MVP) is intentionally limited: no login, no server/database, no AI species identification, no photo upload. All data lives in the browser only.

## Architecture

Plain Vite + vanilla JS (no framework, no TypeScript). Three files carry all the logic:

- `src/storage.js` — sole interface to persistence. Reads/writes a single localStorage key (`tree-map:records`) holding a JSON array of records (`{ id, species, memo, lat, lng, createdAt }`). Any change to the record shape should go through this module's `getRecords` / `addRecord` / `deleteRecord` functions rather than touching `localStorage` elsewhere.
- `src/main.js` — everything else: Leaflet map setup, `navigator.geolocation` handling, DOM wiring for the form/list, and keeping the map markers in sync with storage. State (current geolocation fix, `id -> L.Marker` map, the current-location marker/accuracy circle) is held in a single module-level `state` object rather than framework state; the map itself (`L.marker`) is the source of truth for what's rendered, and `storage.js` is the source of truth for what's persisted — `renderMarker`/`removeMarker` keep the two in sync on every save/delete.
  - The user's own position is shown separately from saved trees: a blue-dot `L.divIcon` (`state.currentLocationMarker`) plus a faint `L.circle` sized to `position.coords.accuracy` (`state.accuracyCircle`), both updated in place (`setLatLng`/`setRadius`) rather than recreated, and never touched by `renderMarker`/`removeMarker`/tree save-delete flow.
  - Geolocation is one-shot (`getCurrentPosition`, no `watchPosition`), triggered on initial load, by the on-map "내 위치" `LocateControl` (top-right, large touch target), and by the "다시 시도" retry button that appears only when the last fix failed. Every successful fix recenters the map at `LOCATION_ZOOM` (17); `DEFAULT_ZOOM` (15) is only the pre-fix/static and record-list-click zoom.
  - `requestLocation`/`setLocationStatus` drive the `#location-value` status text and `el.retryLocationBtn` visibility for all states (checking, success + rounded accuracy, permission denied, timeout, unsupported browser, unexpected error via try/catch) — keep messages user-facing in Korean and never let a geolocation failure throw past this boundary.
- `src/style.css` — mobile-first; layout switches from stacked (map / form / list) to a two-column grid (map | form+list) at `720px` via a single media query.

Leaflet's default marker icon assets require the `L.Icon.Default.mergeOptions` workaround at the top of `main.js` (importing the PNGs directly) because Vite doesn't resolve Leaflet's CSS-relative image paths — keep this if touching marker icons.

## Deployment

Targets Vercel. `vercel.json` sets `outputDirectory: dist` and rewrites all paths to `index.html` (needed even though there's currently no client-side router, in case one is added later). No environment variables are used.
