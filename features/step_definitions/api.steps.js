import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";
import { Given, When, Then } from "@cucumber/cucumber";

function substituteSamplePaths(value) {
  return String(value)
    .replaceAll("SAMPLE_PROJECT", this.sampleProjectPath)
    .replaceAll("OTHER_PROJECT", this.otherProjectPath);
}

function substituteSamplePathsInValue(value) {
  if (typeof value === "string") {
    return substituteSamplePaths.call(this, value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => substituteSamplePathsInValue.call(this, entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        substituteSamplePathsInValue.call(this, entry),
      ]),
    );
  }

  return value;
}

Given("the sample Astro project fixture", function () {
  assert.ok(this.sampleProjectPath, "Sample project path is configured");
});

Given('the markdown file {string}', async function (relativePath) {
  this.currentFilePath = relativePath;
  this.currentFileAbsolutePath = path.join(this.sampleProjectPath, relativePath);
  this.originalFileContent = await fs.readFile(this.currentFileAbsolutePath, "utf8");
});

When("I request GET {string}", async function (url) {
  this.lastResponse = await this.agent.get(substituteSamplePaths.call(this, url));
});

When("I request PUT {string} with JSON:", async function (url, docString) {
  this.lastResponse = await this.agent
    .put(substituteSamplePaths.call(this, url))
    .set("Content-Type", "application/json")
    .send(substituteSamplePathsInValue.call(this, JSON.parse(docString)));
});

When("I scan the sample project", async function () {
  this.lastResponse = await this.agent
    .post("/api/scan")
    .send({ path: this.sampleProjectPath });

  if (this.lastResponse.status === 200) {
    this.scannedFiles = this.lastResponse.body.files ?? [];
  }
});

When("I read that file via the API", async function () {
  this.lastResponse = await this.agent
    .get("/api/file")
    .query({ path: this.currentFileAbsolutePath });
});

When("I save {string} as the file body", async function (content) {
  const frontmatterMatch = this.originalFileContent.match(
    /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/,
  );
  const frontmatterBlock = frontmatterMatch ? frontmatterMatch[0] : "";
  const payload = `${frontmatterBlock}${content}\n`;

  this.lastResponse = await this.agent
    .post("/api/file")
    .send({ path: this.currentFileAbsolutePath, content: payload });
});

Then("the response status should be {int}", function (status) {
  assert.equal(
    this.lastResponse.status,
    status,
    `Expected status ${status}, got ${this.lastResponse.status}: ${this.lastResponse.text}`,
  );
});

Then("the response body should contain {string}", function (text) {
  assert.match(this.lastResponse.text, new RegExp(text, "i"));
});

Then("the response JSON should include {string}", function (key) {
  assert.ok(
    Object.hasOwn(this.lastResponse.body, key),
    `Expected response JSON to include "${key}"`,
  );
});

Then('the response JSON settings {string} should be {string}', function (key, value) {
  const settings = this.lastResponse.body.settings;
  assert.ok(settings, "Expected response JSON to include settings");
  assert.equal(settings[key], value, `Expected settings.${key} to be "${value}"`);
});

Then('the response JSON {string} should include {string}', function (key, value) {
  const actual = this.lastResponse.body[key];
  assert.ok(Array.isArray(actual), `Expected "${key}" to be an array`);
  assert.ok(actual.includes(value), `Expected ${key} to include "${value}"`);
});

Then("the scan should find at least {int} markdown files", function (count) {
  assert.ok(
    this.scannedFiles.length >= count,
    `Expected at least ${count} files, found ${this.scannedFiles.length}`,
  );
});

Then("the scan results should include {string}", function (relativePath) {
  const paths = this.scannedFiles.map((file) => file.relativePath);
  assert.ok(
    paths.includes(relativePath),
    `Expected scan results to include "${relativePath}". Found: ${paths.join(", ")}`,
  );
});

Then("the file body should contain {string}", function (text) {
  assert.match(this.lastResponse.body.content, new RegExp(text));
});

Then("the file on disk should contain {string}", async function (text) {
  const onDisk = await fs.readFile(this.currentFileAbsolutePath, "utf8");
  assert.match(onDisk, new RegExp(text));
});
