import fs from "fs/promises";
import path from "path";

export const DEFAULT_SETTINGS = {
  images: "accelerator",
};

export function getUserIniPath(cwd = process.cwd()) {
  return path.join(cwd, ".starmark", "user.ini");
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

  return settings;
}

function parseSettingsLines(lines = []) {
  const settings = { ...DEFAULT_SETTINGS };

  for (const line of lines) {
    const match = line.match(/^images=(.+)$/i);
    if (!match) {
      continue;
    }

    const value = match[1].trim().toLowerCase();
    if (value === "accelerator" || value === "markdown") {
      settings.images = value;
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

async function writeUserConfig({ projects, settings }, cwd = process.cwd()) {
  const normalizedSettings = normalizeSettings(settings);
  const lines = [
    "[projects]",
    ...projects.map((project) => `path=${project.path}`),
    "",
    "[settings]",
    `images=${normalizedSettings.images}`,
  ];
  const iniPath = path.join(cwd, ".starmark", "user.ini");

  await fs.mkdir(path.dirname(iniPath), { recursive: true });
  await fs.writeFile(iniPath, `${lines.join("\n")}\n`, "utf8");
}

export async function readUserConfig(cwd = process.cwd()) {
  const sections = await readIniSections(cwd);

  return {
    projects: await parseProjectPaths(sections.projects ?? []),
    settings: parseSettingsLines(sections.settings ?? []),
  };
}

export async function saveProjects(projects, cwd = process.cwd()) {
  const { settings } = await readUserConfig(cwd);
  await writeUserConfig({ projects, settings }, cwd);
}

export async function saveSettings(settings, cwd = process.cwd()) {
  const { projects } = await readUserConfig(cwd);
  await writeUserConfig({ projects, settings: normalizeSettings(settings) }, cwd);
}
