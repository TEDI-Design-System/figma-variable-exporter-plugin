/* eslint-disable @typescript-eslint/no-explicit-any */

async function exportVariablesToCss() {
  const kebab = (str: string) =>
    str.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();

  const pxToRem = (value: number, base = 16): string => {
    const rem = value / base;
    return rem === Math.floor(rem)
      ? `${rem}rem`
      : `${rem.toFixed(4).replace(/\.?0+$/, '')}rem`;
  };

  const includesAny = (source: string, arr: string[]) =>
    arr.some(k => source.includes(k));

  const NAME_NUMBER_KEYWORDS = ['weight','opacity','z-index','flex','ratio','scale'];
  const COLL_TYPO_KEYWORDS = ['font','typography','text'];
  const NAME_TYPO_KEYWORDS = ['font-size','line-height','letter-spacing'];
  const COLL_DIM_KEYWORDS = ['dimension','container','layout','grid','spacing'];
  const NAME_DIM_KEYWORDS = ['space','padding','margin','gap','radius','border','size','height','width','offset','inset'];

  type ModeBucket = 'desktop' | 'tablet' | 'mobile';

  const MEDIA_QUERIES: Record<ModeBucket, string | null> = {
    desktop: null,
    tablet: '(width < 62rem)',
    mobile: '(width < 48rem)',
  };

  const modeToBucket = (modeName: string): ModeBucket | null => {
    const n = modeName.toLowerCase();
    if (n.includes('mobile')) return 'mobile';
    if (n.includes('tablet')) return 'tablet';
    if (n.includes('desktop')) return 'desktop';
    return null;
  };

  type ColorScheme = 'light' | 'dark';

  const modeToScheme = (modeName: string): ColorScheme | null => {
    const n = modeName.toLowerCase();
    if (n.includes('dark')) return 'dark';
    if (n.includes('light')) return 'light';
    return null;
  };

  const isBaseMode = (modeName: string) => {
    const n = modeName.toLowerCase();
    if (n.includes('mode 1') || n.includes('default')) return true;
    return modeToScheme(modeName) === null && modeToBucket(modeName) === null;
  };

  function isVariableAlias(value: VariableValue): value is VariableAlias {
    return typeof value === 'object' && value !== null && 'type' in value;
  }

  async function resolveValue(
    raw: VariableValue | null,
    modeId: string,
    preserveAlias = false,
    collectionName = '',
    varName = '',
    depth = 0
  ): Promise<string | null> {
    if (!raw || depth > 10) return null;

    if (isVariableAlias(raw)) {
      const target = await figma.variables.getVariableByIdAsync(raw.id);
      if (!target) return null;
      if (preserveAlias) return `var(--${kebab(target.name)})`;

      return resolveValue(
        target.valuesByMode[modeId] ?? null,
        modeId,
        preserveAlias,
        collectionName,
        target.name,
        depth + 1
      );
    }

    if (typeof raw === 'object' && 'r' in raw) {
      const { r, g, b, a = 1 } = raw as RGBA;
      const [rr, gg, bb] = [r, g, b].map(c => Math.round(c * 255));
      return a === 1
        ? `#${[rr, gg, bb].map(x => x.toString(16).padStart(2, '0')).join('')}`
        : `rgba(${rr},${gg},${bb},${a})`;
    }

    if (typeof raw === 'number') {
      const lowerName = varName.toLowerCase();
      const lowerColl = collectionName.toLowerCase();

      if (includesAny(lowerName, NAME_NUMBER_KEYWORDS)) return raw.toString();

      if (
        includesAny(lowerColl, COLL_TYPO_KEYWORDS) ||
        includesAny(lowerName, NAME_TYPO_KEYWORDS)
      ) return pxToRem(raw);

      if (
        includesAny(lowerColl, COLL_DIM_KEYWORDS) ||
        includesAny(lowerName, NAME_DIM_KEYWORDS)
      ) return `${Math.round(raw * 100) / 100}px`;

      return pxToRem(raw);
    }

    if (typeof raw === 'boolean') return raw ? 'true' : 'false';
    if (typeof raw === 'string') return raw;

    return null;
  }

  const collections = await figma.variables.getLocalVariableCollectionsAsync();

  const TEDI_SOURCE_NAMES = [
    'TEDI colors base',
    'TEDI colors semantic',
    'TEDI dimensions base',
    'TEDI dimensions semantic',
    'TEDI fonts base',
    'TEDI fonts semantic',
  ];

  const normCollName = (s: string) =>
    s.trim().toLowerCase().replace(/[\s\-_/]+/g, ' ').replace(/\s+/g, ' ');

  const TEDI_SOURCE_NAMES_NORM = TEDI_SOURCE_NAMES.map(normCollName);

  const isTediSource = (name: string) =>
    TEDI_SOURCE_NAMES_NORM.includes(normCollName(name));
  const isTediBaseLayer = (name: string) =>
    /\bbase$/.test(normCollName(name));
  const isTediSemanticLayer = (name: string) =>
    /\bsemantic$/.test(normCollName(name));
  const isTediDimensionsSource = (name: string) =>
    normCollName(name).includes('dimensions');

  const libraryVarSources = new Map<string, string>();
  // Lower-cased set of the CURRENT (live) variable names for each TEDI source
  // collection, keyed by normalized source name. The team-library API returns only
  // live variables — soft-deleted "ghost" variables (left behind by renames such as
  // adding the TEDI/ group) are excluded — so this set is our source of truth for
  // filtering ghosts out of extended collections. Empty when teamLibrary is
  // unavailable, in which case collectData falls back to a name-prefix heuristic.
  const liveNamesBySource = new Map<string, Set<string>>();
  try {
    const libCollections =
      (await (figma as any).teamLibrary?.getAvailableLibraryVariableCollectionsAsync?.()) ?? [];
    for (const lib of libCollections) {
      if (!isTediSource(lib.name)) continue;
      const libVars =
        (await (figma as any).teamLibrary?.getVariablesInLibraryCollectionAsync?.(lib.key)) ?? [];
      const liveSet = liveNamesBySource.get(normCollName(lib.name)) ?? new Set<string>();
      for (const lv of libVars) {
        libraryVarSources.set(lv.name.toLowerCase(), lib.name.trim());
        liveSet.add(lv.name.toLowerCase());
      }
      liveNamesBySource.set(normCollName(lib.name), liveSet);
    }
  } catch (_e) {
    // teamLibrary unavailable (e.g., permission missing) — fall through to alias-voting.
  }

  // For collections that don't map to a known TEDI source (e.g. a project's own
  // "RMK Base Colours Only"), synthesize a source label from the collection's own
  // name so the rest of the pipeline can classify it by layer + category. The label
  // deliberately mirrors the TEDI naming convention ("<category> <layer>") so the
  // isTedi*Layer / isTediDimensionsSource helpers work on it unchanged.
  const synthSourceLabel = (coll: VariableCollection): string => {
    const n = normCollName(coll.name);
    const layer = /\bsemantic\b/.test(n) ? 'semantic' : 'base';
    const category =
      /(dimension|spacing|\bspace\b|sizing|\bsize\b|radius|layout|grid)/.test(n) ? 'dimensions'
      : /(font|typograph|text)/.test(n) ? 'fonts'
      : 'colors';
    return `${category} ${layer}`;
  };

  async function getSourceCollectionName(coll: VariableCollection): Promise<string | null> {
    const localNorm = normCollName(coll.name);
    const directMatch = TEDI_SOURCE_NAMES.find(s => normCollName(s) === localNorm);
    if (directMatch) return directMatch;
    const containsMatch = TEDI_SOURCE_NAMES.find(s => localNorm.includes(normCollName(s)));
    if (containsMatch) return containsMatch;

    // Alias-based detection only works for extended collections (which override a
    // library source). Standalone collections fall straight through to synthesis.
    if ('variableOverrides' in coll) {
      if (libraryVarSources.size) {
        const counts = new Map<string, number>();
        for (const varId of coll.variableIds) {
          const v = await figma.variables.getVariableByIdAsync(varId);
          if (!v) continue;
          const src = libraryVarSources.get(v.name.toLowerCase());
          if (!src) continue;
          counts.set(src, (counts.get(src) ?? 0) + 1);
        }
        if (counts.size) {
          // libraryVarSources only holds TEDI sources, so this is always a TEDI match.
          return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
        }
      }

      const overrides = (coll as any).variableOverrides ?? {};
      const sameNameCounts = new Map<string, number>();
      const anyCounts = new Map<string, number>();

      for (const varId of coll.variableIds) {
        const v = await figma.variables.getVariableByIdAsync(varId);
        if (!v) continue;
        for (const modeId of Object.keys(v.valuesByMode)) {
          if (overrides[varId]?.[modeId] !== undefined) continue;
          const raw = v.valuesByMode[modeId];
          if (!isVariableAlias(raw)) continue;
          const target = await figma.variables.getVariableByIdAsync(raw.id);
          if (!target) continue;
          const targetColl = await figma.variables.getVariableCollectionByIdAsync(
            target.variableCollectionId
          );
          if (!targetColl || !targetColl.remote) continue;
          const name = targetColl.name.trim();
          anyCounts.set(name, (anyCounts.get(name) ?? 0) + 1);
          if (target.name === v.name) {
            sameNameCounts.set(name, (sameNameCounts.get(name) ?? 0) + 1);
          }
        }
      }

      const pickFromCounts = (m: Map<string, number>): string | null => {
        if (!m.size) return null;
        const entries = Array.from(m.entries());
        const semantic = entries.find(([n]) => isTediSemanticLayer(n));
        if (semantic) return semantic[0];
        return entries.sort((a, b) => b[1] - a[1])[0][0];
      };

      // Only trust alias-voting when it resolves to a real TEDI source; otherwise
      // classify from the collection's own name below.
      const voted = pickFromCounts(sameNameCounts) ?? pickFromCounts(anyCounts);
      if (voted && isTediSource(voted)) return voted;
    }

    return synthSourceLabel(coll);
  }

  const sourceNameByCollName: Record<string, string | null> = {};
  for (const coll of collections) {
    sourceNameByCollName[coll.name.trim()] = await getSourceCollectionName(coll);
  }

  async function getFreshSourceValue(
    variable: Variable,
    localMode: { modeId: string; name: string }
  ): Promise<VariableValue | null> {
    const localRaw = variable.valuesByMode[localMode.modeId] ?? null;
    if (!localRaw || !isVariableAlias(localRaw)) return null;

    const sourceVar = await figma.variables.getVariableByIdAsync(localRaw.id);
    if (!sourceVar) return null;

    const sourceColl = await figma.variables.getVariableCollectionByIdAsync(
      sourceVar.variableCollectionId
    );
    if (!sourceColl) return null;

    const localModeKey = localMode.name.trim().toLowerCase();
    const matchedMode =
      sourceColl.modes.find(m => m.name.trim().toLowerCase() === localModeKey) ??
      sourceColl.modes.find(m => isBaseMode(m.name)) ??
      sourceColl.modes[0];
    if (!matchedMode) return null;

    return sourceVar.valuesByMode[matchedMode.modeId] ?? null;
  }

  const dataByMode: Record<
    string,
    Record<string, { primitives: Record<string,string>; overrides: Record<string,string> }>
  > = {};

  // Resolve variable values for the user-selected collections into dataByMode.
  // Runs at export time (not load) so only the chosen collections are processed.
  async function collectData(selected: Set<string>) {
    for (const key of Object.keys(dataByMode)) delete dataByMode[key];

    for (const coll of collections) {
      const collName = coll.name.trim();
      if (!selected.has(collName)) continue;

      const isExtended = 'variableOverrides' in coll;

      // De-duplicate "ghost" variables before processing.
      //
      // An extended collection inherits its parent library's *published snapshot*,
      // which Figma keeps deleted-yet-referenced variables inside (e.g. renaming a
      // collection's variables to add the TEDI/ group deletes the old ones, but they
      // linger in the snapshot because overrides/aliases still reference them). So
      // `ExtendedVariableCollection.variableIds` returns live variables AND ghosts,
      // doubling affected tokens (`TEDI/primary-100` alongside the ghost `primary-100`).
      // (A local collection lists only live variables, which is why the source file
      // itself exports cleanly.)
      //
      // The rule: only ever drop a variable that is an actual DUPLICATE — i.e. shares
      // a stem with another variable in the same collection. A variable with a unique
      // stem is kept unconditionally, because the library's live set is NOT a complete
      // list of valid variables (variables hidden from publishing, or a library
      // published slightly behind the file, are absent from it) — so live-set
      // membership must never be used to delete a token outright. It only breaks ties
      // WITHIN a duplicated stem. stemOf strips the tedi- group prefix so a prefixed
      // and non-prefixed variant of the same token collide, which handles the TEDI
      // group being either added or removed.
      const src = sourceNameByCollName[collName];
      const liveSet = src ? liveNamesBySource.get(normCollName(src)) : undefined;

      const stemOf = (kebabName: string) =>
        kebabName.startsWith('tedi-') ? kebabName.slice('tedi-'.length) : kebabName;

      const byStem = new Map<string, { variable: Variable; varId: string }[]>();
      for (const varId of coll.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(varId);
        if (!variable) continue;
        const stem = stemOf(kebab(variable.name));
        const group = byStem.get(stem) ?? [];
        group.push({ variable, varId });
        byStem.set(stem, group);
      }

      const vars: { variable: Variable; varId: string }[] = [];
      for (const group of byStem.values()) {
        // Unique stem → not a duplicate → always keep (see note above).
        if (group.length === 1) { vars.push(group[0]); continue; }

        // Duplicated stem: prefer the live variant (in the source library's live set,
        // or genuinely own to this collection); the others are ghosts.
        const live = (liveSet && liveSet.size)
          ? group.filter(({ variable }) =>
              variable.variableCollectionId === coll.id ||
              liveSet.has(variable.name.toLowerCase()))
          : [];
        if (live.length) { vars.push(...live); continue; }

        // No live info: prefer the TEDI/-prefixed variant, else keep all (they
        // collapse by output key anyway).
        const prefixed = group.filter(({ variable }) => kebab(variable.name).startsWith('tedi-'));
        vars.push(...(prefixed.length ? prefixed : group));
      }

      for (const mode of coll.modes) {
        const modeName = mode.name.trim();
        dataByMode[modeName] ??= {};
        dataByMode[modeName][collName] ??= { primitives: {}, overrides: {} };

        for (const { variable, varId } of vars) {
          // Standalone collections have no variableOverrides — every value is a primitive.
          const isOverride =
            isExtended &&
            (coll as any).variableOverrides?.[varId]?.[mode.modeId] !== undefined;

          let rawValue: VariableValue | null = null;
          if (isExtended && !isOverride) {
            rawValue = await getFreshSourceValue(variable, mode);
          }
          if (!rawValue) {
            const valuesByMode = isExtended
              ? await variable.valuesByModeForCollectionAsync(coll)
              : variable.valuesByMode;
            rawValue = valuesByMode[mode.modeId] ?? null;
          }
          if (!rawValue) continue;

          const resolved = await resolveValue(
            rawValue,
            mode.modeId,
            true,
            collName,
            variable.name
          );

          if (!resolved) continue;

          const target = isOverride
            ? dataByMode[modeName][collName].overrides
            : dataByMode[modeName][collName].primitives;

          target[variable.name] = resolved;
        }
      }
    }
  }

  const isDimensionCollection = (collName: string) => {
    const src = sourceNameByCollName[collName];
    return src ? isTediDimensionsSource(src) : false;
  };

  const isSemanticCollection = (collName: string) => {
    const src = sourceNameByCollName[collName];
    return src ? isTediSemanticLayer(src) : false;
  };

  const buildSchemeLines = (scheme: ColorScheme) => {
    const vars = new Map<string,string>();

    for (const [modeName, collections] of Object.entries(dataByMode)) {
      if (!isBaseMode(modeName)) continue;

      for (const [collName, group] of Object.entries(collections)) {
        if (!isSemanticCollection(collName)) continue;
        if (isDimensionCollection(collName)) continue;
        Object.entries(group.primitives).forEach(([k,v]) => vars.set(k,v));
        Object.entries(group.overrides).forEach(([k,v]) => vars.set(k,v));
      }
    }

    for (const [modeName, collections] of Object.entries(dataByMode)) {
      if (modeToScheme(modeName) !== scheme) continue;

      for (const [collName, group] of Object.entries(collections)) {
        if (!isSemanticCollection(collName)) continue;
        if (isDimensionCollection(collName)) continue;
        Object.entries(group.primitives).forEach(([k,v]) => vars.set(k,v));
        Object.entries(group.overrides).forEach(([k,v]) => vars.set(k,v));
      }
    }

    return Array.from(vars.entries()).map(
      ([name,val]) => `  --${kebab(name)}: ${val};`
    );
  };

  const buildColorSchemeFile = (theme: string, scheme: ColorScheme, lines: string[]) => ({
    name: `_color-variables__${kebab(theme)}-${scheme}.css`,
    content:
`.tedi-theme--${kebab(theme)}${scheme === 'dark' ? '-dark' : ''} {
${lines.join('\n')}
}
`
  });

  const buildBaseOverridesFile = (theme: string) => {
    const colorLight = new Map<string,string>();
    const colorDark = new Map<string,string>();
    const dimDesktop = new Map<string,string>();
    const dimTablet = new Map<string,string>();
    const dimMobile = new Map<string,string>();

    const mergeInto = (target: Map<string,string>, group: { primitives: Record<string,string>; overrides: Record<string,string> }) => {
      Object.entries(group.primitives).forEach(([k,v]) => target.set(k,v));
      Object.entries(group.overrides).forEach(([k,v]) => target.set(k,v));
    };

    for (const [modeName, collections] of Object.entries(dataByMode)) {
      if (!isBaseMode(modeName)) continue;
      for (const [collName, group] of Object.entries(collections)) {
        const src = sourceNameByCollName[collName];
        if (!src || !isTediBaseLayer(src)) continue;

        if (isTediDimensionsSource(src)) {
          mergeInto(dimDesktop, group);
        } else {
          mergeInto(colorLight, group);
          mergeInto(colorDark, group);
        }
      }
    }

    for (const [modeName, collections] of Object.entries(dataByMode)) {
      const scheme = modeToScheme(modeName);
      const bucket = modeToBucket(modeName);
      for (const [collName, group] of Object.entries(collections)) {
        const src = sourceNameByCollName[collName];
        if (!src || !isTediBaseLayer(src)) continue;

        if (isTediDimensionsSource(src)) {
          if (bucket === 'desktop') mergeInto(dimDesktop, group);
          else if (bucket === 'tablet') mergeInto(dimTablet, group);
          else if (bucket === 'mobile') mergeInto(dimMobile, group);
        } else {
          if (scheme === 'light') mergeInto(colorLight, group);
          else if (scheme === 'dark') mergeInto(colorDark, group);
        }
      }
    }

    const toLines = (m: Map<string,string>) =>
      Array.from(m.entries()).map(([k,v]) => `  --${kebab(k)}: ${v};`);

    const colorLightLines = toLines(colorLight);
    const colorDarkLines = toLines(colorDark);
    const dimDesktopLines = toLines(dimDesktop);
    const dimTabletLines = toLines(dimTablet);
    const dimMobileLines = toLines(dimMobile);

    const total =
      colorLightLines.length + colorDarkLines.length +
      dimDesktopLines.length + dimTabletLines.length + dimMobileLines.length;
    if (!total) return null;

    const themeKebab = kebab(theme);
    let css = '';

    if (colorLightLines.length || dimDesktopLines.length) {
      css += `.tedi-theme--${themeKebab} {
${[...colorLightLines, ...dimDesktopLines].join('\n')}
}
`;
    }
    if (colorDarkLines.length) {
      css += `.tedi-theme--${themeKebab}-dark {
${colorDarkLines.join('\n')}
}
`;
    }
    (['tablet','mobile'] as ModeBucket[]).forEach(b => {
      const media = MEDIA_QUERIES[b];
      const lines = b === 'tablet' ? dimTabletLines : dimMobileLines;
      if (!media || !lines.length) return;
      css += `
@media ${media} {
  .tedi-theme--${themeKebab} {
${lines.join('\n')}
  }
}
`;
    });

    return {
      name: `_base-variables__${themeKebab}.css`,
      content: css,
    };
  };

  const buildResponsiveDimensionsFile = (theme: string) => {
    const buckets: Record<ModeBucket, string[]> = {
      desktop: [],
      tablet: [],
      mobile: [],
    };

    for (const [modeName, collections] of Object.entries(dataByMode)) {
      const bucket = modeToBucket(modeName);
      if (!bucket) continue;

      for (const [collName, group] of Object.entries(collections)) {
        if (!isSemanticCollection(collName)) continue;
        if (!isDimensionCollection(collName)) continue;

        Object.entries(group.primitives).forEach(([k,v]) => {
          buckets[bucket].push(`    --${kebab(k)}: ${v};`);
        });
      }

      for (const [collName, group] of Object.entries(collections)) {
        if (!isSemanticCollection(collName)) continue;
        if (!isDimensionCollection(collName)) continue;

        Object.entries(group.overrides).forEach(([k,v]) => {
          buckets[bucket].push(`    --${kebab(k)}: ${v};`);
        });
      }
    }

    if (!buckets.desktop.length) return null;

    let css =
      `.tedi-theme--${kebab(theme)} {
      ${buckets.desktop.map(l => l.replace('    ', '  ')).join('\n')}
      }
      `;

    (['tablet','mobile'] as ModeBucket[]).forEach(bucket => {
      const media = MEDIA_QUERIES[bucket];
      if (!media || !buckets[bucket].length) return;

      css += `
        @media ${media} {
          .tedi-theme--${kebab(theme)} {
        ${buckets[bucket].join('\n')}
          }
        }`;
    });

    return {
      name: `_dimensional-variables__${kebab(theme)}.css`,
      content: css,
    };
  };

  figma.showUI(__html__, { width: 480, height: 720 });

  // TEDI collections are always exported and never shown in the UI. Only the
  // remaining ("additional") collections are offered for the user to opt into.
  // Collections whose name starts with "_" are internal by convention and are
  // excluded entirely — neither shown nor exported.
  const tediCollectionNames: string[] = [];
  const additionalCollections: { name: string }[] = [];
  for (const coll of collections) {
    const name = coll.name.trim();
    if (name.startsWith('_')) continue;
    const src = sourceNameByCollName[name];
    if (!!src && isTediSource(src)) tediCollectionNames.push(name);
    else additionalCollections.push({ name });
  }

  figma.ui.onmessage = async msg => {
    if (msg.type === 'ui-ready') {
      return figma.ui.postMessage({ type: 'collections', collections: additionalCollections });
    }

    if (msg.type === 'cancel') return figma.closePlugin();

    if (msg.type === 'export-all') {
      const themeName = msg.themeName?.trim();
      if (!themeName) return figma.notify('Please enter a theme name', { error: true });

      const additionalSelected = (msg.selected ?? [])
        .map((s: string) => s.trim())
        .filter(Boolean);
      const selected = new Set<string>([...tediCollectionNames, ...additionalSelected]);
      if (!selected.size) {
        return figma.notify('No collections available to export', { error: true });
      }

      await collectData(selected);

      const files: { name:string; content:string }[] = [];

      const baseFile = buildBaseOverridesFile(themeName);
      if (baseFile) files.push(baseFile);

      (['light','dark'] as ColorScheme[]).forEach(scheme => {
        const lines = buildSchemeLines(scheme);
        if (lines.length) files.push(buildColorSchemeFile(themeName, scheme, lines));
      });

      const dimFile = buildResponsiveDimensionsFile(themeName);
      if (dimFile) files.push(dimFile);

      files.push({
        name: 'index.css',
        content: Array.from(
          new Set(files.map(f => `@import "${f.name}";`))
        ).join('\n'),
      });

      figma.ui.postMessage({
        type: 'zip-download',
        files,
        themeName,
      });
    }
  };
}

exportVariablesToCss();
