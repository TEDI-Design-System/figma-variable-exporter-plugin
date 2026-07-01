# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build` — compile `code.ts` → `code.js` via `tsc`. **`code.js` is git-ignored but is the actual plugin entry point** (`manifest.json` → `main: code.js`), so you must rebuild after any change to `code.ts` before testing in Figma.
- `npm run watch` — recompile on change.
- `npm run lint` / `npm run lint:fix` — ESLint over `.ts`/`.tsx`.

There is no test suite. To test changes, build and run the plugin inside the Figma desktop app against a file containing TEDI variable collections.

## Architecture

This is a **Figma dev-mode plugin** (`manifest.json` → `editorType: ["dev"]`) that exports TEDI design-system variable overrides as themed CSS files, bundled into a ZIP. Two files do all the work:

- **`code.ts`** — the plugin's main thread. Runs in Figma's sandbox with the `figma` API. All logic lives inside one async IIFE-style function `exportVariablesToCss()`.
- **`ui.html`** — the iframe UI. Collects a theme name, and on message from the main thread uses **JSZip** (loaded from `cdnjs.cloudflare.com`, the only allowed network domain) to build and trigger the ZIP download. The browser sandbox cannot download files except from this iframe, which is why zipping happens in the UI rather than in `code.ts`.

Message flow: on load `ui.html` posts `{type: 'ui-ready'}` → `code.ts` replies `{type: 'collections', collections}` with only the **non-TEDI ("additional") collections** → UI renders them as an opt-in checkbox list (TEDI collections are never shown). On export, `ui.html` posts `{type: 'export-all', themeName, selected}` (the ticked additional collections) → `code.ts` unions `selected` with the always-included `tediCollectionNames`, resolves values, and builds file objects → posts `{type: 'zip-download', files, themeName}` back → `ui.html` zips and downloads.

### The export pipeline (in `code.ts`, top to bottom)

1. **`resolveValue`** — recursively resolves a `VariableValue` to a CSS string. Aliases become `var(--kebab-name)` when `preserveAlias` is set; otherwise it follows the alias chain (depth-capped at 10). **Number formatting is keyword-driven**, not type-driven: the variable/collection name decides the unit — `NAME_NUMBER_KEYWORDS` → unitless, typography keywords → `rem` (via `pxToRem`), dimension keywords → `px`. Colors become `#RRGGBB` or `rgba(...)`.

2. **Source-collection identification** — `getSourceCollectionName` maps each local collection to a source *label* that drives all downstream classification (`isTediBaseLayer` / `isTediSemanticLayer` / `isTediDimensionsSource` all operate on this label). The cascade: exact/substring match against the six known TEDI names in `TEDI_SOURCE_NAMES` → team-library variable-name lookup (needs the `teamlibrary` permission; try/catch since it may be unavailable) → **alias-voting** (tally which remote collection a variable's aliases point at, prefer same-name matches and semantic layers), *accepted only if it resolves to a TEDI source* → otherwise **`synthSourceLabel`** synthesizes a `<category> <layer>` label from the collection's own name (e.g. `RMK Base Colours Only` → `colors base`). The synthetic label deliberately mirrors the TEDI convention so the classification helpers work on it unchanged. `isTedi` (label ∈ `TEDI_SOURCE_NAMES`) is what pre-checks a collection in the UI. Names are compared via `normCollName` (lowercased, punctuation collapsed).

   **TEDI collections always export and are never shown in the UI.** At load, collections split into `tediCollectionNames` (label ∈ `TEDI_SOURCE_NAMES`) and `additionalCollections` (everything else); only the latter is sent to the UI. On export, `collectData` processes the union of the always-included TEDI names and the user-ticked additional collections. A synthesized non-TEDI collection then exports just like a TEDI one. Collections whose (trimmed) name starts with `_` are treated as internal and excluded entirely — never listed, never exported, even if they'd classify as TEDI.

3. **Data collection** — `collectData(selected)` runs at **export time** (not load) and populates `dataByMode[modeName][collName]` = `{ primitives, overrides }`, clearing it first so repeated exports don't accumulate. A value is an **override** only for extended collections that list it in `variableOverrides`; `getFreshSourceValue` then re-reads the value from the source collection's matching mode (falling back to base mode) so exports reflect the current source, not a stale local copy. **Standalone (non-extended) collections** have no `variableOverrides` — every value is read directly from `variable.valuesByMode` and treated as a primitive. Only `sourceNameByCollName` and the UI collection list are computed at load.

   **Ghost-variable dropping:** an extended collection inherits its parent library's **published snapshot**, which Figma keeps deleted-yet-referenced ("ghost") variables inside — e.g. renaming a collection's variables to add the `TEDI/` group deletes the originals, but they linger in the snapshot because overrides/aliases still reference them. So `ExtendedVariableCollection.variableIds` returns live variables **and** ghosts, doubling every affected token. (A local collection lists only live variables, which is why the source file itself exports cleanly.) **No `Variable` field distinguishes a ghost** — they report `remote=true`, inherited (`variableCollectionId` ≠ the collection), `hidden=true`, and `getPublishStatusAsync()` throws.

   The fix uses the **team-library API as the source of truth for what's live**: `liveNamesBySource` (built at load from `getVariablesInLibraryCollectionAsync`, which returns only live variables) maps each TEDI source name → the lower-cased set of its current variable names. In `collectData`, an extended collection's variables are kept only if the name is in its source's live set (or the variable is genuinely `own`, as a safety net); everything else is a ghost and dropped. This is **prefix-agnostic** — it self-corrects if the `TEDI/` group is ever added, removed, or renamed, and it also clears ghosts from the *semantic* collections, whose names carry no prefix at all (`general/border/primary`, …). When `teamLibrary` is unavailable, it falls back to a name-prefix heuristic (drop a non-`tedi-`-prefixed variable when the same collection holds the prefixed form of its stem) — only meaningful for base collections. Same-name live duplicates collapse by output key, and the primitives-vs-overrides split (builders apply overrides last) makes the RMK override win.

4. **Mode classification** — mode names are parsed by keyword into a **breakpoint bucket** (`desktop`/`tablet`/`mobile`, each with a media query in `MEDIA_QUERIES`) and a **color scheme** (`light`/`dark`). `isBaseMode` catches "mode 1"/"default"/unclassifiable modes.

5. **File builders** — each returns `{name, content}` or `null`:
   - `buildBaseOverridesFile` → `_base-variables__<theme>.css` — base-layer tokens, split into light/dark theme classes and desktop/tablet/mobile media queries.
   - `buildColorSchemeFile` (per scheme) → `_color-variables__<theme>-<scheme>.css` — semantic non-dimension colors, emitted under `.tedi-theme--<theme>` / `.tedi-theme--<theme>-dark`.
   - `buildResponsiveDimensionsFile` → `_dimensional-variables__<theme>.css` — semantic dimension tokens across breakpoints.
   - An `index.css` is generated last, `@import`-ing every produced file.

### Conventions

- CSS custom-property and class names are always run through `kebab()`.
- Theme classes follow `.tedi-theme--<theme>` and `.tedi-theme--<theme>-dark`.
- When adding token categories or units, extend the keyword arrays near the top of `resolveValue` — classification is centralized there.
- When changing message shapes, update **both** the `postMessage` in `code.ts` and the `window.onmessage` handler in `ui.html`.
