# TEDI Variables Exporter

**Export your Figma TEDI design tokens as CSS variables — all modes — with ZIP packaging and ready-to-use `index.css`.**

---

## Description

The **TEDI Variables Exporter** is a Figma plugin designed to help design and development teams quickly export design tokens from Figma as CSS files. It supports:

- **All modes export:** Generate CSS files for all modes at once, bundled in a ZIP file.  
- **Index file generation:** Creates `index.css` that imports all exported CSS files, ready for use in projects.  
- **Preserves variable aliases:** Exports CSS variables with alias resolution.  
- **Supports colors, typography, spacing, and other numeric/boolean tokens**.  

This plugin is ideal for **design system workflows**, where developers need consistent and automated token export from Figma.

---

## Features

- Export CSS variables for any Figma variable collection.  
- Export all modes in a single ZIP.  
- Auto-generates `index.css` for easy imports.  
- Supports color (HEX & RGBA), typography (px → rem), spacing, radius, z-index, opacity, and boolean values.  
- Handles variable aliases properly.  
- Lightweight, fast, and reliable download inside Figma.  

---

## Usage

1. **Install the plugin** in Figma.  
2. **Open the plugin** in a Figma file containing TEDI variable collections.  
3. **Enter a theme name** (e.g., `your-theme`).
4. **Export all**: Click **Export all** to download a ZIP containing all mode CSS files plus `index.css`.  
5. **Cancel**: Close the plugin anytime without exporting.  

---

## File Structure Example

Exporting all modes for theme `your-theme` will produce a ZIP with:

```
_color-variables__your-theme.css
_dimensional-variables__your-theme.css
index.css
```

`index.css`:

```
/* Theme: your-theme */
@import "_color-variables__your-theme.css";
@import "_dimensional-variables__your-theme.css";
```

This allows quick import into your project:

```
@import "src/variables/your-theme/index.css";
```

---

## Supported Tokens

| Type        | Format                                     |
|------------|--------------------------------------------|
| Color      | HEX (`#RRGGBB`) or RGBA (`rgba(r,g,b,a)`) |
| Typography | font-size, line-height, letter-spacing (converted to `rem`) |
| Spacing    | margin, padding, gap, width, height (`px`) |
| Radius     | border-radius (`px`)                       |
| Boolean    | `true` / `false`                           |
| Numeric    | z-index, opacity, flex, ratio, scale       |
| Alias      | Preserved using `var(--variable-name)`     |

---

## Notes

- The plugin **requires allowed network access** for CDN (JSZip) if using the online version.  
- Recommended for **design system token management** and **automated CSS export pipelines**.  
- Exports are **safe and deterministic** — aliases are preserved and numeric values are converted appropriately.