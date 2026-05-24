export function resolveImageToolId(imageMode) {
  return imageMode === "markdown" ? "image-markdown" : "image-accelerator";
}

export function isManagedImageTool(toolId) {
  return toolId === "image-accelerator" || toolId === "image-markdown";
}

export function filterStaticToolbarTools(toolIds) {
  return toolIds.filter((toolId) => !isManagedImageTool(toolId));
}
