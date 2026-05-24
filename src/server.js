import express from "express";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import { buildInitialFileContent } from "./content-config.js";
import {
  readProjectSettings,
  readUserConfig,
  saveProjects,
  saveProjectSettings,
  normalizeSettings,
} from "./user-config.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(PACKAGE_ROOT, "public");

const app = express();
const PORT = process.env.PORT || 5748;

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".astro",
  ".vercel",
  ".netlify",
]);

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

const TOOLS_DIR = path.join(PUBLIC_DIR, "tools");

async function listToolbarTools() {
  let entries;
  try {
    entries = await fs.readdir(TOOLS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => entry.name.replace(/\.js$/, ""))
    .sort((a, b) => a.localeCompare(b));
}

app.get("/api/tools", async (_req, res) => {
  const tools = await listToolbarTools();
  res.json({ tools });
});

async function pickFolderNative() {
  if (process.platform === "darwin") {
    const { stdout } = await execFileAsync("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Select Astro project folder")',
    ]);
    return stdout.trim();
  }

  if (process.platform === "win32") {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
      $dialog.Description = "Select Astro project folder"
      if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        Write-Output $dialog.SelectedPath
      }
    `;
    const { stdout } = await execFileAsync("powershell", ["-NoProfile", "-Command", script]);
    return stdout.trim();
  }

  const { stdout } = await execFileAsync("zenity", [
    "--file-selection",
    "--directory",
    "--title=Select Astro project folder",
  ]);
  return stdout.trim();
}

async function isDirectory(dir) {
  try {
    const stat = await fs.stat(dir);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function findMarkdownFiles(dir, { source, pathPrefix, baseDir = dir } = {}) {
  const files = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(
        ...(await findMarkdownFiles(fullPath, { source, pathPrefix, baseDir })),
      );
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (ext !== ".md" && ext !== ".mdx") continue;

    const relativeWithinRoot = path.relative(baseDir, fullPath);
    const navOrder = await readFileNavOrder(fullPath);
    files.push({
      name: entry.name,
      relativePath: pathPrefix
        ? path.join(pathPrefix, relativeWithinRoot)
        : relativeWithinRoot,
      absolutePath: fullPath,
      extension: ext.slice(1),
      source: source ?? "project",
      navOrder,
    });
  }

  return files;
}

async function findDirectories(dir, { pathPrefix, baseDir = dir } = {}) {
  const directories = [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return directories;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const relativeWithinRoot = path.relative(baseDir, fullPath);
    const relativePath = pathPrefix
      ? path.join(pathPrefix, relativeWithinRoot)
      : relativeWithinRoot;

    directories.push(relativePath.replace(/\\/g, "/"));
    directories.push(
      ...(await findDirectories(fullPath, { pathPrefix, baseDir })),
    );
  }

  return directories;
}

function resolveProjectSubpath(projectPath, relativePath = "") {
  const resolvedProject = path.resolve(projectPath);
  const normalized = String(relativePath).replace(/^\/+/, "").replace(/\\/g, "/");
  const target = path.resolve(resolvedProject, normalized || ".");

  if (target !== resolvedProject && !target.startsWith(`${resolvedProject}${path.sep}`)) {
    return null;
  }

  return {
    projectPath: resolvedProject,
    target,
    relativePath: normalized,
  };
}

function normalizeRelativePath(relativePath) {
  return String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "");
}

function inferSourceFromRelativePath(relativePath, scanTargets) {
  const normalized = normalizeRelativePath(relativePath);

  for (const target of scanTargets) {
    const prefix = normalizeRelativePath(target.pathPrefix);
    if (!prefix) {
      if (target.source === "project") {
        return "project";
      }
      continue;
    }

    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return target.source;
    }
  }

  return null;
}

function isPathUnderScanTargets(relativePath, scanTargets) {
  return inferSourceFromRelativePath(relativePath, scanTargets) !== null;
}

function isProtectedScanRoot(relativePath, scanTargets) {
  const normalized = normalizeRelativePath(relativePath);

  for (const target of scanTargets) {
    const prefix = normalizeRelativePath(target.pathPrefix);
    if (prefix && normalized === prefix) {
      return true;
    }
  }

  return false;
}

function isMarkdownFileName(name) {
  const ext = path.extname(name).toLowerCase();
  return ext === ".md" || ext === ".mdx";
}

function validateEntryName(name) {
  const trimmed = String(name).trim();

  if (!trimmed) {
    return { error: "A name is required" };
  }

  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return { error: "Name cannot contain path separators" };
  }

  return { name: trimmed };
}

async function resolveScanTargets(projectPath) {
  const targets = [];
  const contentDir = path.join(projectPath, "src", "content");
  const pagesDir = path.join(projectPath, "src", "pages");

  if (await isDirectory(contentDir)) {
    targets.push({
      source: "content",
      scanRoot: contentDir,
      pathPrefix: "src/content",
    });
  }

  if (await isDirectory(pagesDir)) {
    targets.push({
      source: "pages",
      scanRoot: pagesDir,
      pathPrefix: "src/pages",
    });
  }

  if (targets.length === 0) {
    targets.push({
      source: "project",
      scanRoot: projectPath,
      pathPrefix: "",
    });
  }

  return targets;
}

const SOURCE_ORDER = { content: 0, pages: 1, project: 2 };

function sortFiles(files) {
  return files.sort((a, b) => {
    const sourceDiff = SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
    if (sourceDiff !== 0) return sourceDiff;
    return a.relativePath.localeCompare(b.relativePath);
  });
}

function splitFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
  };
}

function parseNavOrder(frontmatter) {
  if (!frontmatter) {
    return null;
  }

  const match = frontmatter.match(/^navOrder:\s*(.+)$/m);
  if (!match) {
    return null;
  }

  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function readFileNavOrder(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    const { frontmatter } = splitFrontmatter(content);
    return parseNavOrder(frontmatter);
  } catch {
    return null;
  }
}

async function readSavedProjects() {
  const { projects } = await readUserConfig();
  return projects;
}

async function saveProject(folderPath) {
  const resolved = path.resolve(folderPath);
  const projects = (await readSavedProjects()).filter(
    (project) => project.path !== resolved,
  );

  projects.unshift({
    path: resolved,
    name: path.basename(resolved),
  });

  await saveProjects(projects);
}

app.get("/api/config", (_req, res) => {
  res.json({
    defaultProjectPath: process.cwd(),
  });
});

app.get("/api/projects", async (_req, res) => {
  const projects = await readSavedProjects();
  res.json({ projects });
});

app.get("/api/settings", async (req, res) => {
  const { project: projectPath } = req.query;

  if (!projectPath || typeof projectPath !== "string") {
    return res.status(400).json({ error: "A project path is required" });
  }

  const settings = await readProjectSettings(projectPath);
  res.json({ settings });
});

app.put("/api/settings", async (req, res) => {
  const { project: projectPath, settings } = req.body ?? {};

  if (!projectPath || typeof projectPath !== "string") {
    return res.status(400).json({ error: "A project path is required" });
  }

  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return res.status(400).json({ error: "A settings object is required" });
  }

  const normalized = normalizeSettings(settings);
  await saveProjectSettings(projectPath, normalized);
  res.json({ settings: normalized });
});

app.post("/api/browse", async (_req, res) => {
  try {
    const folderPath = await pickFolderNative();
    if (!folderPath) {
      return res.status(400).json({ error: "No folder selected" });
    }

    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "Selected path is not a directory" });
    }

    res.json({ path: folderPath });
  } catch (err) {
    if (err.killed || err.code === 1) {
      return res.status(400).json({ error: "Folder selection cancelled" });
    }
    console.error(err);
    res.status(500).json({ error: "Could not open folder picker" });
  }
});

app.post("/api/scan", async (req, res) => {
  const { path: projectPath } = req.body ?? {};

  if (!projectPath || typeof projectPath !== "string") {
    return res.status(400).json({ error: "A folder path is required" });
  }

  const resolved = path.resolve(projectPath);

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "Path is not a directory" });
    }
  } catch {
    return res.status(400).json({ error: "Folder does not exist or is not accessible" });
  }

  const scanTargets = await resolveScanTargets(resolved);
  const fileGroups = await Promise.all(
    scanTargets.map(async (target) => ({
      ...target,
      files: await findMarkdownFiles(target.scanRoot, {
        source: target.source,
        pathPrefix: target.pathPrefix,
      }),
      directories: await findDirectories(target.scanRoot, {
        pathPrefix: target.pathPrefix,
      }),
    })),
  );
  const files = sortFiles(fileGroups.flatMap((group) => group.files));
  const directories = [
    ...new Set(
      fileGroups
        .flatMap((group) => group.directories)
        .map((dirPath) => dirPath.replace(/\\/g, "/")),
    ),
  ].sort((a, b) => a.localeCompare(b));

  if (files.length > 0) {
    await saveProject(resolved);
  }

  res.json({
    projectPath: resolved,
    scanTargets: fileGroups.map(({ source, scanRoot, pathPrefix, files: groupFiles }) => ({
      source,
      scanRoot,
      pathPrefix,
      fileCount: groupFiles.length,
    })),
    files,
    directories,
  });
});

app.post("/api/entry", async (req, res) => {
  const { projectPath, parentPath = "", name, frontmatter } = req.body ?? {};

  if (!projectPath || typeof projectPath !== "string") {
    return res.status(400).json({ error: "A project path is required" });
  }

  const nameResult = validateEntryName(name);
  if (nameResult.error) {
    return res.status(400).json({ error: nameResult.error });
  }

  const resolvedProject = path.resolve(projectPath);

  try {
    const stat = await fs.stat(resolvedProject);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "Project path is not a directory" });
    }
  } catch {
    return res.status(404).json({ error: "Project does not exist or is not accessible" });
  }

  const normalizedParentPath = normalizeRelativePath(parentPath);
  const parentResolved = resolveProjectSubpath(resolvedProject, normalizedParentPath);
  if (!parentResolved) {
    return res.status(400).json({ error: "Invalid parent path" });
  }

  try {
    const parentStat = await fs.stat(parentResolved.target);
    if (!parentStat.isDirectory()) {
      return res.status(400).json({ error: "Parent path is not a directory" });
    }
  } catch {
    return res.status(404).json({ error: "Parent folder does not exist or is not accessible" });
  }

  const scanTargets = await resolveScanTargets(resolvedProject);
  if (!isPathUnderScanTargets(normalizedParentPath, scanTargets)) {
    return res.status(400).json({ error: "Parent path is outside the project content area" });
  }

  const targetRelativePath = normalizedParentPath
    ? `${normalizedParentPath}/${nameResult.name}`
    : nameResult.name;
  const targetResolved = resolveProjectSubpath(resolvedProject, targetRelativePath);
  if (!targetResolved) {
    return res.status(400).json({ error: "Invalid target path" });
  }

  try {
    const stat = await fs.stat(targetResolved.target);
    if (stat.isDirectory()) {
      return res.status(409).json({ error: "A folder with that name already exists" });
    }
    return res.status(409).json({ error: "A file with that name already exists" });
  } catch {
    // Target does not exist yet.
  }

  const source = inferSourceFromRelativePath(targetRelativePath, scanTargets) ?? "project";

  try {
    if (isMarkdownFileName(nameResult.name)) {
      let initialContent;
      const trimmedFrontmatter =
        typeof frontmatter === "string" ? frontmatter.trim() : "";

      if (trimmedFrontmatter) {
        initialContent = `---\n${trimmedFrontmatter}\n---\n`;
      } else {
        initialContent = await buildInitialFileContent(
          resolvedProject,
          targetRelativePath.replace(/\\/g, "/"),
          source,
        );
      }

      await fs.writeFile(targetResolved.target, initialContent, "utf8");
      const ext = path.extname(nameResult.name).toLowerCase().slice(1);

      return res.json({
        type: "file",
        path: targetResolved.target,
        relativePath: targetRelativePath.replace(/\\/g, "/"),
        name: nameResult.name,
        absolutePath: targetResolved.target,
        extension: ext,
        source,
      });
    }

    await fs.mkdir(targetResolved.target, { recursive: false });

    return res.json({
      type: "folder",
      path: targetResolved.target,
      relativePath: targetRelativePath.replace(/\\/g, "/"),
      name: nameResult.name,
      source,
    });
  } catch {
    return res.status(500).json({ error: "Could not create entry" });
  }
});

app.delete("/api/entry", async (req, res) => {
  const { projectPath, relativePath } = req.body ?? {};

  if (!projectPath || typeof projectPath !== "string") {
    return res.status(400).json({ error: "A project path is required" });
  }

  if (!relativePath || typeof relativePath !== "string") {
    return res.status(400).json({ error: "A relative path is required" });
  }

  const resolvedProject = path.resolve(projectPath);

  try {
    const stat = await fs.stat(resolvedProject);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "Project path is not a directory" });
    }
  } catch {
    return res.status(404).json({ error: "Project does not exist or is not accessible" });
  }

  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const targetResolved = resolveProjectSubpath(resolvedProject, normalizedRelativePath);
  if (!targetResolved) {
    return res.status(400).json({ error: "Invalid path" });
  }

  const scanTargets = await resolveScanTargets(resolvedProject);
  if (!isPathUnderScanTargets(normalizedRelativePath, scanTargets)) {
    return res.status(400).json({ error: "Path is outside the project content area" });
  }

  if (isProtectedScanRoot(normalizedRelativePath, scanTargets)) {
    return res.status(400).json({ error: "This folder cannot be deleted" });
  }

  let entryType;
  try {
    const stat = await fs.stat(targetResolved.target);
    entryType = stat.isDirectory() ? "folder" : "file";
  } catch {
    return res.status(404).json({ error: "Entry does not exist or is not accessible" });
  }

  try {
    if (entryType === "folder") {
      await fs.rm(targetResolved.target, { recursive: true, force: true });
    } else {
      await fs.unlink(targetResolved.target);
    }

    return res.json({
      type: entryType,
      relativePath: normalizedRelativePath,
    });
  } catch {
    return res.status(500).json({ error: "Could not delete entry" });
  }
});

app.get("/api/file", async (req, res) => {
  const { path: filePath } = req.query;

  if (!filePath || typeof filePath !== "string") {
    return res.status(400).json({ error: "A file path is required" });
  }

  const resolved = path.resolve(filePath);

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return res.status(400).json({ error: "Path is not a file" });
    }
  } catch {
    return res.status(404).json({ error: "File does not exist or is not accessible" });
  }

  const ext = path.extname(resolved).toLowerCase();
  if (ext !== ".md" && ext !== ".mdx") {
    return res.status(400).json({ error: "Only .md and .mdx files are supported" });
  }

  try {
    const raw = await fs.readFile(resolved, "utf8");
    const { frontmatter, body } = splitFrontmatter(raw);
    res.json({
      path: resolved,
      name: path.basename(resolved),
      content: body,
      frontmatter,
    });
  } catch {
    res.status(500).json({ error: "Could not read file" });
  }
});

app.post("/api/file", async (req, res) => {
  const { path: filePath, content } = req.body ?? {};

  if (!filePath || typeof filePath !== "string") {
    return res.status(400).json({ error: "A file path is required" });
  }

  if (typeof content !== "string") {
    return res.status(400).json({ error: "File content is required" });
  }

  const resolved = path.resolve(filePath);

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return res.status(400).json({ error: "Path is not a file" });
    }
  } catch {
    return res.status(404).json({ error: "File does not exist or is not accessible" });
  }

  const ext = path.extname(resolved).toLowerCase();
  if (ext !== ".md" && ext !== ".mdx") {
    return res.status(400).json({ error: "Only .md and .mdx files are supported" });
  }

  try {
    await fs.writeFile(resolved, content, "utf8");
    res.json({ path: resolved, saved: true });
  } catch {
    res.status(500).json({ error: "Could not save file" });
  }
});

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".ico",
]);

function resolvePublicSubpath(projectPath, relativePath = "") {
  const publicDir = path.resolve(projectPath, "public");
  const normalized = String(relativePath).replace(/^\/+/, "").replace(/\\/g, "/");
  const target = path.resolve(publicDir, normalized || ".");

  if (target !== publicDir && !target.startsWith(`${publicDir}${path.sep}`)) {
    return null;
  }

  return {
    publicDir,
    target,
    relativePath: normalized,
  };
}

function toWebPath(relativeToPublic) {
  const normalized = relativeToPublic.replace(/\\/g, "/");
  return normalized ? `/${normalized}` : "/";
}

async function listMediaDirectory(projectPath, relativePath = "img") {
  const resolved = resolvePublicSubpath(projectPath, relativePath);
  if (!resolved) {
    return { error: "Invalid media path" };
  }

  const { publicDir, target, relativePath: currentDir } = resolved;

  if (!(await isDirectory(publicDir))) {
    return { error: "This project has no public folder" };
  }

  if (!(await isDirectory(target))) {
    return { error: "Folder does not exist" };
  }

  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch {
    return { error: "Could not read folder" };
  }

  const folders = [];
  const images = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const entryRelativePath = currentDir
      ? path.posix.join(currentDir, entry.name)
      : entry.name;

    if (entry.isDirectory()) {
      folders.push({
        name: entry.name,
        dir: entryRelativePath,
      });
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;

    images.push({
      name: entry.name,
      dir: currentDir,
      webPath: toWebPath(entryRelativePath),
    });
  }

  folders.sort((a, b) => a.name.localeCompare(b.name));
  images.sort((a, b) => a.name.localeCompare(b.name));

  return {
    currentDir,
    parentDir: getMediaParentDir(currentDir),
    folders,
    images,
  };
}

function getMediaParentDir(currentDir) {
  if (currentDir === "") {
    return null;
  }

  const parentDir = path.posix.dirname(currentDir);
  return parentDir === "." ? "" : parentDir;
}

async function walkMediaImages(dirPath, relativeDir, query, images) {
  let entries;

  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const entryRelativePath = relativeDir
      ? path.posix.join(relativeDir, entry.name)
      : entry.name;

    if (entry.isDirectory()) {
      await walkMediaImages(
        path.join(dirPath, entry.name),
        entryRelativePath,
        query,
        images,
      );
      continue;
    }

    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;

    if (entry.name.toLowerCase().includes(query)) {
      images.push({
        name: entry.name,
        dir: relativeDir,
        webPath: toWebPath(entryRelativePath),
      });
    }
  }
}

async function searchMediaImages(projectPath, relativePath, query) {
  const resolved = resolvePublicSubpath(projectPath, relativePath);
  if (!resolved) {
    return { error: "Invalid media path" };
  }

  const { publicDir, target, relativePath: currentDir } = resolved;

  if (!(await isDirectory(publicDir))) {
    return { error: "This project has no public folder" };
  }

  if (!(await isDirectory(target))) {
    return { error: "Folder does not exist" };
  }

  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return listMediaDirectory(projectPath, relativePath);
  }

  const images = [];
  await walkMediaImages(target, currentDir, normalizedQuery, images);
  images.sort((a, b) => a.name.localeCompare(b.name));

  return {
    currentDir,
    parentDir: getMediaParentDir(currentDir),
    folders: [],
    images,
    searchQuery: query.trim(),
  };
}

app.get("/api/media", async (req, res) => {
  const { project: projectPath, dir = "img", q = "" } = req.query;

  if (!projectPath || typeof projectPath !== "string") {
    return res.status(400).json({ error: "A project path is required" });
  }

  const resolvedProject = path.resolve(projectPath);

  try {
    const stat = await fs.stat(resolvedProject);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: "Project path is not a directory" });
    }
  } catch {
    return res.status(404).json({ error: "Project does not exist or is not accessible" });
  }

  const relativeDir = typeof dir === "string" ? dir : "img";
  const searchQuery = typeof q === "string" ? q.trim() : "";
  const result = searchQuery
    ? await searchMediaImages(resolvedProject, relativeDir, searchQuery)
    : await listMediaDirectory(resolvedProject, relativeDir);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({
    projectPath: resolvedProject,
    ...result,
  });
});

async function getUniqueImageFilename(dirPath, filename) {
  const sanitized = path.basename(filename.replace(/\\/g, "/"));
  const ext = path.extname(sanitized).toLowerCase();
  const base = path.basename(sanitized, path.extname(sanitized));
  let candidate = sanitized;
  let counter = 1;

  while (true) {
    try {
      await fs.stat(path.join(dirPath, candidate));
      candidate = `${base}-${counter}${ext}`;
      counter += 1;
    } catch {
      return candidate;
    }
  }
}

app.post(
  "/api/media/upload",
  express.raw({ type: () => true, limit: "25mb" }),
  async (req, res) => {
    const { project: projectPath, dir = "img", filename } = req.query;

    if (!projectPath || typeof projectPath !== "string") {
      return res.status(400).json({ error: "A project path is required" });
    }

    if (!filename || typeof filename !== "string") {
      return res.status(400).json({ error: "A filename is required" });
    }

    const sanitizedFilename = path.basename(filename.replace(/\\/g, "/"));
    const ext = path.extname(sanitizedFilename).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      return res.status(400).json({ error: "Only image files are supported" });
    }

    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "File content is required" });
    }

    const resolvedProject = path.resolve(projectPath);

    try {
      const stat = await fs.stat(resolvedProject);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: "Project path is not a directory" });
      }
    } catch {
      return res.status(404).json({ error: "Project does not exist or is not accessible" });
    }

    const relativeDir = typeof dir === "string" ? dir : "img";
    const resolved = resolvePublicSubpath(resolvedProject, relativeDir);
    if (!resolved) {
      return res.status(400).json({ error: "Invalid media path" });
    }

    const { publicDir, target, relativePath: currentDir } = resolved;

    if (!(await isDirectory(publicDir))) {
      return res.status(400).json({ error: "This project has no public folder" });
    }

    if (!(await isDirectory(target))) {
      return res.status(400).json({ error: "Folder does not exist" });
    }

    const uniqueFilename = await getUniqueImageFilename(target, sanitizedFilename);
    const filePath = path.join(target, uniqueFilename);
    const entryRelativePath = currentDir
      ? path.posix.join(currentDir, uniqueFilename)
      : uniqueFilename;

    try {
      await fs.writeFile(filePath, req.body);
      res.json({
        name: uniqueFilename,
        dir: currentDir,
        webPath: toWebPath(entryRelativePath),
      });
    } catch {
      res.status(500).json({ error: "Could not save image" });
    }
  },
);

app.get("/api/media/file", async (req, res) => {
  const { project: projectPath, path: mediaPath } = req.query;

  if (!projectPath || typeof projectPath !== "string") {
    return res.status(400).json({ error: "A project path is required" });
  }

  if (!mediaPath || typeof mediaPath !== "string") {
    return res.status(400).json({ error: "A media path is required" });
  }

  const resolvedProject = path.resolve(projectPath);
  const resolved = resolvePublicSubpath(resolvedProject, mediaPath);
  if (!resolved) {
    return res.status(400).json({ error: "Invalid media path" });
  }

  try {
    const stat = await fs.stat(resolved.target);
    if (!stat.isFile()) {
      return res.status(400).json({ error: "Path is not a file" });
    }
  } catch {
    return res.status(404).json({ error: "File does not exist or is not accessible" });
  }

  const ext = path.extname(resolved.target).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    return res.status(400).json({ error: "Only image files are supported" });
  }

  res.sendFile(resolved.target);
});

export { app };

export function startServer(options = {}) {
  const port = options.port ?? PORT;

  const server = app.listen(port, () => {
    console.log(`Starmark running at http://localhost:${port}`);
    console.log(`Project folder: ${process.cwd()}`);
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use. Stop the other process or run with PORT=<number> starmark`,
      );
      process.exit(1);
    }

    throw err;
  });

  return server;
}
