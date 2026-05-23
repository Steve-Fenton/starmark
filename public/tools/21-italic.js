import { attachToolbarButton, createToolbarButton } from "../toolkit.js";
import { icons } from "../icons.js";

export default {
  group: "format",

  mount(container, api) {
    const button = createToolbarButton({
      label: "Italic",
      icon: icons.italic,
    });

    attachToolbarButton(button, () => {
      api.runHistoryAction(() => {
        api.wrapSelection("*");
      });
    });

    container.append(button);
  },
};
