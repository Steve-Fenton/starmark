import { attachToolbarButton, createToolbarButton } from "../toolkit.js";
import { icons } from "../icons.js";

let savedLinkRange = null;

function createLinkDialog() {
  const dialog = document.createElement("dialog");
  dialog.id = "link-dialog";
  dialog.className = "link-dialog";
  dialog.innerHTML = `
    <div class="dialog-header">
      <h2>Insert link</h2>
      <button type="button" class="dialog-close link-dialog-close" aria-label="Close">&times;</button>
    </div>
    <form class="link-form">
      <div class="link-field">
        <label for="link-text">Link text</label>
        <input id="link-text" type="text" autocomplete="off" spellcheck="false" />
      </div>
      <div class="link-field">
        <label for="link-url">URL</label>
        <input id="link-url" type="text" autocomplete="off" spellcheck="false" />
      </div>
      <div class="link-form-actions">
        <button type="submit" class="primary">Done</button>
      </div>
    </form>
  `;

  const closeBtn = dialog.querySelector(".link-dialog-close");
  const form = dialog.querySelector(".link-form");
  const textInput = dialog.querySelector("#link-text");
  const urlInput = dialog.querySelector("#link-url");

  closeBtn.addEventListener("click", () => {
    dialog.close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });

  dialog.addEventListener("close", () => {
    savedLinkRange = null;
  });

  textInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      urlInput.focus();
    }
  });

  return { dialog, form, textInput, urlInput };
}

function saveEditorSelection(api) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    savedLinkRange = null;
    return "";
  }

  const range = selection.getRangeAt(0);
  if (!api.editor.contains(range.commonAncestorContainer)) {
    savedLinkRange = null;
    return "";
  }

  savedLinkRange = range.cloneRange();
  return range.toString();
}

function insertMarkdownLinkAtSelection(api, linkText, url) {
  const trimmedUrl = url.trim();
  if (!savedLinkRange || !trimmedUrl) {
    return false;
  }

  const markdown = `[${linkText}](${trimmedUrl})`;
  savedLinkRange.deleteContents();
  const textNode = document.createTextNode(markdown);
  savedLinkRange.insertNode(textNode);

  const selection = window.getSelection();
  const range = document.createRange();
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);

  savedLinkRange = null;
  api.reevaluateLines();
  api.flushHistory();
  api.focus();
  return true;
}

export default {
  group: "insert",

  mount(container, api) {
    const { dialog, form, textInput, urlInput } = createLinkDialog();
    document.body.append(dialog);

    form.addEventListener("submit", (event) => {
      event.preventDefault();

      api.flushHistory();

      if (!insertMarkdownLinkAtSelection(api, textInput.value, urlInput.value)) {
        urlInput.focus();
        return;
      }

      dialog.close();
    });

    const button = createToolbarButton({
      label: "Insert link",
      icon: icons.link,
    });

    attachToolbarButton(button, () => {
      const selectedText = saveEditorSelection(api);
      textInput.value = selectedText;
      urlInput.value = "";
      dialog.showModal();
      urlInput.focus();
    });

    container.append(button);
  },
};
