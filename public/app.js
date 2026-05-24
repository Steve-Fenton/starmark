import { icons } from "./icons.js";
import { createFrontmatterEditor } from "./frontmatter-editor.js";
import { normalizeFrontmatter, prepareImportedFrontmatter } from "./frontmatter.js";
import {
  prepareMarkdownBodyForEditor,
  prepareMarkdownBodyForSource,
} from "./markdown-html.js";
import { getImageMode, getSettings, loadSettings, onSettingsChange, saveSettings } from "./settings.js";

const folderInput = document.getElementById("folder-path");
const browseBtn = document.getElementById("browse-btn");
const scanBtn = document.getElementById("scan-btn");
const scanInfo = document.getElementById("scan-info");
const fileCount = document.getElementById("file-count");
const collapseAllBtn = document.getElementById("collapse-all-btn");
const emptyState = document.getElementById("empty-state");
const searchBox = document.getElementById("search-box");
const fileSearch = document.getElementById("file-search");
const fileList = document.getElementById("file-list");
const listView = document.getElementById("list-view");
const editView = document.getElementById("edit-view");
const editBackBtn = document.getElementById("edit-back-btn");
const editSaveBtn = document.getElementById("edit-save-btn");
const editFileName = document.getElementById("edit-file-name");
const editFilePath = document.getElementById("edit-file-path");
const markdownEditor = document.getElementById("markdown-editor");
const editToolbar = document.getElementById("edit-toolbar");
const frontmatterPanel = document.getElementById("frontmatter-panel");
const frontmatterEditorRoot = document.getElementById("frontmatter-editor");
const frontmatterEditor = createFrontmatterEditor(frontmatterEditorRoot, {
  onChange(value, options = {}) {
    handleFrontmatterInput();
    if (options.save) {
      saveCurrentFile();
    }
  },
  getProjectPath: () => currentProjectPath,
});
const projectsSection = document.getElementById("projects-section");
const projectList = document.getElementById("project-list");
const projectsMenuBtn = document.getElementById("projects-menu-btn");
const projectsDialog = document.getElementById("projects-dialog");
const projectsDialogClose = document.getElementById("projects-dialog-close");
const settingsMenuBtn = document.getElementById("settings-menu-btn");
const settingsDialog = document.getElementById("settings-dialog");
const settingsDialogClose = document.getElementById("settings-dialog-close");
const settingsForm = document.getElementById("settings-form");
const settingImagesSelect = document.getElementById("setting-images");
const settingMediaDirInput = document.getElementById("setting-media-dir");
const settingsProjectLabel = document.getElementById("settings-project");
const settingsError = document.getElementById("settings-error");
const topBar = document.querySelector(".top-bar");
const topBarTitleIcon = document.getElementById("top-bar-title-icon");

let projectButtons = [];
let scannedFiles = [];
let scannedDirectories = [];
let lastScanTargets = [];
let currentProjectPath = "";
let expandedPaths = new Set();
let hasStoredExpandedPaths = false;
let currentEditFile = null;
let currentEditFrontmatter = null;
let isSavingFile = false;
let saveButtonResetTimeout = null;
let pendingEditorCaret = null;
let editorHistory = [];
let editorHistoryIndex = -1;
let editorHistoryDebounce = null;
let isApplyingEditorHistory = false;
const historyChangeListeners = [];
let imageToolMountContainer = null;

const HISTORY_DEBOUNCE_MS = 400;
const MAX_EDITOR_HISTORY = 100;

const SOURCE_ROOTS = {
  content: "src/content",
  pages: "src/pages",
};

const HEADING_LINE_RE = /^(#{1,6})\s+(.*)$/;
const CODE_FENCE_RE = /^```/;
const CODE_FENCE_CLOSE_RE = /^```\s*$/;
const BLOCKQUOTE_LINE_RE = /^\s*>/;
const UNORDERED_LIST_LINE_RE = /^\s*[-*+]\s/;
const ORDERED_LIST_LINE_RE = /^\s*\d+\.\s/;
const COLON_BLOCK_OPEN_RE = /^(:{3,})/;
const COLON_INLINE_DOUBLE_RE = /^::(?!\:)/;
const COLON_INLINE_SINGLE_RE = /^:(?!\:)/;
const EDITOR_LINE_SELECTOR = "p, h1, h2, h3, h4, h5, h6";
const COLON_DEPTH_CLASSES = Array.from({ length: 6 }, (_, index) => `colon-depth-${index + 1}`);
const LINE_DECORATION_CLASSES = [
  "is-code-block",
  "is-blockquote",
  "is-list",
  "is-colon-block-start",
  "is-colon-block-end",
  "is-colon-inline",
  ...COLON_DEPTH_CLASSES,
];
const COLON_IMG_LINE_RE = /^:img\{\s*([^}]*)\}\s*$/;
const HTML_IMG_LINE_RE = /^<img\b[^>]*\/?>\s*$/i;
const COLON_IMG_SRC_RE = /\bsrc\s*=\s*"([^"]*)"/;
const COLON_IMG_ALT_RE = /\balt\s*=\s*"([^"]*)"/;
const MARKDOWN_IMG_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function getCodeBlockStates(lines) {
  const states = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (inCodeBlock) {
      states.push(true);

      if (CODE_FENCE_CLOSE_RE.test(line)) {
        inCodeBlock = false;
      }
    } else if (CODE_FENCE_RE.test(line)) {
      states.push(true);
      inCodeBlock = true;
    } else {
      states.push(false);
    }
  }

  return states;
}

function getColonLineStates(lines, codeBlockStates) {
  const states = [];
  const blockStack = [];

  function pushContentState() {
    states.push({
      inColonBlock: blockStack.length > 0,
      colonRole: null,
      colonDepth: 0,
    });
  }

  function pushInlineState(depth) {
    states.push({
      inColonBlock: blockStack.length > 0,
      colonRole: "inline",
      colonDepth: depth,
    });
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (codeBlockStates[index]) {
      states.push({
        inColonBlock: blockStack.length > 0,
        colonRole: null,
        colonDepth: 0,
      });
      continue;
    }

    if (blockStack.length > 0) {
      const currentDepth = blockStack[blockStack.length - 1];
      const closePattern = new RegExp(`^(:{${currentDepth}})\\s*$`);

      if (closePattern.test(line)) {
        states.push({
          inColonBlock: true,
          colonRole: "block-end",
          colonDepth: currentDepth,
        });
        blockStack.pop();
        continue;
      }

      const nestedOpenMatch = line.match(COLON_BLOCK_OPEN_RE);
      if (nestedOpenMatch) {
        const depth = nestedOpenMatch[1].length;
        states.push({
          inColonBlock: true,
          colonRole: "block-start",
          colonDepth: depth,
        });
        blockStack.push(depth);
        continue;
      }

      if (COLON_INLINE_DOUBLE_RE.test(line)) {
        pushInlineState(2);
        continue;
      }

      if (COLON_INLINE_SINGLE_RE.test(line)) {
        pushInlineState(1);
        continue;
      }

      pushContentState();
      continue;
    }

    const blockOpenMatch = line.match(COLON_BLOCK_OPEN_RE);
    if (blockOpenMatch) {
      const depth = blockOpenMatch[1].length;
      states.push({
        inColonBlock: true,
        colonRole: "block-start",
        colonDepth: depth,
      });
      blockStack.push(depth);
      continue;
    }

    if (COLON_INLINE_DOUBLE_RE.test(line)) {
      pushInlineState(2);
      continue;
    }

    if (COLON_INLINE_SINGLE_RE.test(line)) {
      pushInlineState(1);
      continue;
    }

    pushContentState();
  }

  return states;
}

function getEditorLineStates(lines) {
  const codeBlockStates = getCodeBlockStates(lines);
  const colonStates = getColonLineStates(lines, codeBlockStates);

  return lines.map((line, index) => {
    const inCodeBlock = codeBlockStates[index];
    const isBlockquote = !inCodeBlock && BLOCKQUOTE_LINE_RE.test(line);
    const isList =
      !inCodeBlock && !isBlockquote && (UNORDERED_LIST_LINE_RE.test(line) || ORDERED_LIST_LINE_RE.test(line));

    return {
      inCodeBlock,
      inColonBlock: colonStates[index].inColonBlock,
      colonRole: colonStates[index].colonRole,
      colonDepth: colonStates[index].colonDepth,
      isBlockquote,
      isList,
    };
  });
}

function getLineElementTagName(line, lineState = {}) {
  if (lineState.inCodeBlock || lineState.inColonBlock) {
    return "p";
  }

  const headingMatch = line.match(HEADING_LINE_RE);

  if (headingMatch) {
    return `h${headingMatch[1].length}`;
  }

  return "p";
}

function getEditorLineText(element) {
  if (
    element.tagName === "P" &&
    element.childNodes.length === 1 &&
    element.firstChild?.nodeName === "BR"
  ) {
    return "";
  }

  return element.textContent ?? "";
}

function getCaretOffsetInElement(element) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) {
    return null;
  }

  const preRange = range.cloneRange();
  preRange.selectNodeContents(element);
  preRange.setEnd(range.startContainer, range.startOffset);
  return preRange.toString().length;
}

function setCaretOffsetInElement(element, offset) {
  const selection = window.getSelection();
  const range = document.createRange();
  let remaining = offset;

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();

  while (textNode) {
    const length = textNode.textContent.length;
    if (remaining <= length) {
      range.setStart(textNode, remaining);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }

    remaining -= length;
    textNode = walker.nextNode();
  }

  range.selectNodeContents(element);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function syncTopBarHeight() {
  if (topBar) {
    document.documentElement.style.setProperty("--top-bar-height", `${topBar.offsetHeight}px`);
  }
}


function wrapEditorSelection(wrapper) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return false;
  }

  const range = selection.getRangeAt(0);
  if (!markdownEditor.contains(range.commonAncestorContainer) || range.collapsed) {
    return false;
  }

  const selectedText = range.toString();
  const markdown = `${wrapper}${selectedText}${wrapper}`;

  range.deleteContents();
  const textNode = document.createTextNode(markdown);
  range.insertNode(textNode);

  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  reevaluateMarkdownEditorLines();
  markdownEditor.focus();
  return true;
}

function saveEditorCaret() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!markdownEditor.contains(range.commonAncestorContainer)) {
    return null;
  }

  const lineElements = getEditorLineElements();

  for (let lineIndex = 0; lineIndex < lineElements.length; lineIndex += 1) {
    const element = lineElements[lineIndex];
    if (!element.contains(range.startContainer) && element !== range.startContainer) {
      continue;
    }

    const offset = getCaretOffsetInElement(element);
    if (offset !== null) {
      return { lineIndex, offset };
    }
  }

  return { lineIndex: lineElements.length, offset: 0 };
}

function normalizeEditorDom() {
  for (const child of [...markdownEditor.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (!child.textContent?.trim()) {
        child.remove();
        continue;
      }

      const paragraph = document.createElement("p");
      paragraph.textContent = child.textContent;
      child.replaceWith(paragraph);
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) {
      child.remove();
      continue;
    }

    const tagName = child.tagName.toLowerCase();
    if (tagName === "br") {
      child.remove();
      continue;
    }

    if (tagName === "div" && !child.matches(EDITOR_LINE_SELECTOR)) {
      const paragraph = document.createElement("p");
      while (child.firstChild) {
        paragraph.appendChild(child.firstChild);
      }

      if (paragraph.childNodes.length === 0) {
        paragraph.append(document.createElement("br"));
      }

      child.replaceWith(paragraph);
    }
  }
}

function getEditorLineElements() {
  return [...markdownEditor.children].filter((child) => child.matches(EDITOR_LINE_SELECTOR));
}

function getEditorLines() {
  return getEditorLineElements().map(getEditorLineText);
}

function getEditorContent() {
  normalizeEditorDom();
  return getEditorLines().join("\n");
}

function getEditorCaretSnapshot() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  if (!markdownEditor.contains(range.commonAncestorContainer)) {
    return null;
  }

  const lineElements = getEditorLineElements();

  for (let lineIndex = 0; lineIndex < lineElements.length; lineIndex += 1) {
    const element = lineElements[lineIndex];
    if (!element.contains(range.startContainer) && element !== range.startContainer) {
      continue;
    }

    const offset = getCaretOffsetInElement(element);
    if (offset !== null) {
      return { lineIndex, offset };
    }
  }

  return { lineIndex: lineElements.length, offset: 0 };
}

function restoreEditorCaretSnapshot(caret) {
  const lineElements = getEditorLineElements();

  if (!caret || lineElements.length === 0) {
    markdownEditor.focus();
    return;
  }

  const element = lineElements[Math.min(caret.lineIndex, lineElements.length - 1)];
  if (!element) {
    markdownEditor.focus();
    return;
  }

  const maxOffset = getEditorLineText(element).length;
  setCaretOffsetInElement(element, Math.min(caret.offset, maxOffset));
  markdownEditor.focus();
}

function createEditorHistorySnapshot() {
  return {
    content: getEditorContent(),
    caret: getEditorCaretSnapshot(),
  };
}

function notifyHistoryChange() {
  const state = {
    canUndo: editorHistoryIndex > 0,
    canRedo: editorHistoryIndex < editorHistory.length - 1,
  };

  for (const listener of historyChangeListeners) {
    listener(state);
  }
}

function updateUndoRedoButtons() {
  notifyHistoryChange();
}

function resetEditorHistory(content) {
  clearTimeout(editorHistoryDebounce);
  editorHistoryDebounce = null;
  editorHistory = [{ content, caret: null }];
  editorHistoryIndex = 0;
  updateUndoRedoButtons();
}

function trimEditorHistory() {
  if (editorHistory.length <= MAX_EDITOR_HISTORY) {
    return;
  }

  const overflow = editorHistory.length - MAX_EDITOR_HISTORY;
  editorHistory = editorHistory.slice(overflow);
  editorHistoryIndex = Math.max(0, editorHistoryIndex - overflow);
}

function commitEditorHistory() {
  if (isApplyingEditorHistory || markdownEditor.dataset.loading || !currentEditFile) {
    return;
  }

  const snapshot = createEditorHistorySnapshot();
  const currentSnapshot = editorHistory[editorHistoryIndex];

  if (currentSnapshot && snapshot.content === currentSnapshot.content) {
    return;
  }

  editorHistory = editorHistory.slice(0, editorHistoryIndex + 1);
  editorHistory.push(snapshot);
  editorHistoryIndex = editorHistory.length - 1;
  trimEditorHistory();
  updateUndoRedoButtons();
}

function flushEditorHistory() {
  clearTimeout(editorHistoryDebounce);
  editorHistoryDebounce = null;
  commitEditorHistory();
}

function scheduleEditorHistoryCommit() {
  clearTimeout(editorHistoryDebounce);
  editorHistoryDebounce = setTimeout(commitEditorHistory, HISTORY_DEBOUNCE_MS);
}

function applyEditorHistorySnapshot(index) {
  const snapshot = editorHistory[index];
  if (!snapshot) {
    return;
  }

  isApplyingEditorHistory = true;
  clearTimeout(editorHistoryDebounce);
  editorHistoryDebounce = null;
  renderMarkdownEditor(snapshot.content);
  restoreEditorCaretSnapshot(snapshot.caret);
  editorHistoryIndex = index;
  isApplyingEditorHistory = false;
  updateUndoRedoButtons();
}

function undoEditorChange() {
  if (editorHistoryIndex <= 0) {
    return;
  }

  applyEditorHistorySnapshot(editorHistoryIndex - 1);
}

function redoEditorChange() {
  if (editorHistoryIndex >= editorHistory.length - 1) {
    return;
  }

  applyEditorHistorySnapshot(editorHistoryIndex + 1);
}

function runEditorHistoryAction(action) {
  flushEditorHistory();
  action();
  flushEditorHistory();
}

function insertParagraphAtEditorCaret() {
  if (markdownEditor.dataset.loading || !currentEditFile) {
    return;
  }

  normalizeEditorDom();
  const caret = getEditorCaretSnapshot();
  if (!caret) {
    return;
  }

  const lines = getEditorLines();
  const { lineIndex, offset } = caret;
  const currentLine = lines[lineIndex] ?? "";
  const before = currentLine.slice(0, offset);
  const after = currentLine.slice(offset);
  const nextLines = [
    ...lines.slice(0, lineIndex),
    before,
    after,
    ...lines.slice(lineIndex + 1),
  ];

  renderMarkdownEditor(nextLines.join("\n"));

  const lineElements = getEditorLineElements();
  const nextLineElement = lineElements[lineIndex + 1];
  if (nextLineElement) {
    setCaretOffsetInElement(nextLineElement, 0);
  }

  scheduleEditorHistoryCommit();
}

function insertMarkdownAtCaret(markdown, caret = pendingEditorCaret) {
  if (!caret) {
    return false;
  }

  const lines = getEditorLines();
  const { lineIndex, offset } = caret;
  const currentLine = lines[lineIndex] ?? "";
  const before = currentLine.slice(0, offset);
  const after = currentLine.slice(offset);
  const insertedLines = markdown.split(/\r?\n/);

  const nextLines = [
    ...lines.slice(0, lineIndex),
    before,
    ...insertedLines,
    after,
    ...lines.slice(lineIndex + 1),
  ];

  renderMarkdownEditor(nextLines.join("\n"));

  const caretLineIndex = lineIndex + 1 + insertedLines.length - 1;
  const lineElements = getEditorLineElements();
  const caretElement = lineElements[caretLineIndex];

  if (caretElement) {
    setCaretOffsetInElement(caretElement, insertedLines[insertedLines.length - 1].length);
  }

  pendingEditorCaret = null;
  flushEditorHistory();
  markdownEditor.focus();
  return true;
}

function applyLineDecorations(element, lineState) {
  element.classList.toggle("is-code-block", lineState.inCodeBlock);
  element.classList.toggle("is-blockquote", lineState.isBlockquote);
  element.classList.toggle("is-list", lineState.isList);
  element.classList.toggle("is-colon-block-start", lineState.colonRole === "block-start");
  element.classList.toggle("is-colon-block-end", lineState.colonRole === "block-end");
  element.classList.toggle("is-colon-inline", lineState.colonRole === "inline");

  const depthClass =
    lineState.colonRole && lineState.colonDepth > 0
      ? `colon-depth-${Math.min(lineState.colonDepth, COLON_DEPTH_CLASSES.length)}`
      : null;

  for (const className of COLON_DEPTH_CLASSES) {
    element.classList.toggle(className, className === depthClass);
  }
}

function parseColonImgAttributes(attributeString) {
  return {
    src: attributeString.match(COLON_IMG_SRC_RE)?.[1] ?? "",
    alt: attributeString.match(COLON_IMG_ALT_RE)?.[1] ?? "",
  };
}

function resolveEditorImageUrl(src) {
  const trimmedSrc = src.trim();
  if (!trimmedSrc) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmedSrc) || /^data:/i.test(trimmedSrc)) {
    return trimmedSrc;
  }

  if (!currentProjectPath) {
    return trimmedSrc;
  }

  const relativePath = trimmedSrc.replace(/^\//, "");
  return `/api/media/file?project=${encodeURIComponent(currentProjectPath)}&path=${encodeURIComponent(relativePath)}`;
}

function getExpectedImagePreviews(line, lineState = {}) {
  if (lineState.inCodeBlock || line.length === 0) {
    return [];
  }

  const colonImgMatch = line.match(COLON_IMG_LINE_RE);
  if (colonImgMatch) {
    const attributes = parseColonImgAttributes(colonImgMatch[1]);
    return attributes.src ? [attributes] : [];
  }

  if (HTML_IMG_LINE_RE.test(line)) {
    const attributes = parseColonImgAttributes(line);
    return attributes.src ? [attributes] : [];
  }

  const previews = [];
  MARKDOWN_IMG_RE.lastIndex = 0;
  let match = MARKDOWN_IMG_RE.exec(line);
  while (match) {
    previews.push({ src: match[2], alt: match[1] });
    match = MARKDOWN_IMG_RE.exec(line);
  }

  return previews;
}

function createEditorImagePreviewChip({ src, alt }) {
  const preview = document.createElement("span");
  preview.className = "editor-image-preview";
  preview.contentEditable = "false";
  preview.dataset.src = src;
  preview.dataset.alt = alt ?? "";
  preview.style.setProperty("--editor-image-url", `url("${resolveEditorImageUrl(src)}")`);
  preview.setAttribute("role", "button");
  preview.setAttribute("tabindex", "-1");
  preview.setAttribute(
    "aria-label",
    alt ? `Preview image: ${alt}. Click to enlarge.` : "Preview image. Click to enlarge.",
  );
  return preview;
}

function appendEditorLineContent(element, line, lineState = {}) {
  if (line.length === 0) {
    element.append(document.createElement("br"));
    return;
  }

  if (lineState.inCodeBlock) {
    element.textContent = line;
    return;
  }

  const colonImgMatch = line.match(COLON_IMG_LINE_RE);
  if (colonImgMatch) {
    element.append(document.createTextNode(line));
    const attributes = parseColonImgAttributes(colonImgMatch[1]);
    if (attributes.src) {
      element.append(createEditorImagePreviewChip(attributes));
    }
    return;
  }

  if (HTML_IMG_LINE_RE.test(line)) {
    element.append(document.createTextNode(line));
    const attributes = parseColonImgAttributes(line);
    if (attributes.src) {
      element.append(createEditorImagePreviewChip(attributes));
    }
    return;
  }

  const previews = getExpectedImagePreviews(line, lineState);
  if (previews.length === 0) {
    element.textContent = line;
    return;
  }

  let lastIndex = 0;
  MARKDOWN_IMG_RE.lastIndex = 0;
  let match = MARKDOWN_IMG_RE.exec(line);
  while (match) {
    if (match.index > lastIndex) {
      element.append(document.createTextNode(line.slice(lastIndex, match.index)));
    }

    element.append(document.createTextNode(match[0]));
    element.append(createEditorImagePreviewChip({ src: match[2], alt: match[1] }));
    lastIndex = match.index + match[0].length;
    match = MARKDOWN_IMG_RE.exec(line);
  }

  if (lastIndex < line.length) {
    element.append(document.createTextNode(line.slice(lastIndex)));
  }
}

function lineInlineDecorationsMatch(element, line, lineState = {}) {
  const expectedPreviews = getExpectedImagePreviews(line, lineState);
  const actualPreviews = [...element.querySelectorAll(".editor-image-preview")].map((preview) => ({
    src: preview.dataset.src ?? "",
    alt: preview.dataset.alt ?? "",
  }));

  if (expectedPreviews.length !== actualPreviews.length) {
    return false;
  }

  return expectedPreviews.every(
    (preview, index) =>
      preview.src === actualPreviews[index].src && preview.alt === actualPreviews[index].alt,
  );
}

function refreshEditorLineInlineDecorations(element, line, lineState = {}) {
  const caretOffset = getCaretOffsetInElement(element);
  element.replaceChildren();
  appendEditorLineContent(element, line, lineState);
  applyLineDecorations(element, lineState);

  if (caretOffset !== null) {
    setCaretOffsetInElement(element, caretOffset);
  }
}

function lineDecorationsMatch(element, lineState) {
  for (const className of LINE_DECORATION_CLASSES) {
    const shouldHaveClass =
      (className === "is-code-block" && lineState.inCodeBlock) ||
      (className === "is-blockquote" && lineState.isBlockquote) ||
      (className === "is-list" && lineState.isList) ||
      (className === "is-colon-block-start" && lineState.colonRole === "block-start") ||
      (className === "is-colon-block-end" && lineState.colonRole === "block-end") ||
      (className === "is-colon-inline" && lineState.colonRole === "inline") ||
      (lineState.colonRole &&
        lineState.colonDepth > 0 &&
        className ===
          `colon-depth-${Math.min(lineState.colonDepth, COLON_DEPTH_CLASSES.length)}`);

    if (element.classList.contains(className) !== shouldHaveClass) {
      return false;
    }
  }

  return true;
}

function createEditorLineElement(line, lineState = {}) {
  const tagName = getLineElementTagName(line, lineState);

  if (tagName !== "p") {
    const element = document.createElement(tagName);
    element.textContent = line;
    return element;
  }

  const paragraph = document.createElement("p");
  appendEditorLineContent(paragraph, line, lineState);
  applyLineDecorations(paragraph, lineState);

  return paragraph;
}

function reevaluateEditorLine(element, lineState = {}) {
  const line = getEditorLineText(element);
  const expectedTag = getLineElementTagName(line, lineState);
  const tagMatches = element.tagName.toLowerCase() === expectedTag;
  const decorationsMatch = lineDecorationsMatch(element, lineState);

  if (tagMatches && decorationsMatch) {
    if (!lineInlineDecorationsMatch(element, line, lineState)) {
      refreshEditorLineInlineDecorations(element, line, lineState);
    }
    return element;
  }

  if (tagMatches) {
    applyLineDecorations(element, lineState);
    return element;
  }

  const caretOffset = getCaretOffsetInElement(element);
  const nextElement = createEditorLineElement(line, lineState);
  element.replaceWith(nextElement);

  if (caretOffset !== null) {
    setCaretOffsetInElement(nextElement, caretOffset);
  }

  return nextElement;
}

function reevaluateMarkdownEditorLines() {
  if (markdownEditor.dataset.loading || !currentEditFile) {
    return;
  }

  normalizeEditorDom();
  const lineElements = getEditorLineElements();
  const lineStates = getEditorLineStates(lineElements.map(getEditorLineText));

  lineElements.forEach((child, index) => {
    reevaluateEditorLine(child, lineStates[index]);
  });

  markdownEditor.classList.toggle("is-empty", markdownEditor.childElementCount === 0);
}

function renderMarkdownEditor(content) {
  markdownEditor.replaceChildren();

  const lines = content.split(/\r?\n/);
  const lineStates = getEditorLineStates(lines);

  for (let index = 0; index < lines.length; index += 1) {
    markdownEditor.append(createEditorLineElement(lines[index], lineStates[index]));
  }

  markdownEditor.classList.toggle("is-empty", markdownEditor.childElementCount === 0);
}

function setMarkdownEditorMessage(message) {
  markdownEditor.replaceChildren();
  const paragraph = document.createElement("p");
  paragraph.textContent = message;
  markdownEditor.append(paragraph);
  markdownEditor.classList.remove("is-empty");
}

function formatFileCount(count, total = count) {
  const countLabel = count === 1 ? "1 file" : `${count} files`;
  if (count === total) {
    return countLabel;
  }

  const totalLabel = total === 1 ? "1 file" : `${total} files`;
  return `${countLabel} of ${totalLabel}`;
}

function filterFiles(files, query) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return files;
  }

  return files.filter((file) => {
    const haystack = [
      file.name,
      file.relativePath,
      file.source,
      file.extension,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

function loadExpandedPaths(projectPath) {
  expandedPaths = new Set();
  hasStoredExpandedPaths = false;

  if (!projectPath) {
    return;
  }

  try {
    const stored = localStorage.getItem(`starmark:expanded:${projectPath}`);
    if (stored !== null) {
      hasStoredExpandedPaths = true;
      expandedPaths = new Set(JSON.parse(stored));
    }
  } catch {
    expandedPaths = new Set();
  }
}

function saveExpandedPaths() {
  if (!currentProjectPath) {
    return;
  }

  hasStoredExpandedPaths = true;

  try {
    localStorage.setItem(
      `starmark:expanded:${currentProjectPath}`,
      JSON.stringify([...expandedPaths]),
    );
  } catch {
    // ignore storage failures
  }
}

function ensureDefaultExpandedRoots(tree) {
  if (hasStoredExpandedPaths || expandedPaths.size > 0) {
    return;
  }

  for (const node of tree) {
    if (node.type === "folder" || node.type === "page-folder") {
      expandedPaths.add(node.path);
    }
  }
}

function collectFolderPaths(nodes, paths = []) {
  for (const node of nodes) {
    if (node.type !== "folder" && node.type !== "page-folder") {
      continue;
    }

    paths.push(node.path);

    if (node.children.length > 0) {
      collectFolderPaths(node.children, paths);
    }
  }

  return paths;
}

function collapseAllFolders() {
  expandedPaths.clear();
  hasStoredExpandedPaths = true;
  saveExpandedPaths();
  updateFileResults();
}

function countTreeContents(nodes) {
  let folders = 0;
  let files = 0;

  for (const node of nodes) {
    if (node.type === "folder" || node.type === "page-folder") {
      folders += 1;
      const nested = countTreeContents(node.children);
      folders += nested.folders;
      files += nested.files;
    } else {
      files += 1;
    }
  }

  return { folders, files };
}

function resolveTreePath(relativePath, sourceHint) {
  const normalized = String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "");

  if (normalized === "src/content" || normalized.startsWith("src/content/")) {
    return {
      source: sourceHint ?? "content",
      rootPath: SOURCE_ROOTS.content,
      segments:
        normalized === "src/content"
          ? []
          : normalized.slice(`${SOURCE_ROOTS.content}/`.length).split("/").filter(Boolean),
    };
  }

  if (normalized === "src/pages" || normalized.startsWith("src/pages/")) {
    return {
      source: sourceHint ?? "pages",
      rootPath: SOURCE_ROOTS.pages,
      segments:
        normalized === "src/pages"
          ? []
          : normalized.slice(`${SOURCE_ROOTS.pages}/`.length).split("/").filter(Boolean),
    };
  }

  return {
    source: sourceHint ?? "project",
    rootPath: "",
    segments: normalized.split("/").filter(Boolean),
  };
}

function isIndexFile(name) {
  const lower = name.toLowerCase();
  return lower === "index.md" || lower === "index.mdx";
}

function parseNavOrderFromFrontmatter(frontmatter) {
  if (!frontmatter) {
    return null;
  }

  const match = frontmatter.match(/^navOrder:\s*(.+)$/m);
  if (!match) {
    return null;
  }

  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getPageStemFromFileName(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".mdx")) {
    return name.slice(0, -4);
  }
  if (lower.endsWith(".md")) {
    return name.slice(0, -3);
  }

  return null;
}

function getSortableNavOrder(node) {
  if (node.type === "page-folder") {
    return node.pageFile.navOrder ?? Number.MAX_SAFE_INTEGER;
  }

  return node.file?.navOrder ?? Number.MAX_SAFE_INTEGER;
}

function getSortableIndexName(node) {
  if (node.type === "page-folder") {
    return node.pageFile.name;
  }

  return node.name;
}

function getSortableDisplayName(node) {
  if (node.type === "page-folder") {
    return node.name;
  }

  return node.name;
}

function compareFolderItems(a, b) {
  const aIsIndex = isIndexFile(getSortableIndexName(a));
  const bIsIndex = isIndexFile(getSortableIndexName(b));
  if (aIsIndex !== bIsIndex) {
    return aIsIndex ? -1 : 1;
  }

  const aOrder = getSortableNavOrder(a);
  const bOrder = getSortableNavOrder(b);
  if (aOrder !== bOrder) {
    return aOrder - bOrder;
  }

  return getSortableDisplayName(a).localeCompare(getSortableDisplayName(b));
}

function compareFolderFiles(a, b) {
  return compareFolderItems(a, b);
}

function getParentRelativePath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
}

function toSortableFile(file) {
  return {
    type: "file",
    name: file.name,
    path: file.relativePath,
    file,
  };
}

function getFolderSiblings(relativePath) {
  const parentPath = getParentRelativePath(relativePath);

  return scannedFiles
    .filter((file) => getParentRelativePath(file.relativePath) === parentPath)
    .map(toSortableFile)
    .sort(compareFolderFiles);
}

function findAdjacentSiblingIndex(siblings, currentIndex, direction) {
  if (direction === "up") {
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      if (!isIndexFile(siblings[index].name)) {
        return index;
      }
    }

    return -1;
  }

  for (let index = currentIndex + 1; index < siblings.length; index += 1) {
    if (!isIndexFile(siblings[index].name)) {
      return index;
    }
  }

  return -1;
}

function assignNavOrders(siblings) {
  const assignments = new Map();
  let order = 0;

  for (const sibling of siblings) {
    if (isIndexFile(sibling.name)) {
      continue;
    }

    assignments.set(sibling.file.absolutePath, order);
    order += 1;
  }

  return assignments;
}

function getMoveState(file) {
  if (isIndexFile(file.name)) {
    return { canMoveUp: false, canMoveDown: false };
  }

  const siblings = getFolderSiblings(file.relativePath);
  const currentIndex = siblings.findIndex(
    (sibling) => sibling.file.absolutePath === file.absolutePath,
  );

  if (currentIndex === -1) {
    return { canMoveUp: false, canMoveDown: false };
  }

  return {
    canMoveUp: findAdjacentSiblingIndex(siblings, currentIndex, "up") !== -1,
    canMoveDown: findAdjacentSiblingIndex(siblings, currentIndex, "down") !== -1,
  };
}

function setNavOrderInFrontmatter(frontmatter, navOrder) {
  const line = `navOrder: ${navOrder}`;

  if (!frontmatter?.trim()) {
    return line;
  }

  if (/^navOrder:\s*.+$/m.test(frontmatter)) {
    return frontmatter.replace(/^navOrder:\s*.+$/m, line);
  }

  return `${frontmatter.replace(/\n?$/, "\n")}${line}`;
}

async function persistFileNavOrder(file, navOrder) {
  let frontmatter;
  let body;

  if (currentEditFile?.absolutePath === file.absolutePath) {
    frontmatter = currentEditFrontmatter;
    body = getEditorContent();
  } else {
    const response = await fetch(`/api/file?path=${encodeURIComponent(file.absolutePath)}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error ?? "Could not read file");
    }

    frontmatter = data.frontmatter;
    body = data.content;
  }

  const newFrontmatter = setNavOrderInFrontmatter(
    normalizeFrontmatter(frontmatter),
    navOrder,
  );
  const content = buildFileContent(newFrontmatter, body);
  const response = await fetch("/api/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: file.absolutePath,
      content,
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? "Could not save file");
  }

  const fileIndex = scannedFiles.findIndex(
    (entry) => entry.absolutePath === file.absolutePath,
  );
  if (fileIndex !== -1) {
    scannedFiles[fileIndex] = { ...scannedFiles[fileIndex], navOrder };
  }

  if (currentEditFile?.absolutePath === file.absolutePath) {
    currentEditFrontmatter = normalizeFrontmatter(newFrontmatter);
    frontmatterEditor.setValue(currentEditFrontmatter ?? "");
    updateEditHeader(currentEditFile, currentEditFrontmatter);
  }
}

async function moveFileInFolder(file, direction) {
  if (isIndexFile(file.name)) {
    return;
  }

  const siblings = getFolderSiblings(file.relativePath);
  const currentIndex = siblings.findIndex(
    (sibling) => sibling.file.absolutePath === file.absolutePath,
  );
  const targetIndex = findAdjacentSiblingIndex(siblings, currentIndex, direction);

  if (currentIndex === -1 || targetIndex === -1) {
    return;
  }

  const reordered = [...siblings];
  const [item] = reordered.splice(currentIndex, 1);
  reordered.splice(targetIndex, 0, item);

  const newOrders = assignNavOrders(reordered);
  const updates = [];

  for (const [absolutePath, navOrder] of newOrders) {
    const sibling = reordered.find((entry) => entry.file.absolutePath === absolutePath);
    const currentNavOrder = sibling?.file.navOrder ?? null;

    if (currentNavOrder !== navOrder) {
      updates.push({ file: sibling.file, navOrder });
    }
  }

  if (updates.length === 0) {
    return;
  }

  setBusy(true);
  clearError();

  try {
    for (const update of updates) {
      await persistFileNavOrder(update.file, update.navOrder);
    }

    updateFileResults();
  } catch (error) {
    showError(error.message ?? "Could not reorder files");
  } finally {
    setBusy(false);
  }
}

function buildFileTree(files, { directories = [], scanTargets = [] } = {}) {
  const roots = new Map();

  function ensureFolder(folderMap, folderPath, name, source) {
    if (!folderMap.has(folderPath)) {
      folderMap.set(folderPath, {
        type: "folder",
        name,
        path: folderPath,
        source,
        childFolders: new Map(),
        files: [],
      });
    }

    return folderMap.get(folderPath);
  }

  function buildFolderChildren(folder) {
    const consumedPaths = new Set();
    const plainSubfolders = [];
    const pageFolders = [];

    const sortedChildFolders = [...folder.childFolders.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const childFolder of sortedChildFolders) {
      const matchingFile = folder.files.find((fileEntry) => {
        const stem = getPageStemFromFileName(fileEntry.name);
        return stem === childFolder.name;
      });

      if (matchingFile) {
        consumedPaths.add(matchingFile.path);
        pageFolders.push({
          type: "page-folder",
          name: childFolder.name,
          path: childFolder.path,
          source: childFolder.source,
          pageFile: matchingFile.file,
          children: buildFolderChildren(childFolder),
        });
      } else {
        plainSubfolders.push({
          type: "folder",
          name: childFolder.name,
          path: childFolder.path,
          source: childFolder.source,
          children: buildFolderChildren(childFolder),
        });
      }
    }

    const remainingFiles = folder.files
      .filter((fileEntry) => !consumedPaths.has(fileEntry.path))
      .map((fileEntry) => ({
        type: "file",
        name: fileEntry.name,
        path: fileEntry.path,
        file: fileEntry.file,
      }));

    const sortableItems = [...pageFolders, ...remainingFiles].sort(compareFolderItems);

    return [...plainSubfolders, ...sortableItems];
  }

  function ensureRoot(source, rootPath) {
    const rootLabel = rootPath || "project";
    ensureFolder(roots, rootPath || "__project__", rootLabel, source);
  }

  function addFolderSegments(rootPath, segments, source) {
    ensureRoot(source, rootPath);

    if (segments.length === 0) {
      return;
    }

    let current = ensureFolder(roots, rootPath || "__project__", rootPath || "project", source);
    let currentPath = rootPath;

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      current = ensureFolder(current.childFolders, currentPath, segment, source);
    }
  }

  function addDirectoryPath(relativePath, sourceHint) {
    const { rootPath, segments, source } = resolveTreePath(relativePath, sourceHint);
    addFolderSegments(rootPath, segments, source);
  }

  for (const target of scanTargets) {
    if (target.pathPrefix) {
      addDirectoryPath(target.pathPrefix, target.source);
    } else {
      ensureRoot(target.source, "");
    }
  }

  for (const directoryPath of directories) {
    addDirectoryPath(directoryPath);
  }

  for (const file of files) {
    const { rootPath, segments, source } = resolveTreePath(file.relativePath, file.source);

    if (segments.length === 0) {
      continue;
    }

    ensureRoot(source, rootPath);

    if (segments.length === 1) {
      const root = ensureFolder(roots, rootPath || "__project__", rootPath || "project", source);
      root.files.push({
        type: "file",
        name: segments[0],
        path: file.relativePath,
        file,
      });
      continue;
    }

    let current = ensureFolder(roots, rootPath || "__project__", rootPath || "project", source);
    let currentPath = rootPath;

    for (let index = 0; index < segments.length - 1; index += 1) {
      currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];
      current = ensureFolder(
        current.childFolders,
        currentPath,
        segments[index],
        source,
      );
    }

    const fileName = segments[segments.length - 1];
    current.files.push({
      type: "file",
      name: fileName,
      path: file.relativePath,
      file,
    });
  }

  const sourceOrder = { content: 0, pages: 1, project: 2 };

  return [...roots.values()]
    .sort((a, b) => {
      const sourceDiff = sourceOrder[a.source] - sourceOrder[b.source];
      if (sourceDiff !== 0) {
        return sourceDiff;
      }

      return a.name.localeCompare(b.name);
    })
    .map((root) => ({
      type: "folder",
      name: root.name,
      path: root.path === "__project__" ? "" : root.path,
      source: root.source,
      children: buildFolderChildren(root),
    }));
}

function updateFileResults() {
  const query = fileSearch.value.trim();
  const filteredFiles = filterFiles(scannedFiles, query);
  const isSearching = query.length > 0;

  fileCount.textContent = formatFileCount(filteredFiles.length, scannedFiles.length);

  if (filteredFiles.length === 0 && isSearching) {
    emptyState.hidden = false;
    emptyState.textContent = "No files match your search.";
    fileList.hidden = true;
    fileList.innerHTML = "";
    collapseAllBtn.hidden = true;
    return;
  }

  const tree = buildFileTree(filteredFiles, {
    directories: isSearching ? [] : scannedDirectories,
    scanTargets: lastScanTargets,
  });

  if (tree.length === 0) {
    emptyState.hidden = false;
    emptyState.textContent = "No .md or .mdx files found in this folder.";
    fileList.hidden = true;
    fileList.innerHTML = "";
    collapseAllBtn.hidden = true;
    return;
  }

  if (!isSearching) {
    ensureDefaultExpandedRoots(tree);
  } else {
    for (const folderPath of collectFolderPaths(tree)) {
      expandedPaths.add(folderPath);
    }
  }

  if (filteredFiles.length === 0 && !isSearching) {
    emptyState.hidden = false;
    emptyState.textContent = "No .md or .mdx files found in this folder.";
  } else {
    emptyState.hidden = true;
  }

  fileList.hidden = false;
  collapseAllBtn.hidden = false;
  renderFileTree(tree, { isSearching });
}

function getProjectLabel(projectPath) {
  if (!projectPath) {
    return "";
  }

  const segments = projectPath.split(/[/\\]/).filter(Boolean);
  return segments.at(-1) ?? projectPath;
}

async function applyScanData(data) {
  const projectChanged = currentProjectPath !== data.projectPath;
  folderInput.value = data.projectPath;
  currentProjectPath = data.projectPath;
  setProjectInUrl(data.projectPath);
  loadExpandedPaths(currentProjectPath);

  scanInfo.hidden = false;
  scanInfo.textContent = formatScanInfo(data.scanTargets);

  scannedFiles = data.files;
  scannedDirectories = data.directories ?? [];
  lastScanTargets = data.scanTargets ?? [];
  fileSearch.value = "";
  searchBox.hidden =
    scannedFiles.length === 0 &&
    scannedDirectories.length === 0 &&
    lastScanTargets.length === 0;

  updateFileResults();

  if (projectChanged) {
    await loadSettings(data.projectPath);
    await mountActiveImageTool();
  }
}

async function refreshScan() {
  if (!currentProjectPath) {
    return null;
  }

  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: currentProjectPath }),
  });
  const data = await response.json();

  if (!response.ok) {
    showError(data.error ?? "Could not refresh folder");
    return null;
  }

  await applyScanData(data);
  return data;
}

function getProjectFromUrl() {
  return new URLSearchParams(window.location.search).get("project");
}

function getFileFromUrl() {
  return new URLSearchParams(window.location.search).get("file");
}

function setProjectInUrl(projectPath) {
  const url = new URL(window.location.href);
  if (projectPath) {
    url.searchParams.set("project", projectPath);
  } else {
    url.searchParams.delete("project");
  }
  window.history.replaceState({}, "", url);
}

function setFileInUrl(filePath) {
  const url = new URL(window.location.href);
  if (filePath) {
    url.searchParams.set("file", filePath);
  } else {
    url.searchParams.delete("file");
  }
  window.history.replaceState({}, "", url);
}

function scrollMainToTop() {
  window.scrollTo(0, 0);
}

function showListView() {
  listView.hidden = false;
  editView.hidden = true;
  scrollMainToTop();
  currentEditFile = null;
  currentEditFrontmatter = null;
  frontmatterPanel.hidden = true;
  frontmatterEditor.setValue("");
  clearTimeout(saveButtonResetTimeout);
  setSaveButtonState({ disabled: true });
  setFileInUrl(null);
}

function getFrontmatterTitle(frontmatter) {
  if (!frontmatter) {
    return null;
  }

  const match = frontmatter.match(/^title:\s*(.+)$/m);
  if (!match) {
    return null;
  }

  let value = match[1].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function updateEditHeader(file, frontmatter = null) {
  editFileName.textContent = getFrontmatterTitle(frontmatter) ?? file.name;
  editFilePath.textContent = file.relativePath;
  editFilePath.title = file.absolutePath;
}

function splitFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  return {
    frontmatter: match[1],
    body: content.slice(match[0].length),
  };
}

function collapseBlankLines(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let previousBlank = false;

  for (const line of lines) {
    const isBlank = line.trim() === "";
    if (isBlank) {
      if (!previousBlank) {
        result.push("");
      }
      previousBlank = true;
    } else {
      result.push(line);
      previousBlank = false;
    }
  }

  return result.join("\n");
}

function buildFileContent(frontmatter, body) {
  const trimmedFrontmatter = frontmatter?.trim() ?? "";
  let content =
    trimmedFrontmatter === ""
      ? body
      : `---\n${trimmedFrontmatter}\n---\n${body}`;

  content = collapseBlankLines(content);
  if (!content.endsWith("\n")) {
    content += "\n";
  }

  return content;
}

function setSaveButtonState({ label = "Save", disabled = false, error = false } = {}) {
  editSaveBtn.textContent = label;
  editSaveBtn.disabled = disabled;
  editSaveBtn.classList.toggle("is-error", error);
}

function resetSaveButtonSoon(delay = 1800) {
  clearTimeout(saveButtonResetTimeout);
  saveButtonResetTimeout = setTimeout(() => {
    if (!isSavingFile) {
      setSaveButtonState({ disabled: !currentEditFile });
    }
  }, delay);
}

async function saveCurrentFile() {
  if (!currentEditFile || isSavingFile || markdownEditor.dataset.loading) {
    return;
  }

  flushEditorHistory();
  currentEditFrontmatter = normalizeFrontmatter(frontmatterEditor.getValue());

  isSavingFile = true;
  setSaveButtonState({ label: "Saving…", disabled: true });

  const writeEditorContent = async () => {
    const body = prepareMarkdownBodyForSource(getEditorContent());
    const content = buildFileContent(currentEditFrontmatter, body);
    const response = await fetch("/api/file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: currentEditFile.absolutePath,
        content,
      }),
    });
    const data = await response.json();
    return { body, content, response, data };
  };

  try {
    let { body, content, response, data } = await writeEditorContent();

    if (!response.ok) {
      setSaveButtonState({
        label: data.error ?? "Save failed",
        disabled: false,
        error: true,
      });
      resetSaveButtonSoon(2500);
      return;
    }

    const latestBody = getEditorContent();
    if (prepareMarkdownBodyForSource(latestBody) !== body) {
      ({ body, content, response, data } = await writeEditorContent());
      if (!response.ok) {
        setSaveButtonState({
          label: data.error ?? "Save failed",
          disabled: false,
          error: true,
        });
        resetSaveButtonSoon(2500);
        return;
      }
    }

    const { frontmatter, body: savedBody } = splitFrontmatter(content);
    currentEditFrontmatter = normalizeFrontmatter(frontmatter ?? "");
    frontmatterEditor.setValue(currentEditFrontmatter ?? "");
    updateEditHeader(currentEditFile, currentEditFrontmatter);

    const navOrder = parseNavOrderFromFrontmatter(currentEditFrontmatter);
    const fileIndex = scannedFiles.findIndex(
      (entry) => entry.absolutePath === currentEditFile.absolutePath,
    );
    if (fileIndex !== -1) {
      scannedFiles[fileIndex] = { ...scannedFiles[fileIndex], navOrder };
      updateFileResults();
    }

    const editorBody = prepareMarkdownBodyForEditor(savedBody);
    renderMarkdownEditor(editorBody);
    resetEditorHistory(editorBody);
    setSaveButtonState({ label: "Saved", disabled: false });
    resetSaveButtonSoon();
  } catch {
    setSaveButtonState({ label: "Save failed", disabled: false, error: true });
    resetSaveButtonSoon(2500);
  } finally {
    isSavingFile = false;
  }
}

function updateFrontmatterPanel(frontmatter) {
  frontmatterEditor.setValue(frontmatter ?? "");
  frontmatterPanel.hidden = false;
  frontmatterPanel.open = false;
}

function handleFrontmatterInput() {
  if (!currentEditFile) {
    return;
  }

  currentEditFrontmatter = normalizeFrontmatter(frontmatterEditor.getValue());
  updateEditHeader(currentEditFile, currentEditFrontmatter);
}

function showEditView() {
  listView.hidden = true;
  editView.hidden = false;
  scrollMainToTop();
}

async function openEditView(file) {
  currentEditFile = file;
  setFileInUrl(file.absolutePath);
  showEditView();

  updateEditHeader(file, null);
  renderMarkdownEditor("");
  resetEditorHistory("");
  updateFrontmatterPanel(null);
  setSaveButtonState({ disabled: true });
  markdownEditor.dataset.loading = "true";

  try {
    const response = await fetch(`/api/file?path=${encodeURIComponent(file.absolutePath)}`);
    const data = await response.json();

    if (!response.ok) {
      setMarkdownEditorMessage(data.error ?? "Could not load file");
      updateFrontmatterPanel(null);
      setSaveButtonState({ disabled: true });
      return;
    }

    if (currentEditFile?.absolutePath !== file.absolutePath) {
      return;
    }

    currentEditFrontmatter = data.frontmatter ?? null;
    updateEditHeader(file, currentEditFrontmatter);
    updateFrontmatterPanel(currentEditFrontmatter);
    const editorBody = prepareMarkdownBodyForEditor(data.content);
    renderMarkdownEditor(editorBody);
    resetEditorHistory(editorBody);
    setSaveButtonState({ disabled: false });
  } catch {
    if (currentEditFile?.absolutePath === file.absolutePath) {
      setMarkdownEditorMessage("Could not load file");
      updateFrontmatterPanel(null);
      setSaveButtonState({ disabled: true });
    }
  } finally {
    delete markdownEditor.dataset.loading;
  }

  markdownEditor.focus();
}

function setBusy(isBusy) {
  browseBtn.disabled = isBusy;
  scanBtn.disabled = isBusy;
  for (const button of projectButtons) {
    button.disabled = isBusy;
  }
}

function showError(message) {
  scanInfo.hidden = false;
  scanInfo.textContent = message;
  scanInfo.classList.add("error");
}

function clearError() {
  scanInfo.classList.remove("error");
}

function renderProjects(projects) {
  projectList.innerHTML = "";
  projectButtons = [];

  if (projects.length === 0) {
    projectsSection.hidden = true;
    return;
  }

  projectsSection.hidden = false;

  for (const project of projects) {
    const item = document.createElement("li");
    item.className = "project-row";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-item";

    const name = document.createElement("span");
    name.className = "project-name";
    name.textContent = project.name;

    const projectPath = document.createElement("span");
    projectPath.className = "project-path";
    projectPath.textContent = project.path;
    projectPath.title = project.path;

    button.append(name, projectPath);
    button.addEventListener("click", () => {
      folderInput.value = project.path;
      scanFolder(project.path);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "tree-action-btn delete-btn project-delete-btn";
    deleteBtn.innerHTML = icons.trash;
    deleteBtn.title = `Remove ${project.name} from remembered projects`;
    deleteBtn.setAttribute(
      "aria-label",
      `Remove ${project.name} from remembered projects`,
    );
    deleteBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeRememberedProject(project);
    });

    projectButtons.push(button, deleteBtn);
    item.append(button, deleteBtn);
    projectList.append(item);
  }
}

function clearCurrentProject() {
  currentProjectPath = "";
  folderInput.value = "";
  scannedFiles = [];
  scannedDirectories = [];
  lastScanTargets = [];
  fileSearch.value = "";
  searchBox.hidden = true;
  fileList.hidden = true;
  collapseAllBtn.hidden = true;
  scanInfo.hidden = true;
  emptyState.hidden = false;
  emptyState.textContent =
    "Open Projects to choose a folder and scan for .md and .mdx files.";
  showListView();
  setProjectInUrl("");
  updateSettingsProjectContext();
}

async function removeRememberedProject(project) {
  setBusy(true);
  clearError();

  try {
    const response = await fetch("/api/projects", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: project.path }),
    });
    const data = await response.json();

    if (!response.ok) {
      showError(data.error ?? "Could not remove project");
      return;
    }

    renderProjects(data.projects ?? []);

    if (currentProjectPath === project.path) {
      clearCurrentProject();
    }
  } catch {
    showError("Could not remove project");
  } finally {
    setBusy(false);
  }
}

async function loadProjects() {
  try {
    const response = await fetch("/api/projects");
    const data = await response.json();

    if (!response.ok) {
      return;
    }

    renderProjects(data.projects ?? []);
  } catch {
    // ignore missing or invalid saved projects
  }
}

async function browseFolder() {
  setBusy(true);
  clearError();

  try {
    const response = await fetch("/api/browse", { method: "POST" });
    const data = await response.json();

    if (!response.ok) {
      if (response.status !== 400) {
        showError(data.error ?? "Could not open folder picker");
      }
      return;
    }

    folderInput.value = data.path;
    await scanFolder(data.path);
  } catch {
    showError("Could not open folder picker");
  } finally {
    setBusy(false);
  }
}

function formatScanInfo(scanTargets) {
  const astroTargets = scanTargets.filter((target) => target.source !== "project");

  if (astroTargets.length === 0) {
    return "No src/content/ or src/pages/ found — scanning project root";
  }

  const labels = astroTargets.map((target) => `${target.pathPrefix}/`);
  return `Scanning ${labels.join(" and ")}`;
}

function createTreeContentsCountColumns(folderCount, fileCount) {
  const folderCol = document.createElement("span");
  folderCol.className = "tree-folder-count-col folders";
  if (folderCount === 0) {
    folderCol.classList.add("is-empty");
  }
  folderCol.innerHTML = `${icons.folder}<span class="tree-folder-count-value">${folderCount}</span>`;
  folderCol.setAttribute(
    "aria-label",
    folderCount === 1 ? "1 folder" : `${folderCount} folders`,
  );

  const fileCol = document.createElement("span");
  fileCol.className = "tree-folder-count-col files";
  if (fileCount === 0) {
    fileCol.classList.add("is-empty");
  }
  fileCol.innerHTML = `${icons.fileText}<span class="tree-folder-count-value">${fileCount}</span>`;
  fileCol.setAttribute("aria-label", fileCount === 1 ? "1 file" : `${fileCount} files`);

  return { folderCol, fileCol };
}

function createFolderMain(...elements) {
  const main = document.createElement("div");
  main.className = "tree-folder-main";
  main.append(...elements);
  return main;
}

function createFolderPrefix(...elements) {
  const prefix = document.createElement("div");
  prefix.className = "tree-folder-prefix";
  prefix.append(...elements);
  return prefix;
}

function createFolderChevron() {
  const chevron = document.createElement("span");
  chevron.className = "tree-folder-chevron";
  chevron.setAttribute("aria-hidden", "true");
  return chevron;
}

function createFolderBadge() {
  const badge = document.createElement("span");
  badge.className = "badge folder";
  badge.innerHTML = `${icons.folder}<span>folder</span>`;
  return badge;
}

function createSourceBadge(source) {
  const sourceIcons = {
    content: icons.fileText,
    pages: icons.layout,
    project: icons.folder,
  };

  const badge = document.createElement("span");
  badge.className = `badge source ${source}`;
  badge.innerHTML = `${sourceIcons[source] ?? ""}<span>${source}</span>`;
  return badge;
}

function appendMoveButtons(actions, file, { isSearching = false } = {}) {
  if (isSearching || file.source === "content") {
    return;
  }

  const { canMoveUp, canMoveDown } = getMoveState(file);

  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "tree-action-btn move-btn";
  upBtn.innerHTML = icons.arrowUp;
  upBtn.title = `Move ${file.name} up`;
  upBtn.setAttribute("aria-label", `Move ${file.name} up`);
  upBtn.disabled = !canMoveUp;
  upBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    moveFileInFolder(file, "up");
  });

  const downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.className = "tree-action-btn move-btn";
  downBtn.innerHTML = icons.arrowDown;
  downBtn.title = `Move ${file.name} down`;
  downBtn.setAttribute("aria-label", `Move ${file.name} down`);
  downBtn.disabled = !canMoveDown;
  downBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    moveFileInFolder(file, "down");
  });

  actions.append(upBtn, downBtn);
}

function createFileRow(node, depth, { isSearching = false } = {}) {
  const file = node.file;
  const item = document.createElement("li");
  item.className = "tree-file";
  item.style.setProperty("--depth", depth);

  const extBadge = document.createElement("span");
  extBadge.className = `badge ${file.extension}`;
  extBadge.innerHTML = `${icons.fileText}<span>${file.extension}</span>`;

  const name = document.createElement("span");
  name.className = "file-name";
  name.textContent = file.name;
  name.title = file.relativePath;

  const main = document.createElement("div");
  main.className = "tree-file-main";
  main.append(extBadge, name);

  const { folderCol, fileCol } = createTreeContentsCountColumns(0, 0);

  const actions = document.createElement("div");
  actions.className = "file-actions";

  appendMoveButtons(actions, file, { isSearching });

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "edit-btn";
  editBtn.innerHTML = icons.edit;
  editBtn.title = `Edit ${file.name}`;
  editBtn.setAttribute("aria-label", `Edit ${file.name}`);
  editBtn.addEventListener("click", () => openEditView(file));

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "tree-action-btn delete-btn";
  deleteBtn.innerHTML = icons.trash;
  deleteBtn.title = `Delete ${file.name}`;
  deleteBtn.setAttribute("aria-label", `Delete ${file.name}`);
  deleteBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openConfirmDeleteDialog({
      type: "file",
      name: file.name,
      relativePath: file.relativePath,
    });
  });

  actions.append(editBtn, deleteBtn);
  item.append(main, folderCol, fileCol, actions);

  item.addEventListener("dblclick", (event) => {
    if (event.target.closest(".file-actions")) {
      return;
    }
    openEditView(file);
  });

  return item;
}

function createPageFolderRow(node, depth, { isSearching = false } = {}) {
  const { pageFile } = node;
  const item = document.createElement("li");
  item.className = "tree-folder tree-page-folder";
  item.style.setProperty("--depth", depth);

  const details = document.createElement("details");
  details.open = isSearching || expandedPaths.has(node.path);

  details.addEventListener("toggle", () => {
    if (details.open) {
      expandedPaths.add(node.path);
    } else {
      expandedPaths.delete(node.path);
    }
    saveExpandedPaths();
  });

  const summary = document.createElement("summary");
  summary.className = "tree-folder-header";

  const pageBadge = document.createElement("span");
  pageBadge.className = "badge page";
  pageBadge.innerHTML = `${icons.folder}<span>page folder</span>`;

  const label = document.createElement("span");
  label.className = "tree-folder-name";
  label.textContent = node.name;
  label.title = pageFile.relativePath;

  const { folders: folderCount, files: nestedFileCount } = countTreeContents(node.children);
  const { folderCol, fileCol } = createTreeContentsCountColumns(folderCount, nestedFileCount);

  summary.append(
    createFolderMain(createFolderPrefix(pageBadge, createFolderChevron()), label),
    folderCol,
    fileCol,
  );

  const actions = document.createElement("div");
  actions.className = "file-actions";

  appendMoveButtons(actions, pageFile, { isSearching });

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "edit-btn";
  editBtn.innerHTML = icons.edit;
  editBtn.title = `Edit ${pageFile.name}`;
  editBtn.setAttribute("aria-label", `Edit ${pageFile.name}`);
  editBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openEditView(pageFile);
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "tree-action-btn add-btn";
  addBtn.innerHTML = icons.plus;
  addBtn.title = `Add to ${node.name}`;
  addBtn.setAttribute("aria-label", `Add file or folder to ${node.name}`);
  addBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openNewItemDialog(node.path);
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "tree-action-btn delete-btn";
  deleteBtn.innerHTML = icons.trash;
  deleteBtn.title = `Delete ${node.name}`;
  deleteBtn.setAttribute("aria-label", `Delete page folder ${node.name}`);
  deleteBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openConfirmDeleteDialog({
      type: "page-folder",
      name: node.name,
      relativePath: node.path,
      pageFilePath: pageFile.relativePath,
      pageFileName: pageFile.name,
    });
  });

  actions.append(editBtn, addBtn, deleteBtn);
  summary.append(actions);

  summary.addEventListener("dblclick", (event) => {
    if (event.target.closest(".file-actions")) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openEditView(pageFile);
  });

  details.append(summary);

  if (node.children.length > 0) {
    const children = document.createElement("ul");
    children.className = "tree-children";

    for (const child of node.children) {
      children.append(createTreeRow(child, depth + 1, { isSearching }));
    }

    details.append(children);
  }

  item.append(details);
  return item;
}

function createTreeRow(node, depth, { isSearching = false } = {}) {
  if (node.type === "folder") {
    return createFolderRow(node, depth, { isSearching });
  }

  if (node.type === "page-folder") {
    return createPageFolderRow(node, depth, { isSearching });
  }

  return createFileRow(node, depth, { isSearching });
}

function createFolderRow(node, depth, { isSearching }) {
  const item = document.createElement("li");
  item.className = "tree-folder";
  item.style.setProperty("--depth", depth);

  const details = document.createElement("details");
  details.open = isSearching || expandedPaths.has(node.path);

  details.addEventListener("toggle", () => {
    if (details.open) {
      expandedPaths.add(node.path);
    } else {
      expandedPaths.delete(node.path);
    }
    saveExpandedPaths();
  });

  const summary = document.createElement("summary");
  summary.className = "tree-folder-header";

  const label = document.createElement("span");
  label.className = "tree-folder-name";
  label.textContent = depth === 0 ? (node.path || node.name) : node.name;

  const { folders: folderCount, files: nestedFileCount } = countTreeContents(node.children);
  const { folderCol, fileCol } = createTreeContentsCountColumns(folderCount, nestedFileCount);

  if (depth > 0) {
    summary.append(
      createFolderMain(createFolderPrefix(createFolderBadge(), createFolderChevron()), label),
      folderCol,
      fileCol,
    );
  } else if (depth === 0 && node.source) {
    summary.append(
      createFolderMain(createFolderPrefix(createSourceBadge(node.source), createFolderChevron()), label),
      folderCol,
      fileCol,
    );
  } else {
    summary.append(
      createFolderMain(createFolderPrefix(createFolderChevron()), label),
      folderCol,
      fileCol,
    );
  }

  const actions = document.createElement("div");
  actions.className = "file-actions";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "tree-action-btn add-btn";
  addBtn.innerHTML = icons.plus;
  addBtn.title = `Add to ${label.textContent}`;
  addBtn.setAttribute("aria-label", `Add file or folder to ${label.textContent}`);
  addBtn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openNewItemDialog(node.path);
  });

  actions.append(addBtn);

  if (depth > 0) {
    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "tree-action-btn delete-btn";
    deleteBtn.innerHTML = icons.trash;
    deleteBtn.title = `Delete ${node.name}`;
    deleteBtn.setAttribute("aria-label", `Delete folder ${node.name}`);
    deleteBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openConfirmDeleteDialog({
        type: "folder",
        name: node.name,
        relativePath: node.path,
      });
    });

    actions.append(deleteBtn);
  }

  summary.append(actions);

  details.append(summary);

  if (node.children.length > 0) {
    const children = document.createElement("ul");
    children.className = "tree-children";

    for (const child of node.children) {
      children.append(createTreeRow(child, depth + 1, { isSearching }));
    }

    details.append(children);
  }

  item.append(details);
  return item;
}

function renderFileTree(tree, { isSearching = false } = {}) {
  fileList.innerHTML = "";
  fileList.className = "file-tree";

  for (const node of tree) {
    fileList.append(createFolderRow(node, 0, { isSearching }));
  }
}

async function scanFolder(pathValue = folderInput.value.trim()) {
  if (!pathValue) {
    showError("Enter or choose a folder path first");
    return;
  }

  setBusy(true);
  clearError();

  try {
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathValue }),
    });

    const data = await response.json();

    if (!response.ok) {
      showError(data.error ?? "Could not scan folder");
      emptyState.hidden = false;
      emptyState.textContent =
        "Open Projects to choose a folder and scan for .md and .mdx files.";
      return;
    }

    await applyScanData(data);
    await loadProjects();
    projectsDialog.close();
  } catch {
    showError("Could not scan folder");
    emptyState.hidden = false;
    emptyState.textContent =
      "Open Projects to choose a folder and scan for .md and .mdx files.";
  } finally {
    setBusy(false);
  }
}

function isMarkdownEntryName(name) {
  const lower = name.trim().toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".mdx");
}

function getPathsToExpand(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const paths = new Set();

  if (!normalized) {
    return paths;
  }

  let current = "";
  for (const segment of normalized.split("/")) {
    current = current ? `${current}/${segment}` : segment;
    paths.add(current);
  }

  return paths;
}

async function fetchFileFrontmatter(absolutePath) {
  const response = await fetch(`/api/file?path=${encodeURIComponent(absolutePath)}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? "Could not read file");
  }

  return data.frontmatter ?? "";
}

async function createEntry(parentPath, name, { frontmatter = null } = {}) {
  if (!currentProjectPath) {
    return { ok: false, error: "Choose a project folder first" };
  }

  const trimmedName = name.trim();
  const existing = entryExistsAtPath(parentPath, trimmedName);
  if (existing.exists) {
    return {
      ok: false,
      error:
        existing.type === "file"
          ? "A file with that name already exists"
          : "A folder with that name already exists",
    };
  }

  setBusy(true);
  clearError();

  try {
    const response = await fetch("/api/entry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath: currentProjectPath,
        parentPath,
        name: trimmedName,
        ...(frontmatter ? { frontmatter } : {}),
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      return { ok: false, error: data.error ?? "Could not create entry" };
    }

    expandedPaths.add(parentPath);
    saveExpandedPaths();

    await refreshScan();

    if (data.type === "file") {
      const file = scannedFiles.find((entry) => entry.absolutePath === data.absolutePath) ?? {
        name: data.name,
        relativePath: data.relativePath,
        absolutePath: data.absolutePath ?? data.path,
        extension: data.extension,
        source: data.source,
      };
      await openEditView(file);
    }

    return { ok: true, data };
  } catch {
    return { ok: false, error: "Could not create entry" };
  } finally {
    setBusy(false);
  }
}

function getTargetRelativePath(parentPath, name) {
  const normalizedParent = String(parentPath).replace(/\\/g, "/").replace(/^\/+/, "");
  return normalizedParent ? `${normalizedParent}/${name}` : name;
}

function entryExistsAtPath(parentPath, name) {
  const targetPath = getTargetRelativePath(parentPath, name);

  if (scannedFiles.some((file) => file.relativePath.replace(/\\/g, "/") === targetPath)) {
    return { exists: true, type: "file" };
  }

  if (scannedDirectories.includes(targetPath)) {
    return { exists: true, type: "folder" };
  }

  return { exists: false };
}

function normalizeRelativePath(relativePath) {
  return String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "");
}

function isPathInsideDeletedEntry(filePath, deletedPath) {
  const normalizedFilePath = normalizeRelativePath(filePath);
  const normalizedDeletedPath = normalizeRelativePath(deletedPath);
  return (
    normalizedFilePath === normalizedDeletedPath ||
    normalizedFilePath.startsWith(`${normalizedDeletedPath}/`)
  );
}

function removeExpandedPathsUnder(deletedPath) {
  const normalizedDeletedPath = normalizeRelativePath(deletedPath);

  for (const expandedPath of [...expandedPaths]) {
    const normalizedExpandedPath = normalizeRelativePath(expandedPath);
    if (
      normalizedExpandedPath === normalizedDeletedPath ||
      normalizedExpandedPath.startsWith(`${normalizedDeletedPath}/`)
    ) {
      expandedPaths.delete(expandedPath);
    }
  }

  saveExpandedPaths();
}

async function deletePageFolder(entry) {
  if (!currentProjectPath) {
    return { ok: false, error: "Choose a project folder first" };
  }

  setBusy(true);
  clearError();

  try {
    for (const relativePath of [entry.relativePath, entry.pageFilePath]) {
      const response = await fetch("/api/entry", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: currentProjectPath,
          relativePath,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        return { ok: false, error: data.error ?? "Could not delete entry" };
      }
    }

    if (
      currentEditFile &&
      (isPathInsideDeletedEntry(currentEditFile.relativePath, entry.relativePath) ||
        isPathInsideDeletedEntry(currentEditFile.relativePath, entry.pageFilePath))
    ) {
      showListView();
    }

    removeExpandedPathsUnder(entry.relativePath);
    await refreshScan();
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not delete page folder" };
  } finally {
    setBusy(false);
  }
}

async function deleteEntry(relativePath) {
  if (!currentProjectPath) {
    return { ok: false, error: "Choose a project folder first" };
  }

  setBusy(true);
  clearError();

  try {
    const response = await fetch("/api/entry", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectPath: currentProjectPath,
        relativePath,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      return { ok: false, error: data.error ?? "Could not delete entry" };
    }

    if (
      currentEditFile &&
      isPathInsideDeletedEntry(currentEditFile.relativePath, relativePath)
    ) {
      showListView();
    }

    removeExpandedPathsUnder(relativePath);
    await refreshScan();
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Could not delete entry" };
  } finally {
    setBusy(false);
  }
}

function createConfirmDeleteDialog() {
  const dialog = document.createElement("dialog");
  dialog.id = "confirm-delete-dialog";
  dialog.className = "confirm-dialog";
  dialog.innerHTML = `
    <div class="dialog-header">
      <h2 class="confirm-delete-title">Delete file?</h2>
      <button type="button" class="dialog-close confirm-delete-dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="confirm-dialog-body">
      <p class="confirm-delete-message"></p>
      <p class="confirm-delete-error" hidden></p>
      <div class="confirm-dialog-actions">
        <button type="button" class="confirm-cancel">Cancel</button>
        <button type="button" class="destructive confirm-delete-submit">Delete</button>
      </div>
    </div>
  `;

  const titleEl = dialog.querySelector(".confirm-delete-title");
  const messageEl = dialog.querySelector(".confirm-delete-message");
  const errorEl = dialog.querySelector(".confirm-delete-error");
  const closeBtn = dialog.querySelector(".confirm-delete-dialog-close");
  const cancelBtn = dialog.querySelector(".confirm-cancel");
  const deleteBtn = dialog.querySelector(".confirm-delete-submit");
  let pendingEntry = null;

  function clearDialogError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function showDialogError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function setDialogBusy(isBusy) {
    deleteBtn.disabled = isBusy;
    cancelBtn.disabled = isBusy;
    closeBtn.disabled = isBusy;
    deleteBtn.textContent = isBusy ? "Deleting…" : "Delete";
  }

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
    pendingEntry = null;
    clearDialogError();
    setDialogBusy(false);
  });

  deleteBtn.addEventListener("click", async () => {
    if (!pendingEntry) {
      return;
    }

    clearDialogError();
    setDialogBusy(true);

    const result =
      pendingEntry.type === "page-folder"
        ? await deletePageFolder(pendingEntry)
        : await deleteEntry(pendingEntry.relativePath);
    if (!result.ok) {
      setDialogBusy(false);
      showDialogError(result.error);
      return;
    }

    dialog.close();
  });

  function openConfirmDeleteDialog(entry) {
    pendingEntry = entry;
    clearDialogError();

    if (entry.type === "folder") {
      titleEl.textContent = "Delete folder?";
      messageEl.textContent = `Delete "${entry.name}" and everything inside it? This cannot be undone.`;
    } else if (entry.type === "page-folder") {
      titleEl.textContent = "Delete page folder?";
      messageEl.textContent = `Delete "${entry.name}", its contents, and "${entry.pageFileName}"? This cannot be undone.`;
    } else {
      titleEl.textContent = "Delete file?";
      messageEl.textContent = `Delete "${entry.name}"? This cannot be undone.`;
    }

    dialog.showModal();
    cancelBtn.focus();
  }

  document.body.append(dialog);

  return { openConfirmDeleteDialog };
}

const { openConfirmDeleteDialog } = createConfirmDeleteDialog();

function createFrontmatterSourceDialog() {
  const dialog = document.createElement("dialog");
  dialog.id = "frontmatter-source-dialog";
  dialog.className = "frontmatter-source-dialog";
  dialog.innerHTML = `
    <div class="dialog-header">
      <h2>Import frontmatter from</h2>
      <button type="button" class="dialog-close frontmatter-source-dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="frontmatter-source-body">
      <p class="frontmatter-source-hint">Choose a markdown file to copy its frontmatter.</p>
      <p class="frontmatter-source-error" hidden></p>
      <ul class="frontmatter-source-tree file-tree"></ul>
    </div>
  `;

  const closeBtn = dialog.querySelector(".frontmatter-source-dialog-close");
  const treeRoot = dialog.querySelector(".frontmatter-source-tree");
  const errorEl = dialog.querySelector(".frontmatter-source-error");
  let onSelect = null;

  function clearDialogError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function showDialogError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function createPickerNewPageRow(name, depth) {
    const item = document.createElement("li");
    item.className = "tree-file frontmatter-source-file frontmatter-source-new-page";
    item.style.setProperty("--depth", depth);
    item.dataset.newPageTarget = "true";

    const badge = document.createElement("span");
    badge.className = "badge new-page";
    badge.innerHTML = `${icons.fileText}<span>new</span>`;

    const label = document.createElement("span");
    label.className = "file-name";
    label.textContent = name;

    const main = document.createElement("div");
    main.className = "tree-file-main";
    main.append(badge, label);
    item.append(main);

    return item;
  }

  function appendPickerChildren(container, node, depth, expandPaths, pickerContext) {
    for (const child of node.children) {
      container.append(createPickerRow(child, depth, expandPaths, pickerContext));
    }

    if (pickerContext.newPageName && node.path === pickerContext.parentPath) {
      container.append(createPickerNewPageRow(pickerContext.newPageName, depth));
    }
  }

  function createPickerFolderRow(node, depth, expandPaths, pickerContext) {
    const item = document.createElement("li");
    item.className = "tree-folder frontmatter-source-folder";
    item.style.setProperty("--depth", depth);

    const details = document.createElement("details");
    details.open = expandPaths.has(node.path);

    if (node.path === pickerContext.parentPath && !pickerContext.newPageName) {
      item.dataset.parentTarget = "true";
    }

    const summary = document.createElement("summary");
    summary.className = "tree-folder-header frontmatter-source-folder-header";

    const label = document.createElement("span");
    label.className = "tree-folder-name";
    label.textContent = depth === 0 ? (node.path || node.name) : node.name;

    if (depth > 0) {
      summary.append(
        createFolderMain(createFolderPrefix(createFolderBadge(), createFolderChevron()), label),
      );
    } else if (depth === 0 && node.source) {
      summary.append(
        createFolderMain(
          createFolderPrefix(createSourceBadge(node.source), createFolderChevron()),
          label,
        ),
      );
    } else {
      summary.append(createFolderMain(createFolderPrefix(createFolderChevron()), label));
    }

    details.append(summary);

    if (node.children.length > 0 || (pickerContext.newPageName && node.path === pickerContext.parentPath)) {
      const children = document.createElement("ul");
      children.className = "tree-children";
      appendPickerChildren(children, node, depth + 1, expandPaths, pickerContext);
      details.append(children);
    }

    item.append(details);
    return item;
  }

  function createPickerPageFolderRow(node, depth, expandPaths, pickerContext) {
    const { pageFile } = node;
    const item = document.createElement("li");
    item.className = "tree-folder tree-page-folder frontmatter-source-folder";
    item.style.setProperty("--depth", depth);

    const details = document.createElement("details");
    details.open = expandPaths.has(node.path);

    if (node.path === pickerContext.parentPath && !pickerContext.newPageName) {
      item.dataset.parentTarget = "true";
    }

    const summary = document.createElement("summary");
    summary.className = "tree-folder-header frontmatter-source-folder-header";

    const pageBadge = document.createElement("span");
    pageBadge.className = "badge page";
    pageBadge.innerHTML = `${icons.folder}<span>page folder</span>`;

    const label = document.createElement("span");
    label.className = "tree-folder-name";
    label.textContent = node.name;

    summary.append(
      createFolderMain(createFolderPrefix(pageBadge, createFolderChevron()), label),
    );

    details.append(summary);

    const children = document.createElement("ul");
    children.className = "tree-children";
    children.append(createPickerFileRow(
      {
        type: "file",
        name: pageFile.name,
        path: pageFile.relativePath,
        file: pageFile,
      },
      depth + 1,
    ));
    appendPickerChildren(children, node, depth + 1, expandPaths, pickerContext);
    details.append(children);

    item.append(details);
    return item;
  }

  function createPickerFileRow(node, depth) {
    const file = node.file;
    const item = document.createElement("li");
    item.className = "tree-file frontmatter-source-file";
    item.style.setProperty("--depth", depth);

    const extBadge = document.createElement("span");
    extBadge.className = `badge ${file.extension}`;
    extBadge.innerHTML = `${icons.fileText}<span>${file.extension}</span>`;

    const name = document.createElement("span");
    name.className = "file-name";
    name.textContent = file.name;
    name.title = file.relativePath;

    const main = document.createElement("div");
    main.className = "tree-file-main";
    main.append(extBadge, name);
    item.append(main);

    item.addEventListener("click", async () => {
      if (!onSelect) {
        return;
      }

      clearDialogError();

      try {
        const sourceFrontmatter = await fetchFileFrontmatter(file.absolutePath);
        const importedFrontmatter = prepareImportedFrontmatter(sourceFrontmatter);

        if (!importedFrontmatter) {
          showDialogError(`"${file.name}" has no frontmatter to import.`);
          return;
        }

        onSelect({
          file,
          frontmatter: importedFrontmatter,
        });
        dialog.close();
      } catch (error) {
        showDialogError(error.message ?? "Could not import frontmatter");
      }
    });

    return item;
  }

  function createPickerRow(node, depth, expandPaths, pickerContext) {
    if (node.type === "folder") {
      return createPickerFolderRow(node, depth, expandPaths, pickerContext);
    }

    if (node.type === "page-folder") {
      return createPickerPageFolderRow(node, depth, expandPaths, pickerContext);
    }

    return createPickerFileRow(node, depth);
  }

  function scrollPickerToTarget() {
    const target =
      treeRoot.querySelector("[data-new-page-target='true']") ??
      treeRoot.querySelector("[data-parent-target='true']");

    if (!target) {
      return;
    }

    target.scrollIntoView({ block: "center" });
  }

  function renderPickerTree(parentPath, newPageName = "") {
    treeRoot.replaceChildren();

    const expandPaths = getPathsToExpand(parentPath);
    const pickerContext = {
      parentPath: normalizeRelativePath(parentPath),
      newPageName: newPageName.trim(),
    };
    const markdownFiles = scannedFiles.filter((file) =>
      ["md", "mdx"].includes(file.extension),
    );
    const tree = buildFileTree(markdownFiles, {
      directories: scannedDirectories,
      scanTargets: lastScanTargets,
    });

    if (tree.length === 0) {
      const empty = document.createElement("li");
      empty.className = "frontmatter-source-empty";
      empty.textContent = "No markdown files found in this project.";
      treeRoot.append(empty);
      return;
    }

    for (const node of tree) {
      treeRoot.append(createPickerRow(node, 0, expandPaths, pickerContext));
    }
  }

  closeBtn.addEventListener("click", () => {
    dialog.close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  dialog.addEventListener("close", () => {
    onSelect = null;
    clearDialogError();
    treeRoot.replaceChildren();
  });

  function openFrontmatterSourceDialog({ parentPath, newPageName = "" }, selectHandler) {
    onSelect = selectHandler;
    clearDialogError();
    renderPickerTree(parentPath, newPageName);
    dialog.showModal();
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollPickerToTarget);
    });
  }

  document.body.append(dialog);

  return { openFrontmatterSourceDialog };
}

function createNewItemDialog({ openFrontmatterSourceDialog }) {
  const dialog = document.createElement("dialog");
  dialog.id = "new-item-dialog";
  dialog.className = "new-item-dialog";
  dialog.innerHTML = `
    <div class="dialog-header">
      <h2>New file or folder</h2>
      <button type="button" class="dialog-close new-item-dialog-close" aria-label="Close">&times;</button>
    </div>
    <form class="new-item-form">
      <div class="new-item-field">
        <label for="new-item-name">Name</label>
        <input
          id="new-item-name"
          type="text"
          autocomplete="off"
          spellcheck="false"
          placeholder="post.md or my-folder"
        />
        <p class="new-item-hint">.md / .mdx creates a file; anything else creates a folder.</p>
        <div class="new-item-frontmatter" hidden>
          <button type="button" class="new-item-import-frontmatter">Import frontmatter from file…</button>
          <p class="new-item-frontmatter-source" hidden></p>
        </div>
        <p class="new-item-error" hidden></p>
      </div>
      <div class="new-item-form-actions">
        <button type="submit" class="primary">Create</button>
      </div>
    </form>
  `;

  const closeBtn = dialog.querySelector(".new-item-dialog-close");
  const form = dialog.querySelector(".new-item-form");
  const nameInput = dialog.querySelector("#new-item-name");
  const frontmatterSection = dialog.querySelector(".new-item-frontmatter");
  const importFrontmatterBtn = dialog.querySelector(".new-item-import-frontmatter");
  const frontmatterSourceEl = dialog.querySelector(".new-item-frontmatter-source");
  const errorEl = dialog.querySelector(".new-item-error");
  let pendingParentPath = "";
  let pendingImportedFrontmatter = null;

  function clearDialogError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function showDialogError(message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function clearImportedFrontmatter() {
    pendingImportedFrontmatter = null;
    frontmatterSourceEl.hidden = true;
    frontmatterSourceEl.textContent = "";
  }

  function updateFrontmatterImportVisibility() {
    const showImport = isMarkdownEntryName(nameInput.value);
    frontmatterSection.hidden = !showImport;

    if (!showImport) {
      clearImportedFrontmatter();
    }
  }

  function setImportedFrontmatter(sourceName, frontmatter) {
    pendingImportedFrontmatter = frontmatter;
    frontmatterSourceEl.textContent = `Using frontmatter from ${sourceName}`;
    frontmatterSourceEl.hidden = false;
    clearDialogError();
  }

  closeBtn.addEventListener("click", () => {
    dialog.close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  dialog.addEventListener("close", () => {
    pendingParentPath = "";
    pendingImportedFrontmatter = null;
    form.reset();
    clearDialogError();
    clearImportedFrontmatter();
    frontmatterSection.hidden = true;
  });

  nameInput.addEventListener("input", () => {
    clearDialogError();
    updateFrontmatterImportVisibility();
  });

  importFrontmatterBtn.addEventListener("click", () => {
    openFrontmatterSourceDialog(
      {
        parentPath: pendingParentPath,
        newPageName: nameInput.value.trim(),
      },
      ({ file, frontmatter }) => {
        setImportedFrontmatter(file.name, frontmatter);
      },
    );
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      return;
    }

    clearDialogError();

    const result = await createEntry(pendingParentPath, name, {
      frontmatter: pendingImportedFrontmatter,
    });
    if (!result.ok) {
      showDialogError(result.error);
      nameInput.focus();
      nameInput.select();
      return;
    }

    dialog.close();
  });

  function openNewItemDialog(parentPath) {
    pendingParentPath = parentPath;
    clearImportedFrontmatter();
    clearDialogError();
    updateFrontmatterImportVisibility();
    dialog.showModal();
    nameInput.focus();
  }

  document.body.append(dialog);

  return { openNewItemDialog };
}

const { openFrontmatterSourceDialog } = createFrontmatterSourceDialog();
const { openNewItemDialog } = createNewItemDialog({ openFrontmatterSourceDialog });

browseBtn.addEventListener("click", browseFolder);
scanBtn.addEventListener("click", () => scanFolder());
collapseAllBtn.innerHTML = icons.collapseAll;
collapseAllBtn.addEventListener("click", collapseAllFolders);
fileSearch.addEventListener("input", updateFileResults);
folderInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    scanFolder();
  }
});

projectsMenuBtn.innerHTML = icons.switch;
topBarTitleIcon.innerHTML = icons.star;

projectsMenuBtn.addEventListener("click", () => {
  projectsDialog.showModal();
});

projectsDialogClose.addEventListener("click", () => {
  projectsDialog.close();
});

projectsDialog.addEventListener("click", (event) => {
  if (event.target === projectsDialog) {
    projectsDialog.close();
  }
});

settingsMenuBtn.innerHTML = icons.settings;

function syncSettingsForm(settings) {
  settingImagesSelect.value = settings.images;
  settingMediaDirInput.value = settings.mediaDir;
}

function updateSettingsProjectContext() {
  const hasProject = Boolean(currentProjectPath);
  settingsForm.classList.toggle("is-disabled", !hasProject);
  settingImagesSelect.disabled = !hasProject;
  settingMediaDirInput.disabled = !hasProject;

  if (!hasProject) {
    settingsProjectLabel.textContent = "Open a project to configure its settings.";
    return;
  }

  settingsProjectLabel.textContent = `Settings for ${getProjectLabel(currentProjectPath)}`;
}

async function mountActiveImageTool() {
  if (!imageToolMountContainer) {
    return;
  }

  for (const dialog of document.querySelectorAll('[id^="media-dialog-insert"]')) {
    dialog.remove();
  }

  imageToolMountContainer.replaceChildren();

  const toolId = getImageMode() === "markdown" ? "image-markdown" : "image-accelerator";
  const module = await import(`/tools/${toolId}.js`);
  module.default.mount(imageToolMountContainer, editorApi);
}

function showSettingsError(message) {
  settingsError.textContent = message;
  settingsError.hidden = false;
}

function clearSettingsError() {
  settingsError.textContent = "";
  settingsError.hidden = true;
}

settingsMenuBtn.addEventListener("click", async () => {
  if (currentProjectPath) {
    await loadSettings(currentProjectPath);
  }

  syncSettingsForm(getSettings());
  updateSettingsProjectContext();
  clearSettingsError();
  settingsDialog.showModal();
});

settingsDialogClose.addEventListener("click", () => {
  settingsDialog.close();
});

settingsDialog.addEventListener("click", (event) => {
  if (event.target === settingsDialog) {
    settingsDialog.close();
  }
});

settingImagesSelect.addEventListener("change", async () => {
  if (!currentProjectPath) {
    return;
  }

  clearSettingsError();

  try {
    await saveSettings({ images: settingImagesSelect.value }, currentProjectPath);
  } catch {
    syncSettingsForm(getSettings());
    showSettingsError("Could not save settings.");
  }
});

settingMediaDirInput.addEventListener("change", async () => {
  if (!currentProjectPath) {
    return;
  }

  clearSettingsError();

  try {
    await saveSettings({ mediaDir: settingMediaDirInput.value }, currentProjectPath);
    syncSettingsForm(getSettings());
  } catch {
    syncSettingsForm(getSettings());
    showSettingsError("Could not save settings.");
  }
});

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
});

const imageLightbox = createImageLightbox();

function createImageLightbox() {
  const dialog = document.createElement("dialog");
  dialog.id = "image-lightbox";
  dialog.className = "image-lightbox";
  dialog.innerHTML = `
    <button type="button" class="dialog-close image-lightbox-close" aria-label="Close">&times;</button>
    <figure class="image-lightbox-figure">
      <img class="image-lightbox-img" alt="" />
      <figcaption class="image-lightbox-caption"></figcaption>
    </figure>
  `;

  const closeBtn = dialog.querySelector(".image-lightbox-close");
  const image = dialog.querySelector(".image-lightbox-img");
  const caption = dialog.querySelector(".image-lightbox-caption");

  closeBtn.addEventListener("click", () => {
    dialog.close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  document.body.append(dialog);

  return {
    open(src, alt = "") {
      image.src = resolveEditorImageUrl(src);
      image.alt = alt;
      caption.textContent = alt;
      caption.hidden = !alt;
      dialog.showModal();
    },
  };
}

editBackBtn.insertAdjacentHTML("afterbegin", icons.chevronLeft);

try {
  markdownEditor.focus({ preventScroll: true });
  document.execCommand("defaultParagraphSeparator", false, "p");
  markdownEditor.blur();
} catch {
  // Browser may not support defaultParagraphSeparator.
}

editBackBtn.addEventListener("click", showListView);
editSaveBtn.addEventListener("click", saveCurrentFile);
markdownEditor.addEventListener("click", (event) => {
  const preview = event.target.closest(".editor-image-preview");
  if (!preview) {
    return;
  }

  event.preventDefault();
  imageLightbox.open(preview.dataset.src ?? "", preview.dataset.alt ?? "");
});
markdownEditor.addEventListener("mousedown", (event) => {
  if (event.target.closest(".editor-image-preview")) {
    event.preventDefault();
  }
});
markdownEditor.addEventListener("input", () => {
  reevaluateMarkdownEditorLines();
  scheduleEditorHistoryCommit();
});

markdownEditor.addEventListener("beforeinput", (event) => {
  if (event.inputType === "historyUndo") {
    event.preventDefault();
    undoEditorChange();
  } else if (event.inputType === "historyRedo") {
    event.preventDefault();
    redoEditorChange();
  }
});

markdownEditor.addEventListener("focus", () => {
  try {
    document.execCommand("defaultParagraphSeparator", false, "p");
  } catch {
    // Browser may not support defaultParagraphSeparator.
  }
});

markdownEditor.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    insertParagraphAtEditorCaret();
    return;
  }

  const isMod = event.metaKey || event.ctrlKey;
  if (!isMod) {
    return;
  }

  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    saveCurrentFile();
  } else if (key === "z" && !event.shiftKey) {
    event.preventDefault();
    undoEditorChange();
  } else if (key === "z" && event.shiftKey) {
    event.preventDefault();
    redoEditorChange();
  } else if (key === "y") {
    event.preventDefault();
    redoEditorChange();
  }
});

const editorApi = {
  editor: markdownEditor,
  getProjectPath: () => currentProjectPath,
  undo: undoEditorChange,
  redo: redoEditorChange,
  runHistoryAction: runEditorHistoryAction,
  wrapSelection: wrapEditorSelection,
  flushHistory: flushEditorHistory,
  reevaluateLines: reevaluateMarkdownEditorLines,
  focus: () => markdownEditor.focus(),
  saveCaret: saveEditorCaret,
  setPendingCaret: (caret) => {
    pendingEditorCaret = caret;
  },
  clearPendingCaret: () => {
    pendingEditorCaret = null;
  },
  insertAtCaret: insertMarkdownAtCaret,
  onHistoryChange(listener) {
    historyChangeListeners.push(listener);
    listener({
      canUndo: editorHistoryIndex > 0,
      canRedo: editorHistoryIndex < editorHistory.length - 1,
    });
  },
};

async function initToolbar() {
  const response = await fetch("/api/tools");
  const { tools } = await response.json();

  let currentGroup = null;
  let groupEl = null;

  for (const toolId of tools) {
    const module = await import(`/tools/${toolId}.js`);
    const tool = module.default;

    if (tool.group !== currentGroup) {
      if (currentGroup !== null) {
        const separator = document.createElement("div");
        separator.className = "toolbar-separator";
        separator.setAttribute("role", "separator");
        separator.setAttribute("aria-orientation", "vertical");
        editToolbar.append(separator);
      }

      currentGroup = tool.group;
      groupEl = document.createElement("div");
      groupEl.className = "toolbar-group";
      editToolbar.append(groupEl);
    }

    if (toolId === "image-accelerator" || toolId === "image-markdown") {
      if (!imageToolMountContainer) {
        imageToolMountContainer = document.createElement("div");
        imageToolMountContainer.className = "toolbar-image-tool";
        groupEl.append(imageToolMountContainer);
      }
      continue;
    }

    tool.mount(groupEl, editorApi);
  }

  await mountActiveImageTool();
}

onSettingsChange(() => {
  mountActiveImageTool();
});

initToolbar();

syncTopBarHeight();
window.addEventListener("resize", syncTopBarHeight);

async function resolveInitialProjectPath() {
  const projectFromUrl = getProjectFromUrl();
  if (projectFromUrl) {
    return projectFromUrl;
  }

  try {
    const response = await fetch("/api/config");
    const data = await response.json();

    if (response.ok && data.defaultProjectPath) {
      return data.defaultProjectPath;
    }
  } catch {
    // fall back to manual project selection
  }

  return null;
}

loadProjects().then(async () => {
  const projectPath = await resolveInitialProjectPath();
  const fileFromUrl = getFileFromUrl();

  if (projectPath) {
    await scanFolder(projectPath);

    if (fileFromUrl) {
      const file = scannedFiles.find((entry) => entry.absolutePath === fileFromUrl);
      if (file) {
        await openEditView(file);
      } else {
        setFileInUrl(null);
      }
    }
  }
});
