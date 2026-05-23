import fs from "fs/promises";
import path from "path";

const CONTENT_CONFIG_CANDIDATES = [
  "src/content.config.ts",
  "src/content.config.js",
  "src/content.config.mjs",
  "src/content/config.ts",
  "src/content/config.js",
  "src/content/config.mjs",
];

const PAGES_FRONTMATTER_FIELDS = [
  { name: "layout", type: "literal", value: "src/layouts/Default.astro" },
  { name: "title", type: "string" },
  { name: "pubDate", type: "string" },
  { name: "description", type: "string" },
];

function normalizeSlashes(value) {
  return String(value).replace(/\\/g, "/").replace(/^\/+/, "");
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("`") && trimmed.endsWith("`"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function formatFrontmatter(fields) {
  const lines = fields.map((field) => {
    if (field.type === "literal") {
      return `${field.name}: ${field.value}`;
    }

    if (field.type === "boolean") {
      return `${field.name}: false`;
    }

    if (field.type === "array") {
      return `${field.name}: []`;
    }

    if (field.type === "object") {
      return `${field.name}: {}`;
    }

    return `${field.name}:`;
  });

  return `---\n${lines.join("\n")}\n---\n`;
}

function inferZodType(typeSource) {
  const normalized = typeSource.replace(/\s+/g, " ");

  if (/z\.array/.test(normalized)) {
    return "array";
  }

  if (/z\.object/.test(normalized)) {
    return "object";
  }

  if (/z\.boolean/.test(normalized)) {
    return "boolean";
  }

  if (/z\.number/.test(normalized)) {
    return "number";
  }

  if (/z\.(?:coerce\.)?date/.test(normalized)) {
    return "string";
  }

  return "string";
}

function parseZodObjectFields(objectBody) {
  const fields = [];
  let depth = 0;
  let chunkStart = 0;

  for (let index = 0; index < objectBody.length; index += 1) {
    const char = objectBody[index];

    if (char === "{" || char === "(") {
      depth += 1;
    } else if (char === "}" || char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      const chunk = objectBody.slice(chunkStart, index).trim();
      const field = parseFieldChunk(chunk);
      if (field) {
        fields.push(field);
      }
      chunkStart = index + 1;
    }
  }

  const finalChunk = objectBody.slice(chunkStart).trim();
  if (finalChunk) {
    const field = parseFieldChunk(finalChunk);
    if (field) {
      fields.push(field);
    }
  }

  return fields;
}

function parseFieldChunk(chunk) {
  const match = chunk.match(/^(\w+)\s*:/);
  if (!match) {
    return null;
  }

  const name = match[1];
  const typeSource = chunk.slice(match[0].length).trim();

  return {
    name,
    type: inferZodType(typeSource),
  };
}

function extractSchemaObjectBody(defineCollectionBody, configText) {
  const inlineSchemaMatch = defineCollectionBody.match(
    /schema\s*:\s*(?:\([^)]*\)\s*=>\s*)?z\.object\s*\(\s*\{([\s\S]*?)\}\s*\)/,
  );

  if (inlineSchemaMatch) {
    return inlineSchemaMatch[1];
  }

  const schemaRefMatch = defineCollectionBody.match(/schema\s*:\s*(\w+)\s*(?:\(|,|\})/);
  if (!schemaRefMatch) {
    return null;
  }

  const schemaName = schemaRefMatch[1];
  const exportedSchemaMatch = configText.match(
    new RegExp(
      `(?:export\\s+)?(?:const|function)\\s+${schemaName}\\s*=\\s*(?:\\([^)]*\\)\\s*=>\\s*)?z\\.object\\s*\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`,
    ),
  );

  return exportedSchemaMatch?.[1] ?? null;
}

function extractLoaderBase(defineCollectionBody) {
  const baseMatch = defineCollectionBody.match(/base\s*:\s*['"`]([^'"`]+)['"`]/);
  if (!baseMatch) {
    return null;
  }

  return normalizeSlashes(stripQuotes(baseMatch[1])).replace(/^\.\//, "");
}

function extractDefineCollectionBody(text, startIndex) {
  const openBraceIndex = text.indexOf("{", startIndex);
  if (openBraceIndex === -1) {
    return null;
  }

  let depth = 0;
  for (let index = openBraceIndex; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(openBraceIndex + 1, index);
      }
    }
  }

  return null;
}

function parseDefineCollectionBlocks(configText) {
  const blocksByIdentifier = new Map();
  const defineCollectionPattern = /(?:const|let)\s+(\w+)\s*=\s*defineCollection\s*\(/g;

  for (const match of configText.matchAll(defineCollectionPattern)) {
    const identifier = match[1];
    const body = extractDefineCollectionBody(configText, match.index + match[0].length - 1);
    if (body) {
      blocksByIdentifier.set(identifier, body);
    }
  }

  return blocksByIdentifier;
}

function splitTopLevelCommas(text) {
  const parts = [];
  let depth = 0;
  let chunkStart = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === "{" || char === "(") {
      depth += 1;
    } else if (char === "}" || char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      const chunk = text.slice(chunkStart, index).trim();
      if (chunk) {
        parts.push(chunk);
      }
      chunkStart = index + 1;
    }
  }

  const finalChunk = text.slice(chunkStart).trim();
  if (finalChunk) {
    parts.push(finalChunk);
  }

  return parts;
}

function parseCollectionsExport(configText, blocksByIdentifier) {
  const collections = new Map();
  const exportMatch = configText.match(/export\s+const\s+collections\s*=\s*\{/);

  if (!exportMatch) {
    for (const [identifier, body] of blocksByIdentifier.entries()) {
      collections.set(identifier, body);
    }
    return collections;
  }

  const openBraceIndex = configText.indexOf("{", exportMatch.index);
  let depth = 0;
  let closeBraceIndex = openBraceIndex;

  for (let index = openBraceIndex; index < configText.length; index += 1) {
    const char = configText[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        closeBraceIndex = index;
        break;
      }
    }
  }

  const exportBody = configText.slice(openBraceIndex + 1, closeBraceIndex);

  for (const entry of splitTopLevelCommas(exportBody)) {
    const shorthandMatch = entry.match(/^(\w+)\s*$/);
    if (shorthandMatch) {
      const identifier = shorthandMatch[1];
      if (blocksByIdentifier.has(identifier)) {
        collections.set(identifier, blocksByIdentifier.get(identifier));
      }
      continue;
    }

    const explicitMatch = entry.match(/^(['"`]?)([\w-]+)\1\s*:\s*defineCollection\s*\(/);
    if (explicitMatch) {
      const collectionName = explicitMatch[2];
      const defineIndex = configText.indexOf(entry, openBraceIndex);
      const bodyStart = configText.indexOf("{", defineIndex);
      const body = extractDefineCollectionBody(configText, bodyStart);
      if (body) {
        collections.set(collectionName, body);
      }
      continue;
    }

    const identifierMatch = entry.match(/^(\w+)\s*:\s*(\w+)\s*$/);
    if (identifierMatch) {
      const collectionName = identifierMatch[1];
      const identifier = identifierMatch[2];
      if (blocksByIdentifier.has(identifier)) {
        collections.set(collectionName, blocksByIdentifier.get(identifier));
      }
    }
  }

  if (collections.size === 0) {
    for (const [identifier, body] of blocksByIdentifier.entries()) {
      collections.set(identifier, body);
    }
  }

  return collections;
}

function parseContentConfig(configText) {
  const blocksByIdentifier = parseDefineCollectionBlocks(configText);
  const rawCollections = parseCollectionsExport(configText, blocksByIdentifier);
  const collections = {};

  for (const [name, body] of rawCollections.entries()) {
    const schemaBody = extractSchemaObjectBody(body, configText);
    collections[name] = {
      name,
      basePath: extractLoaderBase(body),
      fields: schemaBody ? parseZodObjectFields(schemaBody) : [],
    };
  }

  return collections;
}

async function readContentConfig(projectPath) {
  for (const relativePath of CONTENT_CONFIG_CANDIDATES) {
    const configPath = path.join(projectPath, relativePath);

    try {
      const configText = await fs.readFile(configPath, "utf8");
      return parseContentConfig(configText);
    } catch {
      // Try the next known config location.
    }
  }

  return {};
}

function getContentCollectionName(relativePath, collections) {
  const normalizedPath = normalizeSlashes(relativePath);
  const folderMatch = normalizedPath.match(/^src\/content\/([^/]+)/);

  if (!folderMatch) {
    return null;
  }

  const folderName = folderMatch[1];

  if (collections[folderName]) {
    return folderName;
  }

  for (const [name, collection] of Object.entries(collections)) {
    if (collection.basePath && normalizedPath.startsWith(`${collection.basePath}/`)) {
      return name;
    }

    if (collection.basePath === normalizedPath) {
      return name;
    }
  }

  return folderName;
}

function buildPagesFrontmatter() {
  return formatFrontmatter(PAGES_FRONTMATTER_FIELDS);
}

function buildContentFrontmatter(collection) {
  if (!collection?.fields?.length) {
    return "---\n---\n";
  }

  return formatFrontmatter(collection.fields);
}

export async function buildInitialFileContent(projectPath, relativePath, source) {
  const normalizedPath = normalizeSlashes(relativePath);

  if (source === "pages" || normalizedPath.startsWith("src/pages/")) {
    return buildPagesFrontmatter();
  }

  if (source === "content" || normalizedPath.startsWith("src/content/")) {
    const collections = await readContentConfig(projectPath);
    const collectionName = getContentCollectionName(normalizedPath, collections);
    const collection = collectionName ? collections[collectionName] : null;
    return buildContentFrontmatter(collection);
  }

  return "";
}
