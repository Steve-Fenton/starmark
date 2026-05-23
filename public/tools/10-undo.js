import { attachToolbarButton, createToolbarButton } from "../toolkit.js";
import { icons } from "../icons.js";

export default {
  group: "history",

  mount(container, api) {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const button = createToolbarButton({
      label: "Undo",
      title: isMac ? "Undo (⌘Z)" : "Undo (Ctrl+Z)",
      icon: icons.undo,
      disabled: true,
    });

    api.onHistoryChange(({ canUndo }) => {
      button.disabled = !canUndo;
    });

    attachToolbarButton(button, () => {
      api.undo();
    });

    container.append(button);
  },
};
