import { icons } from "./icons.js";
import { createMediaDialog } from "./media-browser.js";
import {
  defaultValueForType,
  inferValueType,
  normalizeFrontmatter,
  parseFrontmatter,
  stringifyFrontmatter,
} from "./frontmatter.js";

const VALUE_TYPES = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "Boolean" },
  { value: "null", label: "Null" },
  { value: "array", label: "List" },
  { value: "object", label: "Object" },
];

const LONG_TEXT_THRESHOLD = 50;

function createLongTextDialog() {
  const dialog = document.createElement("dialog");
  dialog.className = "frontmatter-text-dialog";
  dialog.innerHTML = `
    <div class="dialog-header">
      <h2>Edit text</h2>
      <button type="button" class="dialog-close frontmatter-text-dialog-close" aria-label="Close">&times;</button>
    </div>
    <form class="frontmatter-text-form">
      <textarea class="frontmatter-text-textarea" rows="10" spellcheck="true" autocomplete="off"></textarea>
      <div class="frontmatter-text-form-actions">
        <button type="button" class="frontmatter-text-cancel">Cancel</button>
        <button type="submit" class="primary">Done</button>
      </div>
    </form>
  `;

  const closeBtn = dialog.querySelector(".frontmatter-text-dialog-close");
  const cancelBtn = dialog.querySelector(".frontmatter-text-cancel");
  const form = dialog.querySelector(".frontmatter-text-form");
  const textarea = dialog.querySelector(".frontmatter-text-textarea");
  let onSave = null;

  closeBtn.addEventListener("click", () => {
    dialog.close();
  });

  cancelBtn.addEventListener("click", () => {
    dialog.close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  dialog.addEventListener("close", () => {
    onSave = null;
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    onSave?.(textarea.value);
    dialog.close();
  });

  function open({ title, value, save }) {
    dialog.querySelector(".dialog-header h2").textContent = title;
    textarea.value = value;
    onSave = save;
    dialog.showModal();
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  return { dialog, open };
}

const longTextDialog = createLongTextDialog();
document.body.append(longTextDialog.dialog);

function coerceScalar(type, rawValue) {
  switch (type) {
    case "boolean":
      return rawValue === true || rawValue === "true";
    case "number": {
      const parsed = Number(rawValue);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    case "null":
      return null;
    default:
      return rawValue ?? "";
  }
}

function isBannerImageSrcField(fieldPath) {
  return (
    fieldPath.length >= 2 &&
    fieldPath[fieldPath.length - 2] === "bannerImage" &&
    fieldPath[fieldPath.length - 1] === "src"
  );
}

function isDateField(fieldPath) {
  const key = fieldPath[fieldPath.length - 1];
  return key === "pubDate" || key === "modDate";
}

function isIsoDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function isLongTextField(type, fieldPath, stringValue) {
  if (type !== "string") {
    return false;
  }

  if (
    isDateField(fieldPath) &&
    (stringValue === "" || isIsoDateString(stringValue))
  ) {
    return false;
  }

  return stringValue.length > LONG_TEXT_THRESHOLD || stringValue.includes("\n");
}

export function createFrontmatterEditor(root, { onChange, getProjectPath } = {}) {
  let data = {};
  let parseError = null;
  let rawFallback = "";
  let silent = false;

  const container = document.createElement("div");
  container.className = "frontmatter-form";
  root.replaceChildren(container);

  let mediaPickerTarget = null;

  const mediaPickerContext = {
    openMediaPicker: null,
    setTarget(callback) {
      mediaPickerTarget = callback;
    },
  };

  if (getProjectPath) {
    const { dialog, openMediaDialog } = createMediaDialog({
      getProjectPath,
      title: "Choose image",
      selectMode: "path",
      dialogId: "media-dialog-frontmatter",
      onSelect(image) {
        mediaPickerTarget?.(image.webPath);
      },
      onClose() {
        mediaPickerTarget = null;
      },
    });
    document.body.append(dialog);
    mediaPickerContext.openMediaPicker = openMediaDialog;
  }

  function emitChange() {
    if (silent || !onChange) {
      return;
    }

    onChange(getValue());
  }

  function getValue() {
    if (parseError) {
      return normalizeFrontmatter(rawFallback);
    }

    try {
      return normalizeFrontmatter(stringifyFrontmatter(data));
    } catch {
      return normalizeFrontmatter(rawFallback);
    }
  }

  function setValue(text) {
    silent = true;
    const trimmed = (text ?? "").trim();

    if (trimmed === "") {
      data = {};
      parseError = null;
      rawFallback = "";
      render();
      silent = false;
      return;
    }

    try {
      data = parseFrontmatter(trimmed);
      parseError = null;
      rawFallback = trimmed;
    } catch (error) {
      parseError = error instanceof Error ? error.message : "Could not parse frontmatter";
      rawFallback = trimmed;
      data = {};
    }

    render();
    silent = false;
  }

  function refresh() {
    render();
    emitChange();
  }

  function touchData() {
    emitChange();
  }

  function render() {
    container.replaceChildren();

    if (parseError) {
      container.appendChild(renderParseError());
      container.appendChild(renderRawEditor());
      return;
    }

    container.appendChild(renderObjectEditor(data, refresh, touchData, 0, [], mediaPickerContext));
    container.appendChild(renderAddFieldButton(data, refresh));
  }

  container.addEventListener("keydown", (event) => {
    const isMod = event.metaKey || event.ctrlKey;
    if (isMod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onChange?.(getValue(), { save: true });
    }
  });

  function renderParseError() {
    const banner = document.createElement("div");
    banner.className = "frontmatter-form-error";
    banner.textContent = `Could not parse frontmatter: ${parseError}. Edit the raw YAML below.`;
    return banner;
  }

  function renderRawEditor() {
    const textarea = document.createElement("textarea");
    textarea.className = "frontmatter-content frontmatter-raw-fallback";
    textarea.value = rawFallback;
    textarea.rows = 8;
    textarea.spellcheck = false;
    textarea.autocomplete = "off";
    textarea.setAttribute("aria-label", "Frontmatter raw YAML");

    textarea.addEventListener("input", () => {
      rawFallback = textarea.value;

      try {
        data = parseFrontmatter(rawFallback);
        parseError = null;
        render();
      } catch {
        // Stay in raw fallback mode until YAML is valid.
      }

      emitChange();
    });

    textarea.addEventListener("keydown", (event) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onChange?.(getValue(), { save: true });
      }
    });

    return textarea;
  }

  function focus() {
    const focusTarget = container.querySelector("input, textarea, select, button");
    focusTarget?.focus();
  }

  setValue("");

  return {
    setValue,
    getValue,
    focus,
  };
}

function renderAddFieldButton(objectValue, onRefresh, label = "Add field") {
  const footer = document.createElement("div");
  footer.className = "frontmatter-form-footer";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "frontmatter-add-btn";
  button.innerHTML = `${icons.plus}<span>${label}</span>`;
  button.addEventListener("click", () => {
    let key = "field";
    let suffix = 1;
    while (Object.prototype.hasOwnProperty.call(objectValue, key)) {
      key = `field${suffix}`;
      suffix += 1;
    }
    objectValue[key] = "";
    onRefresh();
  });

  footer.appendChild(button);
  return footer;
}

function renderObjectEditor(objectValue, onRefresh, onValueChange, depth, fieldPath, mediaPickerContext) {
  const section = document.createElement("div");
  section.className = "frontmatter-node frontmatter-object";
  if (depth > 0) {
    section.dataset.depth = String(depth);
  }

  const entries = Object.entries(objectValue);
  if (entries.length === 0 && depth > 0) {
    const empty = document.createElement("p");
    empty.className = "frontmatter-empty";
    empty.textContent = "No fields yet.";
    section.appendChild(empty);
    return section;
  }

  for (const [key, value] of entries) {
    section.appendChild(
      renderFieldRow(
        key,
        value,
        objectValue,
        onRefresh,
        onValueChange,
        depth,
        [...fieldPath, key],
        mediaPickerContext,
      ),
    );
  }

  return section;
}

function renderFieldRow(
  key,
  value,
  parentObject,
  onRefresh,
  onValueChange,
  depth,
  fieldPath,
  mediaPickerContext,
) {
  const field = document.createElement("div");
  field.className = "frontmatter-field";

  const row = document.createElement("div");
  row.className = "frontmatter-row";

  const keyInput = document.createElement("input");
  keyInput.type = "text";
  keyInput.className = "frontmatter-key-input";
  keyInput.value = key;
  keyInput.placeholder = "key";
  keyInput.spellcheck = false;
  keyInput.addEventListener("change", () => {
    const nextKey = keyInput.value.trim();
    if (nextKey === "" || nextKey === key) {
      keyInput.value = key;
      return;
    }

    if (Object.prototype.hasOwnProperty.call(parentObject, nextKey)) {
      keyInput.value = key;
      return;
    }

    const entryValue = parentObject[key];
    delete parentObject[key];
    parentObject[nextKey] = entryValue;
    onRefresh();
  });

  const typeSelect = document.createElement("select");
  typeSelect.className = "frontmatter-type-select";
  typeSelect.setAttribute("aria-label", `Type for ${key}`);

  for (const option of VALUE_TYPES) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    typeSelect.appendChild(element);
  }

  const currentType = inferValueType(value);
  typeSelect.value = currentType;
  typeSelect.addEventListener("change", () => {
    parentObject[key] = defaultValueForType(typeSelect.value);
    onRefresh();
  });

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "frontmatter-remove-btn";
  removeButton.innerHTML = icons.trash;
  removeButton.setAttribute("aria-label", `Remove ${key}`);
  removeButton.addEventListener("click", () => {
    delete parentObject[key];
    onRefresh();
  });

  const isNestedType = currentType === "array" || currentType === "object";

  if (isNestedType) {
    row.classList.add("frontmatter-row--compact");
    row.append(keyInput, typeSelect, removeButton);
  } else {
    const valueHost = document.createElement("div");
    valueHost.className = "frontmatter-value-host";
    valueHost.appendChild(
      renderScalarEditor(
        value,
        currentType,
        parentObject,
        key,
        onValueChange,
        fieldPath,
        mediaPickerContext,
      ),
    );
    row.append(keyInput, typeSelect, valueHost, removeButton);
  }

  field.appendChild(row);

  if (isNestedType) {
    const children = document.createElement("div");
    children.className = "frontmatter-children";
    children.appendChild(
      renderValueEditor(
        value,
        currentType,
        parentObject,
        key,
        onRefresh,
        onValueChange,
        depth + 1,
        fieldPath,
        mediaPickerContext,
      ),
    );
    field.appendChild(children);
  }

  return field;
}

function renderValueEditor(
  value,
  type,
  parentContainer,
  parentKey,
  onRefresh,
  onValueChange,
  depth,
  fieldPath,
  mediaPickerContext,
) {
  if (type === "array") {
    const arrayValue = Array.isArray(value) ? value : [];
    if (!Array.isArray(parentContainer[parentKey])) {
      parentContainer[parentKey] = arrayValue;
    }

    return renderArrayEditor(
      parentContainer[parentKey],
      onRefresh,
      onValueChange,
      depth,
      fieldPath,
      mediaPickerContext,
    );
  }

  if (type === "object") {
    const objectValue =
      value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
    if (
      parentContainer[parentKey] === null ||
      typeof parentContainer[parentKey] !== "object" ||
      Array.isArray(parentContainer[parentKey])
    ) {
      parentContainer[parentKey] = objectValue;
    }

    return renderNestedObjectEditor(
      parentContainer[parentKey],
      onRefresh,
      onValueChange,
      depth,
      fieldPath,
      mediaPickerContext,
    );
  }

  return renderScalarEditor(
    value,
    type,
    parentContainer,
    parentKey,
    onValueChange,
    fieldPath,
    mediaPickerContext,
  );
}

function renderScalarEditor(
  value,
  type,
  parentContainer,
  parentKey,
  onValueChange,
  fieldPath = [],
  mediaPickerContext = null,
) {
  const wrapper = document.createElement("div");
  wrapper.className = "frontmatter-scalar";

  if (type === "boolean") {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "frontmatter-boolean-input";
    checkbox.checked = value === true;
    checkbox.addEventListener("change", () => {
      parentContainer[parentKey] = checkbox.checked;
      onValueChange();
    });

    const label = document.createElement("label");
    label.className = "frontmatter-boolean-label";
    label.textContent = "true";
    label.prepend(checkbox);
    wrapper.appendChild(label);
    return wrapper;
  }

  const stringValue =
    type === "null" ? "" : value === null || value === undefined ? "" : String(value);
  const useDateInput =
    type === "string" &&
    isDateField(fieldPath) &&
    (stringValue === "" || isIsoDateString(stringValue));

  const input = document.createElement("input");
  input.type = useDateInput ? "date" : type === "number" ? "number" : "text";
  input.className = "frontmatter-value-input";
  input.value = stringValue;
  input.placeholder = type === "null" ? "null" : useDateInput ? "YYYY-MM-DD" : "value";
  input.spellcheck = false;

  if (useDateInput) {
    input.setAttribute("aria-label", `${fieldPath[fieldPath.length - 1]} date`);
  }

  input.addEventListener("input", () => {
    parentContainer[parentKey] = coerceScalar(type, input.value);
    updateLongTextButtonVisibility();
    onValueChange();
  });

  wrapper.appendChild(input);

  const longTextBtn = document.createElement("button");
  longTextBtn.type = "button";
  longTextBtn.className = "frontmatter-long-text-btn";
  longTextBtn.innerHTML = icons.edit;
  longTextBtn.setAttribute("aria-label", "Edit in multiline editor");
  longTextBtn.title = "Edit text";
  longTextBtn.hidden = true;

  function updateLongTextButtonVisibility() {
    longTextBtn.hidden = !isLongTextField(type, fieldPath, input.value);
  }

  longTextBtn.addEventListener("click", () => {
    const fieldLabel = fieldPath[fieldPath.length - 1] ?? "field";
    longTextDialog.open({
      title: `Edit ${fieldLabel}`,
      value: input.value,
      save(nextValue) {
        input.value = nextValue;
        parentContainer[parentKey] = nextValue;
        updateLongTextButtonVisibility();
        onValueChange();
      },
    });
  });

  updateLongTextButtonVisibility();
  wrapper.appendChild(longTextBtn);

  if (
    type === "string" &&
    isBannerImageSrcField(fieldPath) &&
    mediaPickerContext?.openMediaPicker
  ) {
    const pickButton = document.createElement("button");
    pickButton.type = "button";
    pickButton.className = "frontmatter-media-btn";
    pickButton.innerHTML = icons.image;
    pickButton.setAttribute("aria-label", "Choose image from media library");
    pickButton.title = "Choose image";
    pickButton.addEventListener("click", () => {
      mediaPickerContext.setTarget((webPath) => {
        input.value = webPath;
        parentContainer[parentKey] = webPath;
        onValueChange();
      });
      mediaPickerContext.openMediaPicker();
    });
    wrapper.appendChild(pickButton);
  }

  return wrapper;
}

function renderNestedObjectEditor(
  objectValue,
  onRefresh,
  onValueChange,
  depth,
  fieldPath,
  mediaPickerContext,
) {
  const wrapper = document.createElement("div");
  wrapper.className = "frontmatter-nested";

  wrapper.appendChild(
    renderObjectEditor(objectValue, onRefresh, onValueChange, depth, fieldPath, mediaPickerContext),
  );
  wrapper.appendChild(renderAddFieldButton(objectValue, onRefresh));
  return wrapper;
}

function renderArrayEditor(
  arrayValue,
  onRefresh,
  onValueChange,
  depth,
  fieldPath,
  mediaPickerContext,
) {
  const wrapper = document.createElement("div");
  wrapper.className = "frontmatter-array";

  if (arrayValue.length === 0) {
    const empty = document.createElement("p");
    empty.className = "frontmatter-empty";
    empty.textContent = "No items yet.";
    wrapper.appendChild(empty);
  }

  arrayValue.forEach((item, index) => {
    wrapper.appendChild(
      renderArrayItemRow(
        item,
        index,
        arrayValue,
        onRefresh,
        onValueChange,
        depth,
        fieldPath,
        mediaPickerContext,
      ),
    );
  });

  const footer = document.createElement("div");
  footer.className = "frontmatter-form-footer";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "frontmatter-add-btn";
  button.innerHTML = `${icons.plus}<span>Add item</span>`;
  button.addEventListener("click", () => {
    arrayValue.push("");
    onRefresh();
  });

  footer.appendChild(button);
  wrapper.appendChild(footer);
  return wrapper;
}

function renderArrayItemRow(
  item,
  index,
  parentArray,
  onRefresh,
  onValueChange,
  depth,
  fieldPath,
  mediaPickerContext,
) {
  const entry = document.createElement("div");
  entry.className = "frontmatter-array-entry";

  const row = document.createElement("div");
  row.className = "frontmatter-array-item";

  const marker = document.createElement("span");
  marker.className = "frontmatter-array-marker";
  marker.textContent = "–";
  marker.setAttribute("aria-hidden", "true");

  const typeSelect = document.createElement("select");
  typeSelect.className = "frontmatter-type-select";
  typeSelect.setAttribute("aria-label", `Type for item ${index + 1}`);

  for (const option of VALUE_TYPES) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    typeSelect.appendChild(element);
  }

  const currentType = inferValueType(item);
  typeSelect.value = currentType;
  typeSelect.addEventListener("change", () => {
    parentArray[index] = defaultValueForType(typeSelect.value);
    onRefresh();
  });

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "frontmatter-remove-btn";
  removeButton.innerHTML = icons.trash;
  removeButton.setAttribute("aria-label", `Remove item ${index + 1}`);
  removeButton.addEventListener("click", () => {
    parentArray.splice(index, 1);
    onRefresh();
  });

  const isNestedType = currentType === "array" || currentType === "object";

  if (isNestedType) {
    row.classList.add("frontmatter-row--compact");
    row.append(marker, typeSelect, removeButton);
  } else {
    const valueHost = document.createElement("div");
    valueHost.className = "frontmatter-value-host";
    valueHost.appendChild(
      renderScalarEditor(
        item,
        currentType,
        parentArray,
        index,
        onValueChange,
        [...fieldPath, String(index)],
        mediaPickerContext,
      ),
    );
    row.append(marker, typeSelect, valueHost, removeButton);
  }

  entry.appendChild(row);

  if (isNestedType) {
    const children = document.createElement("div");
    children.className = "frontmatter-children";
    children.appendChild(
      renderValueEditor(
        item,
        currentType,
        parentArray,
        index,
        onRefresh,
        onValueChange,
        depth + 1,
        [...fieldPath, String(index)],
        mediaPickerContext,
      ),
    );
    entry.appendChild(children);
  }

  return entry;
}
