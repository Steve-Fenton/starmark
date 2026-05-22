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
let currentEditFile = null;
let currentEditFrontmatter = null;

const EDIT_ICON = `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
  <path fill="currentColor" d="M11.5 1.5a1.4 1.4 0 0 1 2 2L5.7 11.3l-2.8.7.7-2.8zM10.5 2.5 3 10v1h1l7.5-7.5z"/>
</svg>`;

const HEADING_LINE_RE = /^(#{1,6})\s+(.*)$/;

function createEditorLineElement(line) {
  const headingMatch = line.match(HEADING_LINE_RE);

  if (headingMatch) {
    const element = document.createElement(`h${headingMatch[1].length}`);
    element.textContent = line;
    return element;
  }

  const paragraph = document.createElement("p");
  if (line.length === 0) {
    paragraph.append(document.createElement("br"));
  } else {
    paragraph.textContent = line;
  }

  return paragraph;
}

function renderMarkdownEditor(content) {
  markdownEditor.replaceChildren();

  for (const line of content.split(/\r?\n/)) {
    markdownEditor.append(createEditorLineElement(line));
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

function updateFileResults() {
  const query = fileSearch.value;
  const filteredFiles = filterFiles(scannedFiles, query);

  fileCount.textContent = formatFileCount(filteredFiles.length, scannedFiles.length);

  if (filteredFiles.length === 0) {
    emptyState.hidden = false;
    emptyState.textContent = query.trim()
      ? "No files match your search."
      : "No .md or .mdx files found in this folder.";
    fileList.hidden = true;
    fileList.innerHTML = "";
    return;
  }

  emptyState.hidden = true;
  fileList.hidden = false;
  renderFiles(filteredFiles);
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

function renderFiles(files) {
  fileList.innerHTML = "";

  for (const file of files) {
    const item = document.createElement("li");

    const badges = document.createElement("div");
    badges.className = "badges";

    const sourceBadge = document.createElement("span");
    sourceBadge.className = `badge source ${file.source}`;
    sourceBadge.textContent = file.source;

    const extBadge = document.createElement("span");
    extBadge.className = `badge ${file.extension}`;
    extBadge.textContent = file.extension;

    badges.append(sourceBadge, extBadge);

    const meta = document.createElement("div");
    meta.className = "file-meta";

    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = file.name;

    const relativePath = document.createElement("div");
    relativePath.className = "file-path";
    relativePath.textContent = file.relativePath;
    relativePath.title = file.absolutePath;

    meta.append(name, relativePath);
    item.append(badges, meta);

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
    item.append(actions);
    fileList.append(item);
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
    setProjectInUrl(data.projectPath);

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
