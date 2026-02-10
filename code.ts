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
    tablet: '(max-width: 62rem)',
    mobile: '(max-width: 48rem)',
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
    return n.includes('mode 1') || n.includes('default');
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

  const dataByMode: Record<
    string,
    Record<string, { primitives: Record<string,string>; overrides: Record<string,string> }>
  > = {};

  for (const coll of collections) {
    const collName = coll.name.trim();
    const isExtended = 'variableOverrides' in coll;

    for (const mode of coll.modes) {
      const modeName = mode.name.trim();
      dataByMode[modeName] ??= {};
      dataByMode[modeName][collName] ??= { primitives: {}, overrides: {} };

      for (const varId of coll.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(varId);
        if (!variable) continue;

        const valuesByMode = isExtended
          ? await variable.valuesByModeForCollectionAsync(coll)
          : variable.valuesByMode;

        const rawValue = valuesByMode[mode.modeId] ?? null;
        if (!rawValue) continue;

        const isOverride =
          isExtended &&
          (coll as any).variableOverrides?.[varId]?.[mode.modeId] !== undefined;

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

  const buildSchemeLines = (scheme: ColorScheme) => {
    const vars = new Map<string,string>();

    for (const [modeName, collections] of Object.entries(dataByMode)) {
      if (!isBaseMode(modeName)) continue;

      for (const [collName, group] of Object.entries(collections)) {
        if (includesAny(collName.toLowerCase(), COLL_DIM_KEYWORDS)) continue;
        Object.entries(group.primitives).forEach(([k,v]) => vars.set(k,v));
      }
    }

    for (const [modeName, collections] of Object.entries(dataByMode)) {
      if (modeToScheme(modeName) !== scheme) continue;

      for (const [collName, group] of Object.entries(collections)) {
        if (includesAny(collName.toLowerCase(), COLL_DIM_KEYWORDS)) continue;
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
        if (!includesAny(collName.toLowerCase(), COLL_DIM_KEYWORDS)) continue;

        Object.entries(group.primitives).forEach(([k,v]) => {
          buckets[bucket].push(`    --${kebab(k)}: ${v};`);
        });
      }
      
      for (const [collName, group] of Object.entries(collections)) {
        if (!includesAny(collName.toLowerCase(), COLL_DIM_KEYWORDS)) continue;

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

  figma.ui.onmessage = async msg => {
    const themeName = msg.themeName?.trim();
    if (!themeName) return figma.notify('Please enter a theme name', { error: true });

    if (msg.type === 'export-all') {
      const files: { name:string; content:string }[] = [];

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

    if (msg.type === 'cancel') figma.closePlugin();
  };
}

exportVariablesToCss();
