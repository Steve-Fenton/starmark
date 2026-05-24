import { attachToolbarButton, createToolbarButton } from "../toolkit.js";
import { icons } from "../icons.js";
import { createMediaDialog } from "../media-browser.js";
import { getMediaDir } from "../settings.js";

function escapeMarkdownAlt(value) {
  return value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function buildHtmlFigureMarkdown(webPath, { alt, caption }) {
  const lines = ["<figure>", "", `![${escapeMarkdownAlt(alt)}](${webPath})`, ""];

  const trimmedCaption = caption.trim();
  if (trimmedCaption) {
    lines.push(`<figcaption>${trimmedCaption}</figcaption>`, "");
  }

  lines.push("</figure>");
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
      dialogId: "media-dialog-insert",
      onOpen() {
        const caret = api.saveCaret();
        api.setPendingCaret(caret);
      },
      onClose() {
        api.clearPendingCaret();
      },
      onInsert(image, { alt, caption }) {
        api.flushHistory();

        const markdown = buildHtmlFigureMarkdown(image.webPath, {
          alt,
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
