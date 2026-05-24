import assert from "node:assert/strict";
import { Given, When, Then } from "@cucumber/cucumber";
import {
  filterStaticToolbarTools,
  isManagedImageTool,
  resolveImageToolId,
} from "../../public/toolbar-image-tool.js";

function substituteSamplePaths(value) {
  return String(value)
    .replaceAll("SAMPLE_PROJECT", this.sampleProjectPath)
    .replaceAll("OTHER_PROJECT", this.otherProjectPath);
}

Given('project {string} has image setting {string}', async function (projectKey, setting) {
  const projectPath = substituteSamplePaths.call(this, projectKey);
  this.lastResponse = await this.agent
    .put("/api/settings")
    .set("Content-Type", "application/json")
    .send({
      project: projectPath,
      settings: { images: setting, mediaDir: "public/img" },
    });

  assert.equal(this.lastResponse.status, 200, this.lastResponse.text);
  this.toolbarProjectPath = projectPath;
});

When("I resolve the toolbar image tool for that project", async function () {
  assert.ok(this.toolbarProjectPath, "Expected a project path to be configured");

  this.lastResponse = await this.agent
    .get("/api/settings")
    .query({ project: this.toolbarProjectPath });

  assert.equal(this.lastResponse.status, 200, this.lastResponse.text);

  const imageMode = this.lastResponse.body.settings?.images;
  assert.ok(imageMode, "Expected project settings to include images");
  this.activeImageTool = resolveImageToolId(imageMode);
});

Then("the active image tool should be {string}", function (toolId) {
  assert.equal(this.activeImageTool, toolId);
});

Then("the static toolbar tools should exclude managed image tools", function () {
  const tools = this.lastResponse.body.tools;
  assert.ok(Array.isArray(tools), 'Expected "tools" to be an array');

  const managedTools = tools.filter((toolId) => isManagedImageTool(toolId));
  assert.deepEqual(
    managedTools,
    [],
    `Expected no managed image tools in static toolbar, found: ${managedTools.join(", ")}`,
  );
  assert.deepEqual(tools, filterStaticToolbarTools(tools));
});

Then('the static toolbar tools should not include {string}', async function (toolId) {
  const response = await this.agent.get("/api/tools");
  assert.equal(response.status, 200, response.text);
  assert.ok(
    !response.body.tools.includes(toolId),
    `Expected static toolbar tools not to include "${toolId}"`,
  );
});

Then("the active image tool module should define an image toolbar button", async function () {
  assert.ok(this.activeImageTool, "Expected an active image tool to be resolved");

  const response = await this.agent.get(`/tools/${this.activeImageTool}.js`);
  assert.equal(response.status, 200, response.text);
  assert.match(response.text, /icons\.image/, "Expected tool module to use the image icon");
  assert.match(
    response.text,
    /createToolbarButton/,
    "Expected tool module to create a toolbar button",
  );
});
