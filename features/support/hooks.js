import { After, Before } from "@cucumber/cucumber";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");
const USER_INI_PATH = path.join(REPO_ROOT, ".starmark/user.ini");

Before({ tags: "@settings" }, async function () {
  try {
    this.originalUserIni = await fs.readFile(USER_INI_PATH, "utf8");
  } catch {
    this.originalUserIni = null;
  }

  await fs.mkdir(path.dirname(USER_INI_PATH), { recursive: true });
  await fs.writeFile(USER_INI_PATH, "[projects]\n\n", "utf8");
});

After({ tags: "@settings" }, async function () {
  if (this.originalUserIni === null) {
    await fs.rm(USER_INI_PATH, { force: true });
    return;
  }

  await fs.writeFile(USER_INI_PATH, this.originalUserIni, "utf8");
});

After(async function () {
  if (this.currentFileAbsolutePath && this.originalFileContent !== null) {
    await fs.writeFile(this.currentFileAbsolutePath, this.originalFileContent, "utf8");
  }
});
