import { icons } from "./icons.js";
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

export function createFrontmatterEditor(root, { onChange } = {}) {
  let data = {};
  let parseError = null;
  let rawFallback = "";
  let silent = false;

  const container = document.createElement("div");
  container.className = "frontmatter-form";
  root.replaceChildren(container);

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

    container.appendChild(renderObjectEditor(data, refresh, touchData, 0));
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

function renderObjectEditor(objectValue, onRefresh, onValueChange, depth) {
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
    section.appendChild(renderFieldRow(key, value, objectValue, onRefresh, onValueChange, depth));
  }

  return section;
}

function renderFieldRow(key, value, parentObject, onRefresh, onValueChange, depth) {
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
      renderScalarEditor(value, currentType, parentObject, key, onValueChange),
    );
    row.append(keyInput, typeSelect, valueHost, removeButton);
  }

  field.appendChild(row);

  if (isNestedType) {
    const children = document.createElement("div");
    children.className = "frontmatter-children";
    children.appendChild(
      renderValueEditor(value, currentType, parentObject, key, onRefresh, onValueChange, depth + 1),
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
) {
  if (type === "array") {
    const arrayValue = Array.isArray(value) ? value : [];
    if (!Array.isArray(parentContainer[parentKey])) {
      parentContainer[parentKey] = arrayValue;
    }

    return renderArrayEditor(parentContainer[parentKey], onRefresh, onValueChange, depth);
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

    return renderNestedObjectEditor(parentContainer[parentKey], onRefresh, onValueChange, depth);
  }

  return renderScalarEditor(value, type, parentContainer, parentKey, onValueChange);
}

function renderScalarEditor(value, type, parentContainer, parentKey, onValueChange) {
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

  const input = document.createElement("input");
  input.type = type === "number" ? "number" : "text";
  input.className = "frontmatter-value-input";
  input.value =
    type === "null" ? "" : value === null || value === undefined ? "" : String(value);
  input.placeholder = type === "null" ? "null" : "value";
  input.spellcheck = false;

  input.addEventListener("input", () => {
    parentContainer[parentKey] = coerceScalar(type, input.value);
    onValueChange();
  });

  wrapper.appendChild(input);
  return wrapper;
}

function renderNestedObjectEditor(objectValue, onRefresh, onValueChange, depth) {
  const wrapper = document.createElement("div");
  wrapper.className = "frontmatter-nested";

  wrapper.appendChild(renderObjectEditor(objectValue, onRefresh, onValueChange, depth));
  wrapper.appendChild(renderAddFieldButton(objectValue, onRefresh));
  return wrapper;
}

function renderArrayEditor(arrayValue, onRefresh, onValueChange, depth) {
  const wrapper = document.createElement("div");
  wrapper.className = "frontmatter-array";

  if (arrayValue.length === 0) {
    const empty = document.createElement("p");
    empty.className = "frontmatter-empty";
    empty.textContent = "No items yet.";
    wrapper.appendChild(empty);
  }

  arrayValue.forEach((item, index) => {
    wrapper.appendChild(renderArrayItemRow(item, index, arrayValue, onRefresh, onValueChange, depth));
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

function renderArrayItemRow(item, index, parentArray, onRefresh, onValueChange, depth) {
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
      renderScalarEditor(item, currentType, parentArray, index, onValueChange),
    );
    row.append(marker, typeSelect, valueHost, removeButton);
  }

  entry.appendChild(row);

  if (isNestedType) {
    const children = document.createElement("div");
    children.className = "frontmatter-children";
    children.appendChild(
      renderValueEditor(item, currentType, parentArray, index, onRefresh, onValueChange, depth + 1),
    );
    entry.appendChild(children);
  }

  return entry;
}
