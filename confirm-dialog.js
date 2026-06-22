(function initRekabetliDialogs() {
  let pendingResolve = null;
  let dialogEl = null;
  let titleEl = null;
  let messageEl = null;
  let confirmBtn = null;
  let cancelBtn = null;
  let secondaryBtn = null;
  let cardEl = null;

  function ensureDialog() {
    if (dialogEl) return;

    dialogEl = document.createElement("div");
    dialogEl.id = "rekabetli-dialog";
    dialogEl.className = "confirm-dialog-overlay";
    dialogEl.hidden = true;
    const card = document.createElement("section");
    card.className = "confirm-dialog-card";
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "confirm-dialog-title");
    card.setAttribute("aria-describedby", "confirm-dialog-message");

    const title = document.createElement("h3");
    title.id = "confirm-dialog-title";
    title.className = "confirm-dialog-title";

    const message = document.createElement("p");
    message.id = "confirm-dialog-message";
    message.className = "confirm-dialog-message";

    const actions = document.createElement("div");
    actions.className = "confirm-dialog-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary confirm-dialog-cancel";
    cancel.textContent = "Vazgeç";

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "confirm-dialog-confirm";
    confirm.textContent = "Onayla";

    const secondary = document.createElement("button");
    secondary.type = "button";
    secondary.className = "confirm-dialog-secondary";
    secondary.textContent = "İkincil";
    secondary.hidden = true;

    actions.append(cancel, secondary, confirm);
    card.append(title, message, actions);
    dialogEl.appendChild(card);
    document.body.appendChild(dialogEl);

    cardEl = card;
    titleEl = title;
    messageEl = message;
    confirmBtn = confirm;
    cancelBtn = cancel;
    secondaryBtn = secondary;

    confirmBtn.addEventListener("click", () => closeDialog("confirm"));
    cancelBtn.addEventListener("click", () => closeDialog(false));
    secondaryBtn.addEventListener("click", () => closeDialog("secondary"));

    dialogEl.addEventListener("click", (event) => {
      if (event.target === dialogEl) closeDialog(false);
    });

    document.addEventListener("keydown", (event) => {
      if (dialogEl.hidden) return;
      if (event.key === "Escape") closeDialog(false);
    });
  }

  function closeDialog(result) {
    if (!dialogEl) return;
    dialogEl.hidden = true;
    cardEl?.classList.remove("is-danger");
    confirmBtn?.classList.remove("danger");
    if (secondaryBtn) secondaryBtn.hidden = true;
    const resolve = pendingResolve;
    pendingResolve = null;
    resolve?.(result);
  }

  function normalizeOptions(input, defaults) {
    if (typeof input === "string") {
      return { ...defaults, message: input };
    }
    return { ...defaults, ...input };
  }

  function openDialog(options) {
    ensureDialog();

    return new Promise((resolve) => {
      pendingResolve = resolve;

      titleEl.textContent = options.title;
      messageEl.textContent = options.message;
      confirmBtn.textContent = options.confirmLabel;
      cancelBtn.textContent = options.cancelLabel;
      cancelBtn.hidden = !options.showCancel;
      if (secondaryBtn) {
        secondaryBtn.hidden = !options.secondaryLabel;
        if (options.secondaryLabel) secondaryBtn.textContent = options.secondaryLabel;
      }

      const isDanger = Boolean(options.danger);
      cardEl.classList.toggle("is-danger", isDanger);
      confirmBtn.classList.toggle("danger", isDanger);

      dialogEl.hidden = false;
      if (options.secondaryLabel && secondaryBtn) {
        secondaryBtn.focus();
      } else {
        (options.showCancel ? cancelBtn : confirmBtn).focus();
      }
    });
  }

  window.rekabetliConfirm = function rekabetliConfirm(input) {
    const options = normalizeOptions(input, {
      title: "Emin misin?",
      message: "",
      confirmLabel: "Evet",
      cancelLabel: "Vazgeç",
      showCancel: true,
      danger: false,
    });

    return openDialog(options).then((result) => result === "confirm");
  };

  window.rekabetliAlert = function rekabetliAlert(input) {
    const options = normalizeOptions(input, {
      title: "Bilgi",
      message: "",
      confirmLabel: "Tamam",
      cancelLabel: "Vazgeç",
      showCancel: false,
      danger: false,
      secondaryLabel: null,
    });

    return openDialog(options).then((result) => {
      if (result === "secondary") return "secondary";
      return result === "confirm";
    });
  };
})();
