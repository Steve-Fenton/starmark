import express from "express";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 5748;
const USER_INI_PATH = path.join(__dirname, "../local/user.ini");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".astro",
  ".vercel",
  ".netlify",
]);

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

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
    files.push({
      name: entry.name,
      relativePath: pathPrefix
        ? path.join(pathPrefix, relativeWithinRoot)
        : relativeWithinRoot,
      absolutePath: fullPath,
      extension: ext.slice(1),
      source: source ?? "project",
    });
  }

  return files;
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

async function readSavedProjects() {
  try {
    const contents = await fs.readFile(USER_INI_PATH, "utf8");
    const paths = [];

    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;

      const match = trimmed.match(/^(?:path|folder)=(.+)$/);
      if (match) paths.push(match[1].trim());
    }

    const seen = new Set();
    const projects = [];

    for (const projectPath of paths) {
      const resolved = path.resolve(projectPath);
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      if (!(await isDirectory(resolved))) continue;

      projects.push({
        path: resolved,
        name: path.basename(resolved),
      });
    }

    return projects;
  } catch {
    return [];
  }
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

  const lines = ["[projects]", ...projects.map((project) => `path=${project.path}`)];

  await fs.mkdir(path.dirname(USER_INI_PATH), { recursive: true });
  await fs.writeFile(USER_INI_PATH, `${lines.join("\n")}\n`, "utf8");
}

app.get("/api/projects", async (_req, res) => {
  const projects = await readSavedProjects();
  res.json({ projects });
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
    })),
  );
  const files = sortFiles(fileGroups.flatMap((group) => group.files));

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
  });
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

  const parentDir =
    currentDir === ""
      ? null
      : path.posix.dirname(currentDir) === "."
        ? ""
        : path.posix.dirname(currentDir);

  return {
    currentDir,
    parentDir,
    folders,
    images,
  };
}

app.get("/api/media", async (req, res) => {
  const { project: projectPath, dir = "img" } = req.query;

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

  const result = await listMediaDirectory(resolvedProject, typeof dir === "string" ? dir : "img");

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({
    projectPath: resolvedProject,
    ...result,
  });
});

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

const server = app.listen(PORT, () => {
  console.log(`Starmark running at http://localhost:${PORT}`);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Stop the other process or run with PORT=<number> pnpm start`,
    );
    process.exit(1);
  }

  throw err;
});
