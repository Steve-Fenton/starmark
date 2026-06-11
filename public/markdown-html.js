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

function looksLikeEncodedHtmlTagLine(line) {
  return /&lt;\/?[A-Za-z]/.test(line);
}

function decodeHtmlLineForEditor(line) {
  if (!looksLikeEncodedHtmlTagLine(line)) {
    return line;
  }

  return line.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
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
  return content ?? "";
}
