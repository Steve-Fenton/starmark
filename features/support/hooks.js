import { After } from "@cucumber/cucumber";
import fs from "fs/promises";

After(async function () {
  if (this.currentFileAbsolutePath && this.originalFileContent !== null) {
    await fs.writeFile(this.currentFileAbsolutePath, this.originalFileContent, "utf8");
  }
});
