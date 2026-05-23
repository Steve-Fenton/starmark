import { attachToolbarButton, createToolbarButton } from "../toolkit.js";
import { icons } from "../icons.js";

let pendingImage = null;

function escapeMarkdownAttribute(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function filenameToAlt(filename) {
  const base = filename.replace(/\.[^.]+$/, "");
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildFigureMarkdown(webPath, { alt, lazyLoad, caption }) {
  const safeAlt = escapeMarkdownAttribute(alt);
  const attributes = [`src="${webPath}"`, `alt="${safeAlt}"`];

  if (lazyLoad) {
    attributes.push('loading="lazy"');
  }

  const lines = [":::figure", "", `:img{ ${attributes.join(" ")} }`, ""];

  const trimmedCaption = caption.trim();
  if (trimmedCaption) {
    lines.push(`::figcaption[${trimmedCaption}]`, "");
  }

  lines.push(":::");
  return lines.join("\n");
}

function createMediaDialog(api) {
  const dialog = document.createElement("dialog");
  dialog.id = "media-dialog";
  dialog.className = "media-dialog";
  dialog.innerHTML = `
    <div class="dialog-header">
      <h2>Insert image</h2>
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
      <p class="media-status" hidden></p>
      <div class="media-contents">
        <ul class="media-folders"></ul>
        <div class="media-images"></div>
      </div>
    </div>
    <form class="image-form" hidden aria-hidden="true">
      <p class="image-selected-name"></p>
      <div class="link-field">
        <label for="image-alt">Alt text</label>
        <input id="image-alt" type="text" autocomplete="off" spellcheck="true" />
      </div>
      <label class="image-checkbox-field" for="image-lazy">
        <input id="image-lazy" type="checkbox" checked />
        Lazy load
      </label>
      <div class="link-field">
        <label for="image-caption">Caption</label>
        <input id="image-caption" type="text" autocomplete="off" spellcheck="true" />
      </div>
      <div class="link-form-actions image-form-actions">
        <button type="button" class="image-back-btn">Back</button>
        <button type="submit" class="primary">Done</button>
      </div>
    </form>
  `;

  const closeBtn = dialog.querySelector(".media-dialog-close");
  const mediaUpBtn = dialog.querySelector(".media-up-btn");
  const mediaBreadcrumb = dialog.querySelector(".media-breadcrumb");
  const mediaStatus = dialog.querySelector(".media-status");
  const mediaFolders = dialog.querySelector(".media-folders");
  const mediaImages = dialog.querySelector(".media-images");
  const mediaBrowserView = dialog.querySelector(".media-browser");
  const imageForm = dialog.querySelector(".image-form");
  const imageSelectedName = dialog.querySelector(".image-selected-name");
  const imageAltInput = dialog.querySelector("#image-alt");
  const imageLazyInput = dialog.querySelector("#image-lazy");
  const imageCaptionInput = dialog.querySelector("#image-caption");
  const imageBackBtn = dialog.querySelector(".image-back-btn");

  function formatMediaDirLabel(relativeDir) {
    return relativeDir ? relativeDir.replace(/\//g, " / ") : "public";
  }

  function getMediaFileUrl(relativePath) {
    return `/api/media/file?project=${encodeURIComponent(api.getProjectPath())}&path=${encodeURIComponent(relativePath)}`;
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
        loadMediaDirectory(crumb.dir);
      });
      mediaBreadcrumb.append(button);
    });
  }

  function showMediaBrowserView() {
    pendingImage = null;
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
    mediaBrowserView.hidden = true;
    mediaBrowserView.setAttribute("aria-hidden", "true");
    imageForm.hidden = false;
    imageForm.setAttribute("aria-hidden", "false");
    imageAltInput.focus();
  }

  function renderMediaDirectory(data) {
    mediaUpBtn.disabled = data.parentDir === null;
    mediaUpBtn.onclick = () => {
      if (data.parentDir !== null) {
        loadMediaDirectory(data.parentDir === "" ? "" : data.parentDir);
      }
    };

    renderMediaBreadcrumb(data.currentDir);
    mediaFolders.replaceChildren();
    mediaImages.replaceChildren();

    for (const folder of data.folders) {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "media-folder-btn";
      button.innerHTML = `<span class="media-folder-icon">${icons.folder}</span><span>${folder.name}</span>`;
      button.addEventListener("click", () => {
        loadMediaDirectory(folder.dir);
      });
      item.append(button);
      mediaFolders.append(item);
    }

    for (const image of data.images) {
      const relativePath = image.webPath.replace(/^\//, "");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "media-image-btn";
      button.title = image.name;

      const preview = document.createElement("img");
      preview.className = "media-image-preview";
      preview.src = getMediaFileUrl(relativePath);
      preview.alt = "";
      preview.loading = "lazy";

      const label = document.createElement("span");
      label.className = "media-image-name";
      label.textContent = image.name;

      button.append(preview, label);
      button.addEventListener("click", () => {
        showMediaDetailsView(image);
      });

      mediaImages.append(button);
    }

    if (data.folders.length === 0 && data.images.length === 0) {
      setMediaStatus(`No folders or images in ${formatMediaDirLabel(data.currentDir)}.`);
    } else {
      setMediaStatus("");
    }
  }

  async function loadMediaDirectory(relativeDir = "img") {
    if (!api.getProjectPath()) {
      setMediaStatus("Open and scan a project first.", { isError: true });
      mediaFolders.replaceChildren();
      mediaImages.replaceChildren();
      mediaUpBtn.disabled = true;
      mediaBreadcrumb.replaceChildren();
      return;
    }

    setMediaStatus("Loading…");

    try {
      const params = new URLSearchParams({
        project: api.getProjectPath(),
        dir: relativeDir,
      });
      const response = await fetch(`/api/media?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        setMediaStatus(data.error ?? "Could not load media", { isError: true });
        mediaFolders.replaceChildren();
        mediaImages.replaceChildren();
        mediaUpBtn.disabled = true;
        mediaBreadcrumb.replaceChildren();
        return;
      }

      renderMediaDirectory(data);
    } catch {
      setMediaStatus("Could not load media", { isError: true });
      mediaFolders.replaceChildren();
      mediaImages.replaceChildren();
      mediaUpBtn.disabled = true;
      mediaBreadcrumb.replaceChildren();
    }
  }

  function openMediaDialog() {
    const caret = api.saveCaret();
    api.setPendingCaret(caret);
    showMediaBrowserView();
    dialog.showModal();
    loadMediaDirectory("img");
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
    api.clearPendingCaret();
    showMediaBrowserView();
  });

  imageForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!pendingImage) {
      return;
    }

    api.flushHistory();

    const markdown = buildFigureMarkdown(pendingImage.webPath, {
      alt: imageAltInput.value,
      lazyLoad: imageLazyInput.checked,
      caption: imageCaptionInput.value,
    });

    if (api.insertAtCaret(markdown)) {
      dialog.close();
    }
  });

  imageBackBtn.addEventListener("click", () => {
    showMediaBrowserView();
  });

  imageAltInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      imageCaptionInput.focus();
    }
  });

  return { dialog, openMediaDialog };
}

export default {
  group: "insert",

  mount(container, api) {
    const { dialog, openMediaDialog } = createMediaDialog(api);
    document.body.append(dialog);

    const button = createToolbarButton({
      label: "Insert image",
      icon: icons.image,
    });

    attachToolbarButton(button, openMediaDialog);

    container.append(button);
  },
};
