import { attachToolbarButton, createToolbarButton } from "../toolkit.js";
import { icons } from "../icons.js";

export default {
  group: "format",

  mount(container, api) {
    const button = createToolbarButton({
      label: "Strikethrough",
      icon: icons.strikethrough,
    });

    attachToolbarButton(button, () => {
      api.runHistoryAction(() => {
        api.wrapSelection("~~");
      });
    });

    container.append(button);
  },
};
