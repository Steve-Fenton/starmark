export function attachToolbarButton(button, handler) {
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
  });
  button.addEventListener("click", handler);
}

export function createToolbarButton({ label, title, icon, disabled = false }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "toolbar-btn";
  button.setAttribute("aria-label", label);
  if (title) {
    button.title = title;
  }
  button.innerHTML = icon;
  button.disabled = disabled;
  return button;
}
