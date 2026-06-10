import path from "path";

export const DEFAULT_SITE_TYPE = "astro-accelerator";

function stripWebRoot(projectRelativePath, rootPrefix) {
  const normalized = projectRelativePath.replace(/\\/g, "/");

  if (normalized.startsWith(rootPrefix)) {
    const relative = normalized.slice(rootPrefix.length);
    return relative ? `/${relative}` : "/";
  }

  return normalized ? `/${normalized}` : "/";
}

export class SiteStrategy {
  constructor({ id, label, defaultSettings, scanTargetDefinitions }) {
    this.id = id;
    this.label = label;
    this.defaultSettings = defaultSettings;
    this.scanTargetDefinitions = scanTargetDefinitions;
  }

  toWebPath(_projectRelativePath) {
    throw new Error(`${this.constructor.name}.toWebPath is not implemented`);
  }

  resolveScanTargets(projectPath) {
    return this.scanTargetDefinitions.map((definition) => {
      const scanRoot = path.join(projectPath, ...definition.relativePath.split("/"));

      return {
        source: definition.source,
        scanRoot,
        pathPrefix: definition.relativePath,
      };
    });
  }
}

export class AstroSite extends SiteStrategy {
  toWebPath(projectRelativePath) {
    return stripWebRoot(projectRelativePath, "public/");
  }
}

export class HugoSite extends SiteStrategy {
  toWebPath(projectRelativePath) {
    return stripWebRoot(projectRelativePath, "static/");
  }
}

const ASTRO_SCAN_TARGETS = [
  { source: "content", relativePath: "src/content" },
  { source: "pages", relativePath: "src/pages" },
];

const SITE_STRATEGIES = {
  "astro-accelerator": new AstroSite({
    id: "astro-accelerator",
    label: "Astro Accelerator",
    defaultSettings: {
      images: "accelerator",
      mediaDir: "public/img",
      contentDateField: "modDate",
    },
    scanTargetDefinitions: ASTRO_SCAN_TARGETS,
  }),
  astro: new AstroSite({
    id: "astro",
    label: "Astro",
    defaultSettings: {
      images: "markdown",
      mediaDir: "public/img",
      contentDateField: "",
    },
    scanTargetDefinitions: ASTRO_SCAN_TARGETS,
  }),
  hugo: new HugoSite({
    id: "hugo",
    label: "Hugo",
    defaultSettings: {
      images: "markdown",
      mediaDir: "static",
      contentDateField: "updated",
    },
    scanTargetDefinitions: [{ source: "hugo", relativePath: "hugo/content" }],
  }),
};

export function normalizeSiteType(value) {
  const normalized = String(value ?? DEFAULT_SITE_TYPE)
    .trim()
    .toLowerCase();

  if (Object.prototype.hasOwnProperty.call(SITE_STRATEGIES, normalized)) {
    return normalized;
  }

  return DEFAULT_SITE_TYPE;
}

export function getSiteStrategy(siteType) {
  return SITE_STRATEGIES[normalizeSiteType(siteType)];
}

export function listSiteTypes() {
  return Object.values(SITE_STRATEGIES).map(({ id, label }) => ({ id, label }));
}
