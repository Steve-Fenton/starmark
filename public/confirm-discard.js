let confirmDiscardDialog = null;
let pendingDiscard = null;

function ensureConfirmDiscardDialog() {
  if (confirmDiscardDialog) {
    return confirmDiscardDialog;
  }

  const dialog = document.createElement("dialog");
  dialog.id = "confirm-discard-dialog";
  dialog.className = "confirm-dialog";
  dialog.innerHTML = `
    <div class="dialog-header">
      <h2>Discard changes?</h2>
      <button type="button" class="dialog-close confirm-discard-close" aria-label="Close">&times;</button>
    </div>
    <div class="confirm-dialog-body">
      <p class="confirm-discard-message">Your changes will be lost.</p>
      <div class="confirm-dialog-actions">
        <button type="button" class="confirm-discard-keep">Keep editing</button>
        <button type="button" class="destructive confirm-discard-submit">Discard</button>
      </div>
    </div>
  `;

  const messageEl = dialog.querySelector(".confirm-discard-message");
  const closeBtn = dialog.querySelector(".confirm-discard-close");
  const keepBtn = dialog.querySelector(".confirm-discard-keep");
  const discardBtn = dialog.querySelector(".confirm-discard-submit");

  function closeConfirmDialog() {
    pendingDiscard = null;
    dialog.close();
  }

  closeBtn.addEventListener("click", closeConfirmDialog);
  keepBtn.addEventListener("click", closeConfirmDialog);

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      closeConfirmDialog();
    }
  });

  discardBtn.addEventListener("click", () => {
    const discard = pendingDiscard;
    closeConfirmDialog();
    discard?.();
  });

  dialog.addEventListener("close", () => {
    pendingDiscard = null;
  });

  document.body.append(dialog);
  confirmDiscardDialog = { dialog, messageEl, keepBtn };
  return confirmDiscardDialog;
}

export function confirmDiscard(onDiscard, { message = "Your changes will be lost." } = {}) {
  const { dialog, messageEl, keepBtn } = ensureConfirmDiscardDialog();
  pendingDiscard = onDiscard;
  messageEl.textContent = message;
  dialog.showModal();
  keepBtn.focus();
}

export function makeGuardedClose(dialog, isDirty) {
  return function guardedClose() {
    if (isDirty()) {
      confirmDiscard(() => dialog.close());
      return;
    }

    dialog.close();
  };
}

export function makeGuardedAction(isDirty, action) {
  return function guardedAction() {
    if (isDirty()) {
      confirmDiscard(action);
      return;
    }

    action();
  };
}

export function attachDialogCloseGuard(dialog, closeBtn, isDirty) {
  const requestClose = makeGuardedClose(dialog, isDirty);

  closeBtn.addEventListener("click", requestClose);

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      requestClose();
    }
  });

  dialog.addEventListener("cancel", (event) => {
    if (isDirty()) {
      event.preventDefault();
      confirmDiscard(() => dialog.close());
    }
  });

  return requestClose;
}
