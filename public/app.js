const folderInput = document.getElementById("folder-path");
const browseBtn = document.getElementById("browse-btn");
const scanBtn = document.getElementById("scan-btn");
const scanInfo = document.getElementById("scan-info");
const fileCount = document.getElementById("file-count");
const emptyState = document.getElementById("empty-state");
const searchBox = document.getElementById("search-box");
const fileSearch = document.getElementById("file-search");
const fileList = document.getElementById("file-list");
const listView = document.getElementById("list-view");
const editView = document.getElementById("edit-view");
const editBackBtn = document.getElementById("edit-back-btn");
const editFileName = document.getElementById("edit-file-name");
const editFilePath = document.getElementById("edit-file-path");
const markdownEditor = document.getElementById("markdown-editor");
const projectsSection = document.getElementById("projects-section");
const projectList = document.getElementById("project-list");
const projectsMenuBtn = document.getElementById("projects-menu-btn");
const projectsDialog = document.getElementById("projects-dialog");
const projectsDialogClose = document.getElementById("projects-dialog-close");

let projectButtons = [];
let scannedFiles = [];
let currentProjectPath = "";
let expandedPaths = new Set();
let currentEditFile = null;
let currentEditFrontmatter = null;

const SOURCE_ROOTS = {
  content: "src/content",
  pages: "src/pages",
};

const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
  <path fill="currentColor" d="M11.5 1.5a1.4 1.4 0 0 1 2 2L5.7 11.3l-2.8.7.7-2.8zM10.5 2.5 3 10v1h1l7.5-7.5z"/>
</svg>`;

const HEADING_LINE_RE = /^(#{1,6})\s+(.*)$/;
const CODE_FENCE_RE = /^```/;
const CODE_FENCE_CLOSE_RE = /^```\s*$/;
const EDITOR_LINE_SELECTOR = "p, h1, h2, h3, h4, h5, h6";

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

function getLineElementTagName(line, inCodeBlock = false) {
  if (inCodeBlock) {
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

function createEditorLineElement(line, inCodeBlock = false) {
  const tagName = getLineElementTagName(line, inCodeBlock);

  if (tagName !== "p") {
    const element = document.createElement(tagName);
    element.textContent = line;
    return element;
  }

  const paragraph = document.createElement("p");
  if (line.length === 0) {
    paragraph.append(document.createElement("br"));
  } else {
    paragraph.textContent = line;
  }

  if (inCodeBlock) {
    paragraph.classList.add("is-code-block");
  }

  return paragraph;
}

function reevaluateEditorLine(element, inCodeBlock = false) {
  const line = getEditorLineText(element);
  const expectedTag = getLineElementTagName(line, inCodeBlock);
  const tagMatches = element.tagName.toLowerCase() === expectedTag;
  const classMatches = element.classList.contains("is-code-block") === inCodeBlock;

  if (tagMatches && classMatches) {
    return element;
  }

  if (tagMatches) {
    element.classList.toggle("is-code-block", inCodeBlock);
    return element;
  }

  const caretOffset = getCaretOffsetInElement(element);
  const nextElement = createEditorLineElement(line, inCodeBlock);
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

  const lineElements = [...markdownEditor.children].filter((child) =>
    child.matches(EDITOR_LINE_SELECTOR),
  );
  const lines = lineElements.map(getEditorLineText);
  const codeBlockStates = getCodeBlockStates(lines);

  lineElements.forEach((child, index) => {
    reevaluateEditorLine(child, codeBlockStates[index]);
  });

  markdownEditor.classList.toggle("is-empty", markdownEditor.childElementCount === 0);
}

function renderMarkdownEditor(content) {
  markdownEditor.replaceChildren();

  const lines = content.split(/\r?\n/);
  const codeBlockStates = getCodeBlockStates(lines);

  for (let index = 0; index < lines.length; index += 1) {
    markdownEditor.append(createEditorLineElement(lines[index], codeBlockStates[index]));
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

  if (!projectPath) {
    return;
  }

  try {
    const stored = localStorage.getItem(`starmark:expanded:${projectPath}`);
    if (stored) {
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
  if (expandedPaths.size > 0) {
    return;
  }

  for (const node of tree) {
    if (node.type === "folder") {
      expandedPaths.add(node.path);
    }
  }
}

function collectFolderPaths(nodes, paths = []) {
  for (const node of nodes) {
    if (node.type !== "folder") {
      continue;
    }

    paths.push(node.path);

    if (node.children.length > 0) {
      collectFolderPaths(node.children, paths);
    }
  }

  return paths;
}

function countTreeContents(nodes) {
  let folders = 0;
  let files = 0;

  for (const node of nodes) {
    if (node.type === "folder") {
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

function buildFileTree(files) {
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

  function folderMapToNodes(folderMap) {
    const folders = [...folderMap.values()].sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    return folders.map((folder) => ({
      type: "folder",
      name: folder.name,
      path: folder.path,
      source: folder.source,
      children: [
        ...folderMapToNodes(folder.childFolders),
        ...folder.files.sort((a, b) => a.name.localeCompare(b.name)),
      ],
    }));
  }

  for (const file of files) {
    let rootPath;
    let segments;

    if (file.source === "content" || file.source === "pages") {
      rootPath = SOURCE_ROOTS[file.source];
      const prefix = `${rootPath}/`;
      const remainder = file.relativePath.startsWith(prefix)
        ? file.relativePath.slice(prefix.length)
        : file.relativePath.replace(/^src\/(content|pages)\/?/, "");
      segments = remainder.split("/").filter(Boolean);
    } else {
      segments = file.relativePath.split("/").filter(Boolean);
      rootPath = "";
    }

    const rootLabel = rootPath || "project";
    const root = ensureFolder(roots, rootPath || "__project__", rootLabel, file.source);
    let current = root;
    let currentPath = rootPath;

    if (segments.length === 0) {
      continue;
    }

    if (segments.length === 1) {
      root.files.push({
        type: "file",
        name: segments[0],
        path: file.relativePath,
        file,
      });
      continue;
    }

    for (let index = 0; index < segments.length - 1; index += 1) {
      currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];
      current = ensureFolder(
        current.childFolders,
        currentPath,
        segments[index],
        file.source,
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
      children: [
        ...folderMapToNodes(root.childFolders),
        ...root.files.sort((a, b) => a.name.localeCompare(b.name)),
      ],
    }));
}

function updateFileResults() {
  const query = fileSearch.value.trim();
  const filteredFiles = filterFiles(scannedFiles, query);
  const isSearching = query.length > 0;

  fileCount.textContent = formatFileCount(filteredFiles.length, scannedFiles.length);

  if (filteredFiles.length === 0) {
    emptyState.hidden = false;
    emptyState.textContent = isSearching
      ? "No files match your search."
      : "No .md or .mdx files found in this folder.";
    fileList.hidden = true;
    fileList.innerHTML = "";
    return;
  }

  const tree = buildFileTree(filteredFiles);

  if (!isSearching) {
    ensureDefaultExpandedRoots(tree);
  } else {
    for (const folderPath of collectFolderPaths(tree)) {
      expandedPaths.add(folderPath);
    }
  }

  emptyState.hidden = true;
  fileList.hidden = false;
  renderFileTree(tree, { isSearching });
}

function getProjectFromUrl() {
  return new URLSearchParams(window.location.search).get("project");
}

function getFileFromUrl() {
  return new URLSearchParams(window.location.search).get("file");
}

function setProjectInUrl(projectPath) {
  const url = new URL(window.location.href);
  url.searchParams.set("project", projectPath);
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

function showListView() {
  listView.hidden = false;
  editView.hidden = true;
  currentEditFile = null;
  currentEditFrontmatter = null;
  setFileInUrl(null);
}

function showEditView() {
  listView.hidden = true;
  editView.hidden = false;
}

async function openEditView(file) {
  currentEditFile = file;
  setFileInUrl(file.absolutePath);
  showEditView();

  editFileName.textContent = file.name;
  editFilePath.textContent = file.relativePath;
  editFilePath.title = file.absolutePath;
  renderMarkdownEditor("");
  markdownEditor.dataset.loading = "true";

  try {
    const response = await fetch(`/api/file?path=${encodeURIComponent(file.absolutePath)}`);
    const data = await response.json();

    if (!response.ok) {
      setMarkdownEditorMessage(data.error ?? "Could not load file");
      return;
    }

    if (currentEditFile?.absolutePath !== file.absolutePath) {
      return;
    }

    currentEditFrontmatter = data.frontmatter ?? null;
    renderMarkdownEditor(data.content);
  } catch {
    if (currentEditFile?.absolutePath === file.absolutePath) {
      setMarkdownEditorMessage("Could not load file");
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

    projectButtons.push(button);
    item.append(button);
    projectList.append(item);
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

function createFileRow(file, depth) {
  const item = document.createElement("li");
  item.className = "tree-file";
  item.style.setProperty("--depth", depth);

  const extBadge = document.createElement("span");
  extBadge.className = `badge ${file.extension}`;
  extBadge.textContent = file.extension;

  const name = document.createElement("span");
  name.className = "file-name";
  name.textContent = file.name;
  name.title = file.relativePath;

  const actions = document.createElement("div");
  actions.className = "file-actions";

  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "edit-btn";
  editBtn.innerHTML = EDIT_ICON;
  editBtn.title = `Edit ${file.name}`;
  editBtn.setAttribute("aria-label", `Edit ${file.name}`);
  editBtn.addEventListener("click", () => openEditView(file));

  actions.append(editBtn);
  item.append(extBadge, name, actions);
  return item;
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
  summary.append(label);

  if (depth === 0 && node.source) {
    const sourceBadge = document.createElement("span");
    sourceBadge.className = `badge source ${node.source}`;
    sourceBadge.textContent = node.source;
    summary.append(sourceBadge);
  }

  const { folders: folderCount, files: nestedFileCount } = countTreeContents(node.children);
  const countParts = [];

  if (folderCount > 0) {
    countParts.push(folderCount === 1 ? "1 folder" : `${folderCount} folders`);
  }

  if (nestedFileCount > 0) {
    countParts.push(nestedFileCount === 1 ? "1 file" : `${nestedFileCount} files`);
  }

  if (countParts.length > 0) {
    const count = document.createElement("span");
    count.className = "tree-folder-count";
    count.textContent = countParts.join(", ");
    summary.append(count);
  }

  details.append(summary);

  if (node.children.length > 0) {
    const children = document.createElement("ul");
    children.className = "tree-children";

    for (const child of node.children) {
      if (child.type === "folder") {
        children.append(createFolderRow(child, depth + 1, { isSearching }));
      } else {
        children.append(createFileRow(child.file, depth + 1));
      }
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
      return;
    }

    folderInput.value = data.projectPath;
    currentProjectPath = data.projectPath;
    setProjectInUrl(data.projectPath);
    loadExpandedPaths(currentProjectPath);

    scanInfo.hidden = false;
    scanInfo.textContent = formatScanInfo(data.scanTargets);

    scannedFiles = data.files;
    fileSearch.value = "";
    searchBox.hidden = scannedFiles.length === 0;

    if (scannedFiles.length === 0) {
      fileCount.textContent = formatFileCount(0);
      emptyState.hidden = false;
      emptyState.textContent = "No .md or .mdx files found in this folder.";
      fileList.hidden = true;
      fileList.innerHTML = "";
      await loadProjects();
      projectsDialog.close();
      return;
    }

    updateFileResults();
    await loadProjects();
    projectsDialog.close();
  } catch {
    showError("Could not scan folder");
  } finally {
    setBusy(false);
  }
}

browseBtn.addEventListener("click", browseFolder);
scanBtn.addEventListener("click", () => scanFolder());
fileSearch.addEventListener("input", updateFileResults);
folderInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    scanFolder();
  }
});

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

editBackBtn.addEventListener("click", showListView);
markdownEditor.addEventListener("input", reevaluateMarkdownEditorLines);

loadProjects().then(async () => {
  const projectFromUrl = getProjectFromUrl();
  const fileFromUrl = getFileFromUrl();

  if (projectFromUrl) {
    await scanFolder(projectFromUrl);

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
