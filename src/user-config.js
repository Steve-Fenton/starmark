import fs from "fs/promises";
import path from "path";

export const DEFAULT_SETTINGS = {
  images: "accelerator",
  mediaDir: "public/img",
  contentDateField: "modDate",
};

const CONTENT_DATE_FIELD_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function normalizeMediaDir(value) {
  return String(value ?? DEFAULT_SETTINGS.mediaDir)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function formatMediaDir(value) {
  return normalizeMediaDir(value);
}

export function normalizeContentDateField(value) {
  if (value === undefined || value === null) {
    return DEFAULT_SETTINGS.contentDateField;
  }

  const trimmed = String(value).trim();
  if (trimmed === "") {
    return "";
  }

  if (!CONTENT_DATE_FIELD_PATTERN.test(trimmed)) {
    return DEFAULT_SETTINGS.contentDateField;
  }

  return trimmed;
}

export function getUserIniPath(cwd = process.cwd()) {
  return path.join(cwd, ".starmark", "user.ini");
}

export function resolveProjectKey(projectPath) {
  return path.resolve(projectPath).replace(/\\/g, "/").toLowerCase();
}

function parseIniSections(text) {
  const sections = {};
  let current = null;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      current = trimmed.slice(1, -1).toLowerCase();
      if (!sections[current]) {
        sections[current] = [];
      }
      continue;
    }

    if (current) {
      sections[current].push(trimmed);
    }
  }

  return sections;
}

export function normalizeSettings(partial = {}) {
  const settings = { ...DEFAULT_SETTINGS };

  if (Object.prototype.hasOwnProperty.call(partial, "images")) {
    const value = String(partial.images).trim().toLowerCase();
    if (value === "accelerator" || value === "markdown") {
      settings.images = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(partial, "mediaDir")) {
    settings.mediaDir = formatMediaDir(partial.mediaDir);
  }

  if (Object.prototype.hasOwnProperty.call(partial, "contentDateField")) {
    settings.contentDateField = normalizeContentDateField(partial.contentDateField);
  }

  return settings;
}

function parseSettingsLines(lines = []) {
  const settings = { ...DEFAULT_SETTINGS };

  for (const line of lines) {
    const imagesMatch = line.match(/^images=(.+)$/i);
    if (imagesMatch) {
      const value = imagesMatch[1].trim().toLowerCase();
      if (value === "accelerator" || value === "markdown") {
        settings.images = value;
      }
      continue;
    }

    const mediaDirMatch = line.match(/^mediaDir=(.*)$/i);
    if (mediaDirMatch) {
      settings.mediaDir = formatMediaDir(mediaDirMatch[1]);
      continue;
    }

    const contentDateFieldMatch = line.match(/^contentDateField=(.*)$/i);
    if (contentDateFieldMatch) {
      settings.contentDateField = normalizeContentDateField(contentDateFieldMatch[1]);
    }
  }

  return settings;
}

async function isDirectory(dirPath) {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function parseProjectPaths(lines = []) {
  const paths = [];

  for (const line of lines) {
    const match = line.match(/^(?:path|folder)=(.+)$/);
    if (match) {
      paths.push(match[1].trim());
    }
  }

  const seen = new Set();
  const projects = [];

  for (const projectPath of paths) {
    const resolved = path.resolve(projectPath);
    if (seen.has(resolved)) {
      continue;
    }

    seen.add(resolved);

    if (!(await isDirectory(resolved))) {
      continue;
    }

    projects.push({
      path: resolved,
      name: path.basename(resolved),
    });
  }

  return projects;
}

async function readIniSections(cwd = process.cwd()) {
  const iniPath = path.join(cwd, ".starmark", "user.ini");

  try {
    const contents = await fs.readFile(iniPath, "utf8");
    return parseIniSections(contents);
  } catch {
    return {};
  }
}

function parseProjectSettingsSections(sections = {}) {
  const projectSettings = {};

  for (const [sectionName, lines] of Object.entries(sections)) {
    if (!sectionName.startsWith("settings:")) {
      continue;
    }

    const projectKey = sectionName.slice("settings:".length);
    projectSettings[projectKey] = parseSettingsLines(lines);
  }

  return projectSettings;
}

export function getProjectSettings(projectPath, config) {
  const projectKey = resolveProjectKey(projectPath);
  if (config.projectSettings[projectKey]) {
    return { ...config.projectSettings[projectKey] };
  }

  if (config.legacySettings) {
    return { ...config.legacySettings };
  }

  return { ...DEFAULT_SETTINGS };
}

async function writeUserConfig(
  { projects, projectSettings = {}, legacySettings = null },
  cwd = process.cwd(),
) {
  const lines = ["[projects]", ...projects.map((project) => `path=${project.path}`), ""];

  if (legacySettings) {
    const normalizedLegacy = normalizeSettings(legacySettings);
    lines.push(
      "[settings]",
      `images=${normalizedLegacy.images}`,
      `mediaDir=${normalizedLegacy.mediaDir}`,
      `contentDateField=${normalizedLegacy.contentDateField}`,
      "",
    );
  }

  for (const projectKey of Object.keys(projectSettings).sort()) {
    const normalized = normalizeSettings(projectSettings[projectKey]);
    lines.push(
      `[settings:${projectKey}]`,
      `images=${normalized.images}`,
      `mediaDir=${normalized.mediaDir}`,
      `contentDateField=${normalized.contentDateField}`,
      "",
    );
  }

  const iniPath = path.join(cwd, ".starmark", "user.ini");

  await fs.mkdir(path.dirname(iniPath), { recursive: true });
  await fs.writeFile(iniPath, `${lines.join("\n")}\n`, "utf8");
}

export async function readUserConfig(cwd = process.cwd()) {
  const sections = await readIniSections(cwd);
  const legacySettings = sections.settings
    ? parseSettingsLines(sections.settings)
    : null;

  return {
    projects: await parseProjectPaths(sections.projects ?? []),
    legacySettings,
    projectSettings: parseProjectSettingsSections(sections),
  };
}

export async function readProjectSettings(projectPath, cwd = process.cwd()) {
  const config = await readUserConfig(cwd);
  return getProjectSettings(projectPath, config);
}

export async function saveProjects(projects, cwd = process.cwd()) {
  const config = await readUserConfig(cwd);
  await writeUserConfig({ ...config, projects }, cwd);
}

export async function removeProject(projectPath, cwd = process.cwd()) {
  const config = await readUserConfig(cwd);
  const projectKey = resolveProjectKey(projectPath);
  const projects = config.projects.filter(
    (project) => resolveProjectKey(project.path) !== projectKey,
  );

  delete config.projectSettings[projectKey];
  await writeUserConfig({ ...config, projects }, cwd);
}

export async function saveProjectSettings(projectPath, settings, cwd = process.cwd()) {
  const config = await readUserConfig(cwd);
  const projectKey = resolveProjectKey(projectPath);

  config.projectSettings[projectKey] = normalizeSettings(settings);
  await writeUserConfig(config, cwd);
}
