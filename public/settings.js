const DEFAULT_SETTINGS = {
  images: "accelerator",
};

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

export function getImageMode() {
  return currentSettings.images;
}

export function onSettingsChange(listener) {
  listeners.push(listener);
  listener(getSettings());
}

export async function loadSettings() {
  try {
    const response = await fetch("/api/settings");
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

export async function saveSettings(partial) {
  const nextSettings = {
    ...currentSettings,
    ...partial,
  };

  const response = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ settings: nextSettings }),
  });

  if (!response.ok) {
    throw new Error("Could not save settings");
  }

  const data = await response.json();
  currentSettings = {
    ...DEFAULT_SETTINGS,
    ...(data.settings ?? {}),
  };
  notifyListeners();
  return getSettings();
}
