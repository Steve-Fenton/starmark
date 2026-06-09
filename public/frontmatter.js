function unescapeDoubleQuoted(value) {
  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\\" && index + 1 < value.length) {
      const next = value[index + 1];
      switch (next) {
        case "n":
          result += "\n";
          index += 1;
          break;
        case "r":
          result += "\r";
          index += 1;
          break;
        case "t":
          result += "\t";
          index += 1;
          break;
        case "\\":
        case '"':
          result += next;
          index += 1;
          break;
        default:
          result += char;
      }
      continue;
    }

    result += char;
  }

  return result;
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === "") {
    return "";
  }

  if (value === "null" || value === "~") {
    return null;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  if (value.startsWith('"') && value.endsWith('"')) {
    return unescapeDoubleQuoted(value.slice(1, -1));
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }

  if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) {
    return value;
  }

  return value;
}

function getLeadingWhitespace(line) {
  const match = line.match(/^[\t ]*/);
  return match ? match[0] : "";
}

function countIndent(line) {
  const whitespace = getLeadingWhitespace(line);
  let indent = 0;

  for (const char of whitespace) {
    indent += char === "\t" ? 4 : 1;
  }

  return indent;
}

function stripLineIndent(line, indentColumns) {
  let consumed = 0;
  let columns = 0;

  while (consumed < line.length && columns < indentColumns) {
    const char = line[consumed];
    if (char === " ") {
      columns += 1;
      consumed += 1;
      continue;
    }

    if (char === "\t") {
      columns += 4;
      consumed += 1;
      continue;
    }

    break;
  }

  return line.slice(consumed);
}

function isBlank(line) {
  return line.trim() === "";
}

function parseBlockScalarHeader(remainder) {
  const match = remainder.match(/^([|>])([-+]?)(?:[ \t]+(\d+))?(?:[ \t]+#.*)?$/);
  if (!match) {
    return null;
  }

  const chompingMap = { "": "clip", "-": "strip", "+": "keep" };
  return {
    style: match[1],
    chomping: chompingMap[match[2] ?? ""],
    indentHint: match[3] ? Number(match[3]) : null,
  };
}

function parseBlockScalarContent(lines, startIndex, baseIndent) {
  let index = startIndex;
  const contentLines = [];
  let contentIndent = null;

  while (index < lines.length) {
    const line = lines[index];

    if (isBlank(line)) {
      if (contentIndent !== null) {
        let peek = index + 1;
        while (peek < lines.length && isBlank(lines[peek])) {
          peek += 1;
        }

        if (peek >= lines.length) {
          contentLines.push("");
          index += 1;
          continue;
        }

        const nextIndent = countIndent(lines[peek]);
        if (nextIndent <= baseIndent || nextIndent < contentIndent) {
          break;
        }

        contentLines.push("");
        index += 1;
        continue;
      }

      contentLines.push("");
      index += 1;
      continue;
    }

    const indent = countIndent(line);
    if (indent <= baseIndent) {
      break;
    }

    if (contentIndent === null) {
      contentIndent = indent;
    } else if (indent < contentIndent) {
      break;
    }

    contentLines.push(stripLineIndent(line, contentIndent));
    index += 1;
  }

  return [contentLines, index];
}

function applyBlockScalarChomping(content, chomping) {
  if (chomping === "strip") {
    return content.replace(/\n+$/, "");
  }

  if (chomping === "clip" && content.endsWith("\n")) {
    return content.slice(0, -1);
  }

  return content;
}

function foldBlockScalar(contentLines) {
  const chunks = [];
  let paragraph = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }

    chunks.push(paragraph.join(" "));
    paragraph = [];
  };

  for (const line of contentLines) {
    if (line === "") {
      flushParagraph();
      chunks.push("");
      continue;
    }

    paragraph.push(line.trimEnd());
  }

  flushParagraph();
  return chunks.join("\n");
}

function parseBlockScalar(lines, startIndex, baseIndent, header) {
  const [contentLines, nextIndex] = parseBlockScalarContent(
    lines,
    startIndex,
    baseIndent,
  );
  let content = contentLines.join("\n");

  if (header.style === ">") {
    content = foldBlockScalar(contentLines);
  }

  content = applyBlockScalarChomping(content, header.chomping);
  return [content, nextIndex];
}

function parseBlockScalarValue(lines, startIndex, baseIndent, remainder) {
  const header = parseBlockScalarHeader(remainder);
  if (!header) {
    return null;
  }

  return parseBlockScalar(lines, startIndex, baseIndent, header);
}

function parseInlineArray(value) {
  const inner = value.slice(1, -1).trim();
  if (inner === "") {
    return [];
  }

  const items = [];
  let current = "";
  let quote = null;

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];

    if (quote) {
      current += char;
      if (char === quote && inner[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === ",") {
      items.push(parseScalar(current));
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim() !== "") {
    items.push(parseScalar(current));
  }

  return items;
}

function parseInlineObject(value) {
  const inner = value.slice(1, -1).trim();
  if (inner === "") {
    return {};
  }

  const result = {};
  let currentKey = "";
  let currentValue = "";
  let quote = null;
  let readingKey = true;

  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];

    if (quote) {
      if (readingKey) {
        currentKey += char;
      } else {
        currentValue += char;
      }
      if (char === quote && inner[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      if (readingKey) {
        currentKey += char;
      } else {
        currentValue += char;
      }
      continue;
    }

    if (readingKey) {
      if (char === ":") {
        readingKey = false;
        continue;
      }
      currentKey += char;
      continue;
    }

    if (char === ",") {
      result[currentKey.trim()] = parseScalar(currentValue);
      currentKey = "";
      currentValue = "";
      readingKey = true;
      continue;
    }

    currentValue += char;
  }

  if (currentKey.trim() !== "") {
    result[currentKey.trim()] = parseScalar(currentValue);
  }

  return result;
}

function parseBlock(lines, startIndex, baseIndent) {
  const firstLine = lines[startIndex];
  const trimmed = firstLine.trim();

  if (trimmed.startsWith("- ")) {
    return parseArrayBlock(lines, startIndex, baseIndent);
  }

  return parseObjectBlock(lines, startIndex, baseIndent);
}

function parseObjectBlock(lines, startIndex, baseIndent) {
  const result = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const indent = countIndent(line);
    if (indent < baseIndent) {
      break;
    }

    if (indent > baseIndent) {
      throw new Error(`Unexpected indentation at line ${index + 1}`);
    }

    const trimmed = line.trim();
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) {
      throw new Error(`Expected key at line ${index + 1}`);
    }

    const key = trimmed.slice(0, colonIndex).trim();
    const remainder = trimmed.slice(colonIndex + 1).trim();
    index += 1;

    if (remainder === "") {
      while (index < lines.length && isBlank(lines[index])) {
        index += 1;
      }

      if (index >= lines.length) {
        result[key] = null;
        continue;
      }

      const childIndent = countIndent(lines[index]);
      if (childIndent <= baseIndent) {
        result[key] = null;
        continue;
      }

      const [value, nextIndex] = parseBlock(lines, index, childIndent);
      result[key] = value;
      index = nextIndex;
      continue;
    }

    if (remainder.startsWith("[") && remainder.endsWith("]")) {
      result[key] = parseInlineArray(remainder);
      continue;
    }

    if (remainder.startsWith("{") && remainder.endsWith("}")) {
      result[key] = parseInlineObject(remainder);
      continue;
    }

    const blockScalar = parseBlockScalarValue(lines, index, baseIndent, remainder);
    if (blockScalar) {
      const [value, nextIndex] = blockScalar;
      result[key] = value;
      index = nextIndex;
      continue;
    }

    result[key] = parseScalar(remainder);
  }

  return [result, index];
}

function parseArrayBlock(lines, startIndex, baseIndent) {
  const result = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const indent = countIndent(line);
    if (indent < baseIndent) {
      break;
    }

    if (indent > baseIndent) {
      throw new Error(`Unexpected indentation at line ${index + 1}`);
    }

    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      break;
    }

    const itemText = trimmed.slice(2).trim();
    index += 1;

    if (itemText === "") {
      while (index < lines.length && isBlank(lines[index])) {
        index += 1;
      }

      if (index >= lines.length) {
        result.push(null);
        continue;
      }

      const childIndent = countIndent(lines[index]);
      if (childIndent <= baseIndent) {
        result.push(null);
        continue;
      }

      const [value, nextIndex] = parseBlock(lines, index, childIndent);
      result.push(value);
      index = nextIndex;
      continue;
    }

    const blockScalarItem = parseBlockScalarValue(lines, index, baseIndent, itemText);
    if (blockScalarItem) {
      const [value, nextIndex] = blockScalarItem;
      result.push(value);
      index = nextIndex;
      continue;
    }

    const colonIndex = itemText.indexOf(": ");
    if (colonIndex !== -1) {
      const itemKey = itemText.slice(0, colonIndex).trim();
      const remainder = itemText.slice(colonIndex + 2).trim();
      const blockScalar = parseBlockScalarValue(lines, index, baseIndent, remainder);
      const itemObject = {
        [itemKey]: blockScalar
          ? blockScalar[0]
          : parseScalar(remainder),
      };

      if (blockScalar) {
        index = blockScalar[1];
      }

      while (index < lines.length && !isBlank(lines[index])) {
        const nextLine = lines[index];
        const nextIndent = countIndent(nextLine);
        if (nextIndent <= baseIndent) {
          break;
        }

        const nextTrimmed = nextLine.trim();
        const nextColonIndex = nextTrimmed.indexOf(":");
        if (nextColonIndex === -1) {
          break;
        }

        const nextKey = nextTrimmed.slice(0, nextColonIndex).trim();
        const nextRemainder = nextTrimmed.slice(nextColonIndex + 1).trim();
        index += 1;

        if (nextRemainder === "") {
          while (index < lines.length && isBlank(lines[index])) {
            index += 1;
          }

          if (index >= lines.length || countIndent(lines[index]) <= nextIndent) {
            itemObject[nextKey] = null;
            continue;
          }

          const [value, nextIndex] = parseBlock(lines, index, countIndent(lines[index]));
          itemObject[nextKey] = value;
          index = nextIndex;
          continue;
        }

        if (nextRemainder.startsWith("[") && nextRemainder.endsWith("]")) {
          itemObject[nextKey] = parseInlineArray(nextRemainder);
          continue;
        }

        const nextBlockScalar = parseBlockScalarValue(
          lines,
          index,
          nextIndent,
          nextRemainder,
        );
        if (nextBlockScalar) {
          itemObject[nextKey] = nextBlockScalar[0];
          index = nextBlockScalar[1];
          continue;
        }

        itemObject[nextKey] = parseScalar(nextRemainder);
      }

      result.push(itemObject);
      continue;
    }

    if (itemText.startsWith("[") && itemText.endsWith("]")) {
      result.push(parseInlineArray(itemText));
      continue;
    }

    if (itemText.startsWith("{") && itemText.endsWith("}")) {
      result.push(parseInlineObject(itemText));
      continue;
    }

    result.push(parseScalar(itemText));
  }

  return [result, index];
}

export function parseFrontmatter(text) {
  const trimmed = text.trim();
  if (trimmed === "") {
    return {};
  }

  const lines = trimmed.split(/\r?\n/);
  const [value] = parseBlock(lines, 0, 0);
  return value ?? {};
}

function needsQuotes(value) {
  if (value === "") {
    return true;
  }

  if (/^\d/.test(value) && /^-?\d+(?:\.\d+)?$/.test(value)) {
    return true;
  }

  if (value === "true" || value === "false" || value === "null" || value === "~") {
    return true;
  }

  if (/[:[\]{},#&*!|>'"%@`]/.test(value)) {
    return true;
  }

  if (/^\s|\s$/.test(value)) {
    return true;
  }

  if (/[\n\r\t]/.test(value)) {
    return true;
  }

  return false;
}

function quoteString(value) {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `"${escaped}"`;
}

function stringifyBlockLiteral(value, contentIndent) {
  const contentPad = "  ".repeat(contentIndent);
  const lines = value.split("\n");
  return `|\n${lines.map((line) => contentPad + line).join("\n")}`;
}

function stringifyScalar(value, { contentIndent = null } = {}) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (typeof value === "number") {
    return String(value);
  }

  const stringValue = String(value);
  if (stringValue.includes("\n") && contentIndent !== null) {
    return stringifyBlockLiteral(stringValue, contentIndent);
  }

  return needsQuotes(stringValue) ? quoteString(stringValue) : stringValue;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringifyObjectEntry(key, value, indent) {
  const pad = "  ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${pad}${key}: []`;
    }

    const rendered = stringifyArray(value, indent + 1);
    return `${pad}${key}:\n${rendered}`;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${pad}${key}: {}`;
    }

    const rendered = stringifyObject(value, indent + 1);
    return `${pad}${key}:\n${rendered}`;
  }

  return `${pad}${key}: ${stringifyScalar(value, { contentIndent: indent + 1 })}`;
}

function stringifyArrayItem(value, indent) {
  const pad = "  ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return `${pad}- []`;
    }

    const rendered = stringifyArray(value, indent + 1);
    return `${pad}-\n${rendered}`;
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return `${pad}- {}`;
    }

    const [firstKey, firstValue] = entries[0];
    const rest = entries.slice(1);
    let lines = [
      `${pad}- ${firstKey}: ${stringifyScalar(firstValue, { contentIndent: indent + 1 })}`,
    ];

    for (const [key, entryValue] of rest) {
      lines.push(stringifyObjectEntry(key, entryValue, indent + 1));
    }

    return lines.join("\n");
  }

  return `${pad}- ${stringifyScalar(value, { contentIndent: indent + 1 })}`;
}

function stringifyArray(value, indent) {
  return value.map((item) => stringifyArrayItem(item, indent)).join("\n");
}

function stringifyObject(value, indent) {
  return Object.entries(value)
    .map(([key, entryValue]) => stringifyObjectEntry(key, entryValue, indent))
    .join("\n");
}

export function stringifyFrontmatter(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return stringifyArray(value, 0);
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return "";
    }

    return stringifyObject(value, 0);
  }

  return stringifyScalar(value);
}

export function normalizeFrontmatter(value) {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export function inferValueType(value) {
  if (value === null) {
    return "null";
  }

  if (typeof value === "boolean") {
    return "boolean";
  }

  if (typeof value === "number") {
    return "number";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (isPlainObject(value)) {
    return "object";
  }

  return "string";
}

export function defaultValueForType(type) {
  switch (type) {
    case "boolean":
      return false;
    case "number":
      return 0;
    case "null":
      return null;
    case "array":
      return [];
    case "object":
      return {};
    default:
      return "";
  }
}

export function getTodayDateString() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

export function updateContentDateInFrontmatter(frontmatterText, fieldName = "modDate") {
  const trimmed = (frontmatterText ?? "").trim();
  if (trimmed === "" || !fieldName) {
    return trimmed === "" ? null : normalizeFrontmatter(trimmed);
  }

  let data;
  try {
    data = parseFrontmatter(trimmed);
  } catch {
    return normalizeFrontmatter(trimmed);
  }

  if (!isPlainObject(data)) {
    return normalizeFrontmatter(trimmed);
  }

  const today = getTodayDateString();

  if (Object.prototype.hasOwnProperty.call(data, fieldName)) {
    data[fieldName] = today;
    return normalizeFrontmatter(stringifyFrontmatter(data));
  }

  const entries = Object.entries(data);
  const pubDateIndex = entries.findIndex(([key]) => key === "pubDate");
  if (pubDateIndex !== -1) {
    entries.splice(pubDateIndex + 1, 0, [fieldName, today]);
    data = Object.fromEntries(entries);
  } else {
    data[fieldName] = today;
  }

  return normalizeFrontmatter(stringifyFrontmatter(data));
}

export function prepareImportedFrontmatter(frontmatterText) {
  const trimmed = (frontmatterText ?? "").trim();
  if (trimmed === "") {
    return null;
  }

  let data;
  try {
    data = parseFrontmatter(trimmed);
  } catch {
    return null;
  }

  if (!isPlainObject(data)) {
    return null;
  }

  delete data.modDate;

  if (Object.prototype.hasOwnProperty.call(data, "pubDate")) {
    data.pubDate = getTodayDateString();
  }

  return normalizeFrontmatter(stringifyFrontmatter(data));
}
