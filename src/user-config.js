import fs from "fs/promises";
import os from "os";
import path from "path";
import { DEFAULT_SITE_TYPE, normalizeSiteType } from "./site-strategy.js";

export const DEFAULT_SETTINGS = {
  siteType: DEFAULT_SITE_TYPE,
  images: "accelerator",
  mediaDir: "public/img",
  contentDateField: "modDate",
  publishDateField: "pubDate",
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

export function normalizePublishDateField(value) {
  if (value === undefined || value === null) {
    return DEFAULT_SETTINGS.publishDateField;
  }

  const trimmed = String(value).trim();
  if (trimmed === "") {
    return "";
  }

  if (!CONTENT_DATE_FIELD_PATTERN.test(trimmed)) {
    return DEFAULT_SETTINGS.publishDateField;
  }

  return trimmed;
}

export function getStarmarkConfigDir() {
  if (process.env.STARMARK_CONFIG_DIR) {
    return process.env.STARMARK_CONFIG_DIR;
  }

  const home = os.homedir();

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, "starmark");
  }

  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "starmark");
  }

  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  return path.join(xdgConfig, "starmark");
}

export function getUserIniPath() {
  if (process.env.STARMARK_USER_INI) {
    return process.env.STARMARK_USER_INI;
  }

  return path.join(getStarmarkConfigDir(), "user.ini");
}

export function getLegacyUserIniPath(cwd = process.cwd()) {
  return path.join(cwd, ".starmark", "user.ini");
}

export function getProjectIniPath(projectPath) {
  return path.join(path.resolve(projectPath), ".starmark", "project.ini");
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

  if (Object.prototype.hasOwnProperty.call(partial, "siteType")) {
    settings.siteType = normalizeSiteType(partial.siteType);
  }

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

  if (Object.prototype.hasOwnProperty.call(partial, "publishDateField")) {
    settings.publishDateField = normalizePublishDateField(partial.publishDateField);
  }

  return settings;
}

function parseSettingsLines(lines = []) {
  const settings = { ...DEFAULT_SETTINGS };

  for (const line of lines) {
    const siteTypeMatch = line.match(/^siteType=(.+)$/i);
    if (siteTypeMatch) {
      settings.siteType = normalizeSiteType(siteTypeMatch[1]);
      continue;
    }

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
      continue;
    }

    const publishDateFieldMatch = line.match(/^publishDateField=(.*)$/i);
    if (publishDateFieldMatch) {
      settings.publishDateField = normalizePublishDateField(publishDateFieldMatch[1]);
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

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readIniSections(iniPath) {
  try {
    const contents = await fs.readFile(iniPath, "utf8");
    return parseIniSections(contents);
  } catch {
    return {};
  }
}

function mergeProjects(existing = [], incoming = []) {
  const merged = [...existing];
  const seen = new Set(existing.map((project) => path.resolve(project.path)));

  for (const project of incoming) {
    const resolved = path.resolve(project.path);
    if (seen.has(resolved)) {
      continue;
    }

    seen.add(resolved);
    merged.push(project);
  }

  return merged;
}

async function migrateProjectSettingsToProjectIni(projects, projectSettings, legacySettings = null) {
  for (const [projectKey, settings] of Object.entries(projectSettings)) {
    const project = projects.find((entry) => resolveProjectKey(entry.path) === projectKey);
    if (!project) {
      continue;
    }

    if ((await readProjectIni(project.path)) === null) {
      await writeProjectIni(project.path, settings);
    }
  }

  if (!legacySettings) {
    return;
  }

  for (const project of projects) {
    if ((await readProjectIni(project.path)) !== null) {
      continue;
    }

    const projectKey = resolveProjectKey(project.path);
    if (projectSettings[projectKey]) {
      continue;
    }

    await writeProjectIni(project.path, legacySettings);
  }
}

async function migrateLegacyUserIni(cwd = process.cwd()) {
  const legacyPath = getLegacyUserIniPath(cwd);
  const userIniPath = getUserIniPath();

  if (path.resolve(legacyPath) === path.resolve(userIniPath)) {
    return;
  }

  if (!(await fileExists(legacyPath))) {
    return;
  }

  const legacySections = await readIniSections(legacyPath);
  const legacyConfig = {
    projects: await parseProjectPaths(legacySections.projects ?? []),
    legacySettings: legacySections.settings
      ? parseSettingsLines(legacySections.settings)
      : null,
    projectSettings: parseProjectSettingsSections(legacySections),
  };

  let mergedProjects = legacyConfig.projects;
  let mergedProjectSettings = { ...legacyConfig.projectSettings };
  let mergedLegacySettings = legacyConfig.legacySettings;

  if (await fileExists(userIniPath)) {
    const currentSections = await readIniSections(userIniPath);
    const currentConfig = {
      projects: await parseProjectPaths(currentSections.projects ?? []),
      legacySettings: currentSections.settings
        ? parseSettingsLines(currentSections.settings)
        : null,
      projectSettings: parseProjectSettingsSections(currentSections),
    };

    mergedProjects = mergeProjects(currentConfig.projects, legacyConfig.projects);
    mergedProjectSettings = {
      ...legacyConfig.projectSettings,
      ...currentConfig.projectSettings,
    };
    mergedLegacySettings = currentConfig.legacySettings ?? legacyConfig.legacySettings;
  }

  await migrateProjectSettingsToProjectIni(
    mergedProjects,
    mergedProjectSettings,
    mergedLegacySettings,
  );

  await writeUserConfig({ projects: mergedProjects });
  await fs.unlink(legacyPath).catch(() => {});
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

function formatProjectIni(settings) {
  const normalized = normalizeSettings(settings);
  return [
    "[settings]",
    `siteType=${normalized.siteType}`,
    `images=${normalized.images}`,
    `mediaDir=${normalized.mediaDir}`,
    `contentDateField=${normalized.contentDateField}`,
    `publishDateField=${normalized.publishDateField}`,
    "",
  ].join("\n");
}

async function readProjectIni(projectPath) {
  const iniPath = getProjectIniPath(projectPath);

  try {
    const contents = await fs.readFile(iniPath, "utf8");
    const sections = parseIniSections(contents);
    return parseSettingsLines(sections.settings ?? []);
  } catch {
    return null;
  }
}

async function writeProjectIni(projectPath, settings) {
  const iniPath = getProjectIniPath(projectPath);

  await fs.mkdir(path.dirname(iniPath), { recursive: true });
  await fs.writeFile(iniPath, formatProjectIni(settings), "utf8");
}

async function writeUserConfig({ projects }) {
  const lines = ["[projects]", ...projects.map((project) => `path=${project.path}`), ""];
  const iniPath = getUserIniPath();

  await fs.mkdir(path.dirname(iniPath), { recursive: true });
  await fs.writeFile(iniPath, `${lines.join("\n")}\n`, "utf8");
}

export async function readUserConfig(cwd = process.cwd()) {
  await migrateLegacyUserIni(cwd);

  const sections = await readIniSections(getUserIniPath());
  const legacySettings = sections.settings
    ? parseSettingsLines(sections.settings)
    : null;
  const projectSettings = parseProjectSettingsSections(sections);
  const projects = await parseProjectPaths(sections.projects ?? []);

  if (legacySettings || Object.keys(projectSettings).length > 0) {
    await migrateProjectSettingsToProjectIni(projects, projectSettings, legacySettings);
    await writeUserConfig({ projects });
  }

  return {
    projects,
    legacySettings: null,
    projectSettings: {},
  };
}

export async function readProjectSettings(projectPath, cwd = process.cwd()) {
  const resolved = path.resolve(projectPath);
  const fromProjectIni = await readProjectIni(resolved);

  if (fromProjectIni !== null) {
    return { ...fromProjectIni };
  }

  await readUserConfig(cwd);

  const migrated = await readProjectIni(resolved);
  if (migrated !== null) {
    return { ...migrated };
  }

  return { ...DEFAULT_SETTINGS };
}

export async function saveProjects(projects, cwd = process.cwd()) {
  await readUserConfig(cwd);
  await writeUserConfig({ projects });
}

export async function removeProject(projectPath, cwd = process.cwd()) {
  const config = await readUserConfig(cwd);
  const projectKey = resolveProjectKey(projectPath);
  const projects = config.projects.filter(
    (project) => resolveProjectKey(project.path) !== projectKey,
  );

  await writeUserConfig({ projects });
}

export async function saveProjectSettings(projectPath, settings) {
  const resolved = path.resolve(projectPath);
  const normalized = normalizeSettings(settings);

  await writeProjectIni(resolved, normalized);
}
