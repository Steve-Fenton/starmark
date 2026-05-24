import { attachToolbarButton, createToolbarButton } from "../toolkit.js";
import { icons } from "../icons.js";
import { createMediaDialog } from "../media-browser.js";
import { getMediaDir } from "../settings.js";

function escapeMarkdownAttribute(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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

export default {
  group: "insert",

  mount(container, api) {
    const { dialog, openMediaDialog } = createMediaDialog({
      getProjectPath: () => api.getProjectPath(),
      getInitialDir: () => getMediaDir(),
      title: "Insert image",
      selectMode: "details",
      dialogId: "media-dialog-insert-accelerator",
      onOpen() {
        const caret = api.saveCaret();
        api.setPendingCaret(caret);
      },
      onClose() {
        api.clearPendingCaret();
      },
      onInsert(image, { alt, lazyLoad, caption }) {
        api.flushHistory();

        const markdown = buildFigureMarkdown(image.webPath, {
          alt,
          lazyLoad,
          caption,
        });

        return api.insertAtCaret(markdown);
      },
    });
    document.body.append(dialog);

    const button = createToolbarButton({
      label: "Insert image",
      icon: icons.image,
    });

    attachToolbarButton(button, openMediaDialog);

    container.append(button);
  },
};
