function getCodeBlockStates(lines) {
  const states = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (inCodeBlock) {
      states.push(true);
      if (/^```\s*$/.test(line.trim())) {
        inCodeBlock = false;
      }
      continue;
    }

    states.push(false);
    if (/^```/.test(line.trim())) {
      inCodeBlock = true;
    }
  }

  return states;
}

function looksLikeHtmlTagLine(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("<") || !trimmed.endsWith(">")) {
    return false;
  }

  return /^<\/?[A-Za-z]/.test(trimmed);
}

function looksLikeEncodedHtmlTagLine(line) {
  return /&lt;\/?[A-Za-z]/.test(line);
}

function decodeHtmlLineForEditor(line) {
  if (!looksLikeEncodedHtmlTagLine(line)) {
    return line;
  }

  return line.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function encodeHtmlLineForSource(line) {
  if (!looksLikeHtmlTagLine(line)) {
    return line;
  }

  return line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function transformMarkdownBody(content, transformLine) {
  const lines = content.split(/\r?\n/);
  const codeBlockStates = getCodeBlockStates(lines);

  return lines
    .map((line, index) => (codeBlockStates[index] ? line : transformLine(line)))
    .join("\n");
}

export function prepareMarkdownBodyForEditor(content) {
  return transformMarkdownBody(content ?? "", decodeHtmlLineForEditor);
}

export function prepareMarkdownBodyForSource(content) {
  return transformMarkdownBody(content ?? "", encodeHtmlLineForSource);
}
