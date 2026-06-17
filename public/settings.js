const DEFAULT_SETTINGS = {
  siteType: "astro-accelerator",
  images: "accelerator",
  mediaDir: "public/img",
  contentDateField: "modDate",
  publishDateField: "pubDate",
};

export function normalizeMediaDir(value) {
  return String(value ?? DEFAULT_SETTINGS.mediaDir)
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

export function formatMediaDir(value) {
  return normalizeMediaDir(value);
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

export function getSiteType() {
  return currentSettings.siteType;
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

export function getPublishDateField() {
  return currentSettings.publishDateField ?? DEFAULT_SETTINGS.publishDateField;
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
