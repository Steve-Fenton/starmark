import { After, Before } from "@cucumber/cucumber";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { getProjectIniPath } from "../../src/user-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");
const USER_INI_PATH = path.join(REPO_ROOT, ".starmark/user.ini");
const SETTINGS_PROJECT_PATHS = [
  path.join(REPO_ROOT, "fixtures/sample-astro"),
  REPO_ROOT,
];

async function readOptionalFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

Before({ tags: "@settings" }, async function () {
  this.originalUserIni = await readOptionalFile(USER_INI_PATH);
  this.originalProjectInis = new Map();

  for (const projectPath of SETTINGS_PROJECT_PATHS) {
    const projectIniPath = getProjectIniPath(projectPath);
    this.originalProjectInis.set(projectIniPath, await readOptionalFile(projectIniPath));
  }

  await fs.mkdir(path.dirname(USER_INI_PATH), { recursive: true });
  await fs.writeFile(USER_INI_PATH, "[projects]\n\n", "utf8");
});

After({ tags: "@settings" }, async function () {
  if (this.originalUserIni === null) {
    await fs.rm(USER_INI_PATH, { force: true });
  } else {
    await fs.writeFile(USER_INI_PATH, this.originalUserIni, "utf8");
  }

  for (const [projectIniPath, originalContents] of this.originalProjectInis ?? []) {
    if (originalContents === null) {
      await fs.rm(projectIniPath, { force: true });
      continue;
    }

    await fs.writeFile(projectIniPath, originalContents, "utf8");
  }
});

After(async function () {
  if (this.currentFileAbsolutePath && this.originalFileContent !== null) {
    await fs.writeFile(this.currentFileAbsolutePath, this.originalFileContent, "utf8");
  }

  if (this.createdFolderPath) {
    await fs.rm(this.createdFolderPath, { recursive: true, force: true });
  }
});
