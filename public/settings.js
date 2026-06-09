const DEFAULT_SETTINGS = {
  images: "accelerator",
  mediaDir: "public/img",
  contentDateField: "modDate",
};

export function normalizeMediaDir(value) {
  let normalized = String(value ?? DEFAULT_SETTINGS.mediaDir)
    .trim()
    .replace(/\\/g, "/");

  if (normalized.startsWith("public/")) {
    normalized = normalized.slice("public/".length);
  } else if (normalized === "public") {
    normalized = "";
  }

  return normalized.replace(/^\/+|\/+$/g, "");
}

export function formatMediaDir(value) {
  const relative = normalizeMediaDir(value);
  return relative ? `public/${relative}` : "public/";
}

let currentProjectPath = "";
let currentSettings = { ...DEFAULT_SETTINGS };
const listeners = [];

function notifyListeners() {
  const snapshot = getSettings();
  for (const listener of listeners) {
    listener(snapshot);
  }
}

export function getSettings() {
  return { ...currentSettings };
}

export function getSettingsProjectPath() {
  return currentProjectPath;
}

export function getImageMode() {
  return currentSettings.images;
}

export function getMediaDir() {
  return normalizeMediaDir(currentSettings.mediaDir);
}

export function getContentDateField() {
  return currentSettings.contentDateField;
}

export function onSettingsChange(listener) {
  listeners.push(listener);
  listener(getSettings());
}

export async function loadSettings(projectPath = currentProjectPath) {
  currentProjectPath = projectPath ?? "";

  if (!currentProjectPath) {
    currentSettings = { ...DEFAULT_SETTINGS };
    notifyListeners();
    return getSettings();
  }

  try {
    const response = await fetch(
      `/api/settings?project=${encodeURIComponent(currentProjectPath)}`,
    );
    if (!response.ok) {
      return getSettings();
    }

    const data = await response.json();
    currentSettings = {
      ...DEFAULT_SETTINGS,
      ...(data.settings ?? {}),
    };
    notifyListeners();
  } catch {
    // Keep defaults when settings cannot be loaded.
  }

  return getSettings();
}

export async function saveSettings(partial, projectPath = currentProjectPath) {
  if (!projectPath) {
    throw new Error("No project selected");
  }

  const nextSettings = {
    ...currentSettings,
    ...partial,
  };

  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project: projectPath, settings: nextSettings }),
  });

  if (!response.ok) {
    throw new Error("Could not save settings");
  }

  const data = await response.json();
  currentProjectPath = projectPath;
  currentSettings = {
    ...DEFAULT_SETTINGS,
    ...(data.settings ?? {}),
  };
  notifyListeners();
  return getSettings();
}
