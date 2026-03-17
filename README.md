# Ladok++

Ladok++ is a browser extension that adds lightweight gamification and progress tracking to Ladok's student pages. It turns completed credits into XP, calculates a level curve, and shows extra study statistics directly on the "Min utbildning" view.

The project is currently a plain Manifest V3 extension with no build step. You load it unpacked in the browser, edit the source files directly, and reload the extension when you make changes.

## What it does

- Replaces Ladok's default result summary with a custom progress widget on `min-utbildning/alla`.
- Converts completed `hp` into XP and maps that XP to a level from 1 to 100.
- Shows progress toward the next level, with an optional "Legendary mode" visual style.
- Stores reduced per-course and per-module result data locally in the browser.
- Aggregates saved course data into extra stats such as scanned courses and completed modules.
- Adds a `Skanna alla` action that opens course pages in background tabs to collect richer result data.
- Exposes an options page for tuning the level curve and statistics display.

## How it works

Ladok++ uses three main flows:

1. `main_page.js` runs on the Ladok overview page and mounts the XP widget.
2. `course_page_bridge.js` runs on individual course pages and injects `page_fetch_hook.js` into the page context.
3. `page_fetch_hook.js` watches Ladok API traffic, extracts course result payloads, and passes reduced course data back to the extension, where `background.js` stores it in local browser storage.

Settings are stored in `storage.sync`. Collected course data is stored in `storage.local`.

## Features

### Main widget

- Progress bar based on completed credits.
- Level badge (`LV x / 100`).
- XP progress toward the next level.
- Optional hiding of Ladok's original summary label.
- Optional "Legendary mode" styling.

### Statistics

- Number of scanned courses.
- Completed modules versus total modules in saved course data.
- Time-based study statistics derived from saved result dates.
- Scan coverage based on the course links visible on the overview page.

### Options

The options page currently supports:

- `levelExponent`: controls how steep the level curve is.
- `hideLabel`: hides Ladok's original "Summering resultat" label.
- `showXpToNext`: toggles the XP-to-next-level footer.
- `epicMode`: enables the decorative gold/glow presentation.
- `showStats`: shows or hides the statistics panel.
- `termBoundaryMode`: switches between week-based and fixed-term boundaries.
- `academicYearStartWeek`: defines the start week for the academic year in week mode.
- `includeSummerWeeks`: includes summer weeks in spring-term calculations.
- `dateBasis`: chooses whether statistics primarily use exam date, decision date, or auto selection.

## Installation

### Chrome / Chromium

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this repository folder.

After that, open Ladok and navigate to:

- `https://student.ladok.se/student/app/studentwebb/min-utbildning/alla`

The widget should mount automatically on that page.

### Firefox

Temporary local loading should work through `about:debugging` by loading the manifest from this folder. The repo includes a Gecko extension ID in `manifest.json`.

## Development workflow

There is no bundler, package manager, or test suite in this repo.

Typical local workflow:

1. Edit the source files directly.
2. Reload the extension in the browser.
3. Refresh the matching Ladok page.
4. Use the browser console and extension service worker logs for debugging.

## Repository layout

### Runtime files

- `manifest.json`: extension manifest, permissions, content scripts, background worker, and options page.
- `main_page.js`: main content script for the overview page and widget rendering.
- `course_page_bridge.js`: course-page bridge that injects the page hook and extracts reduced course data.
- `page_fetch_hook.js`: page-context hook that intercepts Ladok `fetch` and `XMLHttpRequest` responses.
- `background.js`: storage and scan orchestration.
- `options.html`, `options.js`, `options.css`: extension settings UI.
- `privacy-policy.md`: privacy policy text.

### Support and legacy files

- `README.md`: project documentation.
- `old.js`: older implementation kept in the repo.
- `examples`: sample or support data.
- `lol.json`: captured or example Ladok payload data.
- `LICENSE`: project license.

## Permissions and data handling

The extension requests:

- `storage`: to save settings and reduced course data locally in the browser.
- `tabs`: to open background tabs during full-course scanning.
- Host access to Ladok pages under `https://student.ladok.se/student/app/studentwebb/min-utbildning/*`.

Current behavior appears to be:

- Data is read only from Ladok pages the user visits or that the extension opens for scanning.
- No backend or external server is used by this repo.
- Collected course data is reduced and stored locally in the browser.

For the current privacy statement, see [privacy-policy.md](./privacy-policy.md).

## Caveats

- The extension depends on Ladok's current DOM structure and internal API paths. UI or API changes in Ladok can break it.
- `main_page.js` is still a large monolithic script, so changes there need care.
- Some files in the repo are clearly support or legacy artifacts and are not part of the runtime extension.
- There is no automated test coverage yet.

## License

See [LICENSE](./LICENSE).
