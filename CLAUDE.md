# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` — install dependencies
- `npm run dev` — start Vite dev server (http://localhost:5173)
- `npm run build` — production build to `dist/`
- `npm run preview` — serve the production build locally

There is no test suite, linter, or type checker configured in this project.

## Project purpose

A mobile-first personal field-note app for logging trees encountered while walking. Current scope (MVP) is intentionally limited: no sign-up/login screen, no AI species identification, no photo upload. Records are stored in Supabase (shared across devices/users, scoped by an anonymous auth identity) with localStorage kept as an offline cache/fallback — see "Data storage" below.

## Environment variables

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — from the Supabase project's API settings. Copy `.env.example` to `.env.local` (gitignored) for local dev, and set the same two vars in the Vercel project settings for deploys. The anon key is a public/publishable key by design (RLS enforces access control server-side) — never put the `service_role` key here or anywhere in frontend code.
- If these are unset, `src/supabaseClient.js` exports `supabase = null` and every `storage.js` function transparently falls back to localStorage-only behavior (same as before Supabase was added) instead of throwing — the app must keep working with zero config.

## Data storage

- `supabase/schema.sql` — run once in the Supabase SQL Editor against a fresh project: creates the `trees` table, indexes, and the four RLS policies (see below). Also enable **Authentication → Sign In / Providers → Anonymous Sign-Ins** in the dashboard first; the SQL alone doesn't turn that on.
- `trees` row shape: `id uuid`, `owner_id uuid` (→ `auth.users.id`), `species text`, `notes text?`, `latitude`/`longitude double precision`, `accuracy_m double precision?`, `observed_at timestamptz`, `created_at timestamptz default now()`.
- RLS: any `authenticated` session (anonymous sessions get this role too) may `select` all rows; `insert`/`update`/`delete` require `owner_id = auth.uid()`. `src/storage.js`'s `deleteRecord` re-checks this by reading back the deleted row (`.select('id')`) since a Postgres RLS-blocked delete returns 0 rows rather than an error.
- `src/supabaseClient.js` — creates the Supabase client from the env vars above (or `null` if absent) and `ensureSession()`, a memoized anonymous-sign-in (`auth.signInAnonymously()`) called lazily by every `storage.js` function that needs `auth.uid()`. There is no login UI; this is the entire auth flow.
- `src/storage.js` — sole interface to persistence, and the only file that touches `localStorage` (cache key `tree-map:records`) or calls Supabase directly. `getRecords`/`addRecord`/`deleteRecord` are now **async** and each return a `{ ..., source: 'remote' | 'cache' | 'error', error? }` shape so `main.js` can distinguish "worked", "fell back to cache", and "failed" without throwing. Supabase is the primary source; on any failure (offline, RLS, missing config) reads fall back to the last-written local cache and writes/deletes surface `source: 'error'`/`success: false` instead of silently no-oping.
  - One-time migration: the first `getRecords()` call after a session is established uploads any pre-existing local records via `upsert(..., { onConflict: 'id' })` (their ids are already UUIDs from `crypto.randomUUID()`), then sets the `tree-map:migrated` localStorage flag so it never re-runs. If the upsert fails, the flag is *not* set, so it retries on the next load instead of losing the records.
  - Row ↔ app-record mapping lives in `rowToRecord`/`recordToRow` — app code (`main.js`) still works with `{ id, ownerId, species, memo, lat, lng, accuracy, createdAt }`; `notes`/`latitude`/`longitude`/`accuracy_m`/`observed_at` are Supabase-column names that never leak past this module.
- `src/main.js` — everything else: Leaflet map setup, `navigator.geolocation` handling, DOM wiring for the form/list, and keeping the map markers in sync with `state.records` (an in-memory mirror of the last `storage.js` result — `main.js` never re-fetches from Supabase just to re-render the list, only on initial load/save/delete). State (current geolocation fix, `id -> L.Marker` map, the current-location marker/accuracy circle, `records`, `ownerId`) is held in a single module-level `state` object rather than framework state; `renderMarker`/`removeMarker` keep the map in sync with `state.records` on every save/delete.
  - Delete buttons are only rendered for records the current session owns (`canDeleteRecord`: `!record.ownerId || record.ownerId === state.ownerId`) — records with no `ownerId` predate Supabase or mean Supabase isn't configured, so they're always treated as the local user's own.
  - `setSaveStatus`/`#save-status` and `setSyncStatus`/`#sync-status` surface save failures and "showing cached data" fallback state to the user; keep messages user-facing in Korean and never let a Supabase failure throw past `storage.js`'s boundary.
  - The user's own position is shown separately from saved trees: a blue-dot `L.divIcon` (`state.currentLocationMarker`) plus a faint `L.circle` sized to `position.coords.accuracy` (`state.accuracyCircle`), both updated in place (`setLatLng`/`setRadius`) rather than recreated, and never touched by `renderMarker`/`removeMarker`/tree save-delete flow.
  - Geolocation is one-shot (`getCurrentPosition`, no `watchPosition`), triggered on initial load, by the on-map "내 위치" `LocateControl` (top-right, large touch target), and by the "다시 시도" retry button that appears only when the last fix failed. Every successful fix recenters the map at `LOCATION_ZOOM` (17); `DEFAULT_ZOOM` (15) is only the pre-fix/static and record-list-click zoom.
  - `requestLocation`/`setLocationStatus` drive the `#location-value` status text and `el.retryLocationBtn` visibility for all states (checking, success + rounded accuracy, permission denied, timeout, unsupported browser, unexpected error via try/catch) — keep messages user-facing in Korean and never let a geolocation failure throw past this boundary.
  - Geolocation itself is platform-branched via `getCurrentPositionCompat`/`ensureNativeLocationPermission`: on a Capacitor native build (`Capacitor.isNativePlatform()`) it goes through `@capacitor/geolocation` (which drives the OS permission prompt); in a plain browser (including the Vercel deploy) it's the unchanged Web Geolocation API. Both paths resolve to the same `{ coords: { latitude, longitude, accuracy } }` shape so the rest of `requestLocation` doesn't care which one ran.
- `src/style.css` — mobile-first; layout switches from stacked (map / form / list) to a two-column grid (map | form+list) at `720px` via a single media query.

Leaflet's default marker icon assets require the `L.Icon.Default.mergeOptions` workaround at the top of `main.js` (importing the PNGs directly) because Vite doesn't resolve Leaflet's CSS-relative image paths — keep this if touching marker icons.

## Native app shell (Capacitor)

The same Vite web app is wrapped for the App Store/Play Store with Capacitor rather than a separate codebase — `android/` and `ios/` are real native projects checked into the repo (standard Capacitor practice, not generated-and-discarded output).

- `capacitor.config.json` — `appId: com.hyosunchoi.treemap`, `webDir: dist`. Changing `appId` after a store submission effectively creates a new app, so treat it as fixed.
- `npm run cap:sync` (`vite build && cap sync`) — rebuilds the web bundle and copies it + updates native plugin registration into both `android/` and `ios/`. Run this after any `src/` change before rebuilding a native app, and after adding/upgrading a Capacitor plugin.
- `assets/` — `icon-source.svg`/`splash-source.svg` (hand-authored, brand color `#2f6f4f`) rasterized by `assets/generate-icons.mjs` (via `sharp`) into `assets/icon.png` (1024×1024) and `assets/splash*.png` (2732×2732), which `npx capacitor-assets generate --android --ios` reads to produce every platform-specific icon/splash size under `android/app/src/main/res/` and `ios/App/App/Assets.xcassets/`. Re-run both steps (regenerate PNGs, then `capacitor-assets generate`) if the source SVGs change; don't hand-edit the generated per-density PNGs. The current icon is a placeholder (plain tree glyph) pending a real design.
- Location permissions are declared natively in addition to the JS-level handling above: `android/app/src/main/AndroidManifest.xml` (`ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION`) and `ios/App/App/Info.plist` (`NSLocationWhenInUseUsageDescription`). Without these the native permission prompt never appears and `@capacitor/geolocation` fails immediately.
- No local Xcode/Android Studio in this environment (Windows, no Mac) — native builds run on a cloud CI (Codemagic) rather than locally; see the project's Codemagic setup for how signing is handled for each store.
- `android/.gitignore` explicitly excludes `*.jks`/`*.keystore`/`key.properties` — the Play Store signing key must never be committed; it lives only in Codemagic/Play Console.

## Deployment

**Web (Vercel)**: `vercel.json` sets `outputDirectory: dist` and rewrites all paths to `index.html` (needed even though there's currently no client-side router, in case one is added later). Requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set in the Vercel project's environment variables (Vite inlines them at build time — adding them after a deploy requires a redeploy to take effect).

**Native (App Store / Play Store)**: built from the same `dist/` via Capacitor — see "Native app shell" above. Store listings require a privacy policy URL and a data-safety/nutrition-label disclosure covering location collection, since the app requests fine location.
