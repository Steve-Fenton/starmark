import { attachToolbarButton, createToolbarButton } from "../toolkit.js";
import { icons } from "../icons.js";

export default {
  group: "history",

  mount(container, api) {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const button = createToolbarButton({
      label: "Redo",
      title: isMac ? "Redo (⌘⇧Z)" : "Redo (Ctrl+Shift+Z)",
      icon: icons.redo,
      disabled: true,
    });

    api.onHistoryChange(({ canRedo }) => {
      button.disabled = !canRedo;
    });

    attachToolbarButton(button, () => {
      api.redo();
    });

    container.append(button);
  },
};
