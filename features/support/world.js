import { setWorldConstructor } from "@cucumber/cucumber";
import request from "supertest";
import path from "path";
import { fileURLToPath } from "url";
import { app } from "../../src/server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");

export class ApiWorld {
  constructor() {
    this.agent = request(app);
    this.lastResponse = null;
    this.sampleProjectPath = path.join(REPO_ROOT, "fixtures/sample-astro");
    this.otherProjectPath = REPO_ROOT;
    this.currentFilePath = null;
    this.currentFileAbsolutePath = null;
    this.originalFileContent = null;
    this.scannedFiles = [];
  }
}

setWorldConstructor(ApiWorld);
