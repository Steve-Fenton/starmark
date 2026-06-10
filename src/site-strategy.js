import path from "path";

export const DEFAULT_SITE_TYPE = "astro-accelerator";

const SITE_STRATEGIES = {
  "astro-accelerator": {
    id: "astro-accelerator",
    label: "Astro Accelerator",
    defaultSettings: {
      images: "accelerator",
      mediaDir: "public/img",
      contentDateField: "modDate",
    },
    scanTargetDefinitions: [
      { source: "content", relativePath: "src/content" },
      { source: "pages", relativePath: "src/pages" },
    ],
  },
  astro: {
    id: "astro",
    label: "Astro",
    defaultSettings: {
      images: "markdown",
      mediaDir: "public/img",
      contentDateField: "",
    },
    scanTargetDefinitions: [
      { source: "content", relativePath: "src/content" },
      { source: "pages", relativePath: "src/pages" },
    ],
  },
  hugo: {
    id: "hugo",
    label: "Hugo",
    defaultSettings: {
      images: "markdown",
      mediaDir: "static",
      contentDateField: "",
    },
    scanTargetDefinitions: [{ source: "hugo", relativePath: "hugo/content" }],
  },
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

export function toWebPath(projectRelativePath, siteType = DEFAULT_SITE_TYPE) {
  const normalized = projectRelativePath.replace(/\\/g, "/");
  const prefix = normalizeSiteType(siteType) === "hugo" ? "static/" : "public/";

  if (normalized.startsWith(prefix)) {
    const relative = normalized.slice(prefix.length);
    return relative ? `/${relative}` : "/";
  }

  return normalized ? `/${normalized}` : "/";
}

export async function resolveScanTargets(projectPath, siteType = DEFAULT_SITE_TYPE) {
  const strategy = getSiteStrategy(siteType);

  return strategy.scanTargetDefinitions.map((definition) => {
    const scanRoot = path.join(projectPath, ...definition.relativePath.split("/"));

    return {
      source: definition.source,
      scanRoot,
      pathPrefix: definition.relativePath,
    };
  });
}
