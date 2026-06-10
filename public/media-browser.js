import { attachDialogCloseGuard, makeGuardedAction, makeGuardedClose } from "./confirm-discard.js";
import { icons } from "./icons.js";

const IMAGE_UPLOAD_ACCEPT = ".png,.jpg,.jpeg,.gif,.webp,.svg,.avif,.ico,image/*";
const IMAGE_UPLOAD_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".avif",
  ".ico",
]);

export function createMediaDialog({
  getProjectPath,
  getInitialDir = () => "img",
  title = "Media",
  selectMode = "path",
  onSelect,
  onInsert,
  onOpen,
  onClose,
  dialogId = "media-dialog",
}) {
  let pendingImage = null;

  const dialog = document.createElement("dialog");
  dialog.id = dialogId;
  dialog.className = "media-dialog";
  dialog.innerHTML = `
    <div class="dialog-header">
      <h2></h2>
      <button type="button" class="dialog-close media-dialog-close" aria-label="Close">&times;</button>
    </div>
    <div class="media-browser">
      <div class="media-toolbar">
        <button type="button" class="media-up-btn" disabled aria-label="Go up one folder">
          ${icons.arrowUp}
          Up
        </button>
        <nav class="media-breadcrumb" aria-label="Media path"></nav>
      </div>
      <div class="media-search">
        <input
          type="search"
          class="media-search-input"
          placeholder="Search by file or folder name"
          autocomplete="off"
          spellcheck="false"
          aria-label="Search images by file or folder name"
        />
      </div>
      <p class="media-status" hidden></p>
      <div class="media-grid"></div>
    </div>
    <dialog class="media-add-folder-dialog">
      <form class="media-add-folder-form">
        <div class="dialog-header">
          <h2>add folder</h2>
          <button type="button" class="dialog-close media-add-folder-close" aria-label="Close">&times;</button>
        </div>
        <div class="link-field">
          <label for="${dialogId}-folder-name">Folder name</label>
          <input
            id="${dialogId}-folder-name"
            type="text"
            autocomplete="off"
            spellcheck="false"
            required
          />
        </div>
        <div class="link-form-actions">
          <button type="button" class="media-add-folder-cancel">Cancel</button>
          <button type="submit" class="primary">Create</button>
        </div>
      </form>
    </dialog>
    <form class="image-form" hidden aria-hidden="true">
      <p class="image-selected-name"></p>
      <div class="link-field">
        <label for="${dialogId}-image-alt">Alt text</label>
        <input id="${dialogId}-image-alt" type="text" autocomplete="off" spellcheck="true" />
      </div>
      <label class="image-checkbox-field" for="${dialogId}-image-lazy">
        <input id="${dialogId}-image-lazy" type="checkbox" checked />
        Lazy load
      </label>
      <div class="link-field">
        <label for="${dialogId}-image-caption">Caption</label>
        <input id="${dialogId}-image-caption" type="text" autocomplete="off" spellcheck="true" />
      </div>
      <div class="link-form-actions image-form-actions">
        <button type="button" class="image-back-btn">Back</button>
        <button type="submit" class="primary">Done</button>
      </div>
    </form>
  `;

  dialog.querySelector(".dialog-header h2").textContent = title;

  const closeBtn = dialog.querySelector(".media-dialog-close");
  const mediaUpBtn = dialog.querySelector(".media-up-btn");
  const mediaBreadcrumb = dialog.querySelector(".media-breadcrumb");
  const mediaSearchInput = dialog.querySelector(".media-search-input");
  const mediaStatus = dialog.querySelector(".media-status");
  const mediaGrid = dialog.querySelector(".media-grid");
  const mediaBrowserView = dialog.querySelector(".media-browser");
  const imageForm = dialog.querySelector(".image-form");
  const imageSelectedName = dialog.querySelector(".image-selected-name");
  const imageAltInput = dialog.querySelector(`#${dialogId}-image-alt`);
  const imageLazyInput = dialog.querySelector(`#${dialogId}-image-lazy`);
  const imageCaptionInput = dialog.querySelector(`#${dialogId}-image-caption`);
  const imageBackBtn = dialog.querySelector(".image-back-btn");
  const addFolderDialog = dialog.querySelector(".media-add-folder-dialog");
  const addFolderForm = dialog.querySelector(".media-add-folder-form");
  const addFolderNameInput = dialog.querySelector(`#${dialogId}-folder-name`);
  const addFolderCloseBtn = dialog.querySelector(".media-add-folder-close");
  const addFolderCancelBtn = dialog.querySelector(".media-add-folder-cancel");

  let currentMediaDir = getInitialDir();
  let isMediaUploading = false;
  let isMediaCreatingFolder = false;
  let imageFormSnapshot = null;
  let addFolderSnapshot = null;

  function formatMediaDirLabel(relativeDir) {
    return relativeDir ? relativeDir.replace(/\//g, " / ") : "public";
  }

  function getMediaFileUrl(relativePath) {
    return `/api/media/file?project=${encodeURIComponent(getProjectPath())}&path=${encodeURIComponent(relativePath)}`;
  }

  function getMediaSearchLabel(relativePath, searchRootDir) {
    const prefix = searchRootDir ? `${searchRootDir}/` : "";

    if (searchRootDir && relativePath.startsWith(prefix)) {
      return relativePath.slice(prefix.length);
    }

    return relativePath;
  }

  function getImageSearchLabel(image, searchRootDir) {
    const fullPath = image.dir ? `${image.dir}/${image.name}` : image.name;

    if (image.dir === searchRootDir) {
      return image.name;
    }

    return getMediaSearchLabel(fullPath, searchRootDir);
  }

  function getFolderSearchLabel(folder, searchRootDir) {
    if (folder.dir === searchRootDir) {
      return folder.name;
    }

    return getMediaSearchLabel(folder.dir, searchRootDir);
  }

  function navigateToMediaDirectory(relativeDir) {
    mediaSearchInput.value = "";
    loadMediaDirectory(relativeDir);
  }

  function isImageUploadFile(file) {
    const dotIndex = file.name.lastIndexOf(".");
    if (dotIndex === -1) {
      return false;
    }

    const extension = file.name.slice(dotIndex).toLowerCase();
    return IMAGE_UPLOAD_EXTENSIONS.has(extension);
  }

  function canAcceptMediaDrop(event) {
    if (!imageForm.hidden) {
      return false;
    }

    if (isMediaUploading) {
      return false;
    }

    if (mediaSearchInput.value.trim()) {
      return false;
    }

    if (!getProjectPath()) {
      return false;
    }

    const types = event.dataTransfer?.types;
    return Boolean(types && Array.from(types).includes("Files"));
  }

  async function postImageUpload(file) {
    const params = new URLSearchParams({
      project: getProjectPath(),
      dir: currentMediaDir,
      filename: file.name,
    });
    const response = await fetch(`/api/media/upload?${params.toString()}`, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });
    const data = await response.json();

    return {
      ok: response.ok,
      error: data.error ?? "Could not upload image",
    };
  }

  async function uploadImageFiles(files) {
    const imageFiles = files.filter(isImageUploadFile);

    if (imageFiles.length === 0) {
      setMediaStatus("Only image files are supported.", { isError: true });
      return;
    }

    if (mediaSearchInput.value.trim()) {
      setMediaStatus("Clear the search to upload an image.", { isError: true });
      return;
    }

    isMediaUploading = true;
    setMediaStatus(imageFiles.length > 1 ? `Uploading ${imageFiles.length} images…` : "Uploading…");

    try {
      for (const file of imageFiles) {
        const result = await postImageUpload(file);

        if (!result.ok) {
          setMediaStatus(result.error, { isError: true });
          return;
        }
      }

      await loadMediaDirectory(currentMediaDir);
    } catch {
      setMediaStatus("Could not upload image", { isError: true });
    } finally {
      isMediaUploading = false;
    }
  }

  function createMediaAddItem() {
    const label = document.createElement("label");
    label.className = "media-item-btn media-add-btn";

    const input = document.createElement("input");
    input.type = "file";
    input.className = "media-upload-input";
    input.accept = IMAGE_UPLOAD_ACCEPT;
    input.disabled = isMediaUploading;

    const preview = document.createElement("span");
    preview.className = "media-item-preview media-add-preview";
    preview.innerHTML = icons.plus;
    preview.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "media-item-name";
    name.textContent = "upload image";

    label.append(input, preview, name);
    label.title = "upload image";

    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";

      if (!file) {
        return;
      }

      input.disabled = true;

      try {
        await uploadImageFiles([file]);
      } finally {
        input.disabled = isMediaUploading;
      }
    });

    return label;
  }

  function openAddFolderDialog() {
    addFolderForm.reset();
    addFolderSnapshot = addFolderNameInput.value;
    addFolderDialog.showModal();
    addFolderNameInput.focus();
  }

  function isAddFolderDirty() {
    return addFolderNameInput.value !== addFolderSnapshot;
  }

  function createMediaAddFolderItem() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "media-item-btn media-add-btn media-add-folder-btn";
    button.disabled = isMediaCreatingFolder;

    const preview = document.createElement("span");
    preview.className = "media-item-preview media-add-preview";
    preview.innerHTML = icons.folder;
    preview.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "media-item-name";
    name.textContent = "add folder";

    button.append(preview, name);
    button.title = "add folder";
    button.addEventListener("click", () => {
      openAddFolderDialog();
    });

    return button;
  }

  async function createMediaFolder(folderName) {
    isMediaCreatingFolder = true;
    setMediaStatus("Creating folder…");

    try {
      const params = new URLSearchParams({
        project: getProjectPath(),
        dir: currentMediaDir,
        name: folderName,
      });
      const response = await fetch(`/api/media/folder?${params.toString()}`, {
        method: "POST",
      });
      const data = await response.json();

      if (!response.ok) {
        setMediaStatus(data.error ?? "Could not create folder", { isError: true });
        return false;
      }

      addFolderDialog.close();
      await loadMediaDirectory(currentMediaDir);
      return true;
    } catch {
      setMediaStatus("Could not create folder", { isError: true });
      return false;
    } finally {
      isMediaCreatingFolder = false;
    }
  }

  function setMediaStatus(message, { isError = false } = {}) {
    mediaStatus.hidden = !message;
    mediaStatus.textContent = message ?? "";
    mediaStatus.classList.toggle("is-error", Boolean(isError && message));
  }

  function renderMediaBreadcrumb(currentDir) {
    mediaBreadcrumb.replaceChildren();

    const segments = currentDir ? currentDir.split("/") : [];
    const crumbs = [{ label: "public", dir: "" }];

    for (let index = 0; index < segments.length; index += 1) {
      crumbs.push({
        label: segments[index],
        dir: segments.slice(0, index + 1).join("/"),
      });
    }

    crumbs.forEach((crumb, index) => {
      if (index > 0) {
        const separator = document.createElement("span");
        separator.className = "media-breadcrumb-separator";
        separator.textContent = "/";
        separator.setAttribute("aria-hidden", "true");
        mediaBreadcrumb.append(separator);
      }

      const button = document.createElement("button");
      button.type = "button";
      button.textContent = crumb.label;
      button.addEventListener("click", () => {
        navigateToMediaDirectory(crumb.dir);
      });
      mediaBreadcrumb.append(button);
    });
  }

  function captureImageFormSnapshot() {
    return {
      alt: imageAltInput.value,
      lazyLoad: imageLazyInput.checked,
      caption: imageCaptionInput.value,
    };
  }

  function isImageFormDirty() {
    if (!imageFormSnapshot) {
      return false;
    }

    const current = captureImageFormSnapshot();
    return (
      current.alt !== imageFormSnapshot.alt ||
      current.lazyLoad !== imageFormSnapshot.lazyLoad ||
      current.caption !== imageFormSnapshot.caption
    );
  }

  function showMediaBrowserView() {
    pendingImage = null;
    imageFormSnapshot = null;
    mediaBrowserView.hidden = false;
    mediaBrowserView.setAttribute("aria-hidden", "false");
    imageForm.hidden = true;
    imageForm.setAttribute("aria-hidden", "true");
  }

  function showMediaDetailsView(image) {
    pendingImage = image;
    imageSelectedName.textContent = image.name;
    imageAltInput.value = filenameToAlt(image.name);
    imageLazyInput.checked = true;
    imageCaptionInput.value = "";
    imageFormSnapshot = captureImageFormSnapshot();
    mediaBrowserView.hidden = true;
    mediaBrowserView.setAttribute("aria-hidden", "true");
    imageForm.hidden = false;
    imageForm.setAttribute("aria-hidden", "false");
    imageAltInput.focus();
  }

  function handleImageSelection(image) {
    if (selectMode === "path") {
      onSelect?.(image);
      dialog.close();
      return;
    }

    showMediaDetailsView(image);
  }

  function renderMediaDirectory(data) {
    const isSearching = Boolean(data.searchQuery);

    mediaUpBtn.disabled = data.parentDir === null;
    mediaUpBtn.onclick = () => {
      if (data.parentDir !== null) {
        navigateToMediaDirectory(data.parentDir === "" ? "" : data.parentDir);
      }
    };

    renderMediaBreadcrumb(data.currentDir);
    mediaGrid.replaceChildren();

    for (const folder of data.folders) {
      const displayName = isSearching
        ? getFolderSearchLabel(folder, data.currentDir)
        : folder.name;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "media-item-btn media-folder-btn";
      button.title = displayName;

      const preview = document.createElement("span");
      preview.className = "media-item-preview media-folder-preview";
      preview.innerHTML = icons.folder;
      preview.setAttribute("aria-hidden", "true");

      const label = document.createElement("span");
      label.className = "media-item-name";
      label.textContent = displayName;

      button.append(preview, label);
      button.addEventListener("click", () => {
        navigateToMediaDirectory(folder.dir);
      });
      mediaGrid.append(button);
    }

    if (!isSearching) {
      mediaGrid.append(createMediaAddFolderItem(), createMediaAddItem());
    }

    for (const image of data.images) {
      const projectRelativePath = image.dir ? `${image.dir}/${image.name}` : image.name;
      const displayName = isSearching
        ? getImageSearchLabel(image, data.currentDir)
        : image.name;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "media-item-btn media-image-btn";
      button.title = displayName;

      const preview = document.createElement("img");
      preview.className = "media-item-preview media-image-preview";
      preview.src = getMediaFileUrl(projectRelativePath);
      preview.alt = "";
      preview.loading = "lazy";

      const label = document.createElement("span");
      label.className = "media-item-name";
      label.textContent = displayName;

      button.append(preview, label);
      button.addEventListener("click", () => {
        handleImageSelection(image);
      });

      mediaGrid.append(button);
    }

    if (data.folders.length === 0 && data.images.length === 0) {
      if (isSearching) {
        setMediaStatus(
          `No files or folders matching "${data.searchQuery}" in ${formatMediaDirLabel(data.currentDir)}.`,
        );
      } else {
        setMediaStatus("");
      }
    } else {
      setMediaStatus("");
    }
  }

  async function loadMediaDirectory(relativeDir = currentMediaDir) {
    currentMediaDir = relativeDir;
    const searchQuery = mediaSearchInput.value.trim();

    if (!getProjectPath()) {
      setMediaStatus("Open and scan a project first.", { isError: true });
      mediaGrid.replaceChildren();
      mediaUpBtn.disabled = true;
      mediaBreadcrumb.replaceChildren();
      return;
    }

    setMediaStatus(searchQuery ? "Searching…" : "Loading…");

    try {
      const params = new URLSearchParams({
        project: getProjectPath(),
        dir: relativeDir,
      });

      if (searchQuery) {
        params.set("q", searchQuery);
      }

      const response = await fetch(`/api/media?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        setMediaStatus(data.error ?? "Could not load media", { isError: true });
        mediaGrid.replaceChildren();
        mediaUpBtn.disabled = true;
        mediaBreadcrumb.replaceChildren();
        return;
      }

      renderMediaDirectory(data);
    } catch {
      setMediaStatus("Could not load media", { isError: true });
      mediaGrid.replaceChildren();
      mediaUpBtn.disabled = true;
      mediaBreadcrumb.replaceChildren();
    }
  }

  function openMediaDialog() {
    onOpen?.();
    showMediaBrowserView();
    mediaSearchInput.value = "";
    const initialDir = getInitialDir();
    currentMediaDir = initialDir;
    dialog.showModal();
    loadMediaDirectory(initialDir);
  }

  attachDialogCloseGuard(dialog, closeBtn, () => !imageForm.hidden && isImageFormDirty());

  dialog.addEventListener("close", () => {
    onClose?.();
    showMediaBrowserView();
    clearMediaDropState();
  });

  imageForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!pendingImage) {
      return;
    }

    const handled = onInsert?.(pendingImage, {
      alt: imageAltInput.value,
      lazyLoad: imageLazyInput.checked,
      caption: imageCaptionInput.value,
    });

    if (handled !== false) {
      dialog.close();
    }
  });

  imageBackBtn.addEventListener(
    "click",
    makeGuardedAction(() => isImageFormDirty(), showMediaBrowserView),
  );

  attachDialogCloseGuard(addFolderDialog, addFolderCloseBtn, isAddFolderDirty);
  addFolderCancelBtn.addEventListener("click", makeGuardedClose(addFolderDialog, isAddFolderDirty));

  addFolderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const folderName = addFolderNameInput.value.trim();

    if (!folderName) {
      setMediaStatus("A folder name is required", { isError: true });
      return;
    }

    await createMediaFolder(folderName);
  });

  mediaSearchInput.addEventListener("input", () => {
    loadMediaDirectory(currentMediaDir);
  });

  imageAltInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      imageCaptionInput.focus();
    }
  });

  function clearMediaDropState() {
    mediaBrowserView.classList.remove("media-browser-drag-over");
  }

  mediaBrowserView.addEventListener("dragenter", (event) => {
    if (!canAcceptMediaDrop(event)) {
      return;
    }

    event.preventDefault();
    mediaBrowserView.classList.add("media-browser-drag-over");
  });

  mediaBrowserView.addEventListener("dragover", (event) => {
    if (!canAcceptMediaDrop(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });

  mediaBrowserView.addEventListener("dragleave", (event) => {
    if (mediaBrowserView.contains(event.relatedTarget)) {
      return;
    }

    clearMediaDropState();
  });

  mediaBrowserView.addEventListener("drop", async (event) => {
    clearMediaDropState();

    if (!canAcceptMediaDrop(event)) {
      return;
    }

    event.preventDefault();
    await uploadImageFiles(Array.from(event.dataTransfer.files ?? []));
  });

  return { dialog, openMediaDialog };
}

function filenameToAlt(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
