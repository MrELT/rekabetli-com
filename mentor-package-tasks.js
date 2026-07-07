(function initMentorPackageTasks() {
  const TASK_BUCKET = "mentor-task-attachments";
  const MAX_TITLE = 160;
  const MAX_DESCRIPTION = 8000;
  const MAX_ATTACHMENTS = 8;
  const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
  const MAX_DOC_BYTES = 10 * 1024 * 1024;

  const IMAGE_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
  ]);

  const DOC_TYPES = new Set([
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ]);

  function sb() {
    return window.getSupabase?.() || window.sb || null;
  }

  function sanitizeFileName(name) {
    const base = String(name || "dosya")
      .replace(/[/\\?%*:|"<>]/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 120);
    return base || "dosya";
  }

  function toDatetimeLocalValue(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function fromDatetimeLocalValue(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  function formatScheduleLabel(task) {
    if (task.schedule_kind === "range") {
      const start = task.starts_at ? new Date(task.starts_at) : null;
      const end = task.ends_at ? new Date(task.ends_at) : null;
      if (!start || !end) return "Zaman aralığı";
      const fmt = (d) =>
        d.toLocaleString("tr-TR", {
          day: "numeric",
          month: "short",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      return `${fmt(start)} – ${fmt(end)}`;
    }
    if (!task.deadline_at) return "Son tarih";
    const d = new Date(task.deadline_at);
    return `Son tarih: ${d.toLocaleString("tr-TR", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  function isImageAttachment(att) {
    return IMAGE_TYPES.has(att?.mime) || /\.(jpe?g|png|gif|webp)$/i.test(att?.name || "");
  }

  async function showAlert(title, message) {
    if (typeof window.rekabetliAlert === "function") {
      await window.rekabetliAlert({ title, message });
      return;
    }
    window.alert(`${title}\n\n${message}`);
  }

  async function uploadAttachmentFile({ mentorId, packageId, taskId, file }) {
    const supabase = sb();
    if (!supabase) throw new Error("Supabase bağlantısı bulunamadı.");

    const isImage = IMAGE_TYPES.has(file.type);
    const isDoc = DOC_TYPES.has(file.type);
    if (!isImage && !isDoc) {
      throw new Error("Yalnızca görsel (JPEG, PNG, WebP, GIF) veya belge (PDF, Word) yükleyebilirsiniz.");
    }

    const maxBytes = isImage ? MAX_IMAGE_BYTES : MAX_DOC_BYTES;
    if (file.size > maxBytes) {
      throw new Error(isImage ? "Görsel en fazla 5 MB olabilir." : "Belge en fazla 10 MB olabilir.");
    }

    const filePath = `${mentorId}/${packageId}/${taskId}/${Date.now()}-${sanitizeFileName(file.name)}`;

    if (isImage && window.RekabetliImageUploadLimit?.consumeUploadSlot) {
      await window.RekabetliImageUploadLimit.consumeUploadSlot(supabase, {
        bucket: TASK_BUCKET,
        path: filePath,
      });
    }

    const { error: uploadError } = await supabase.storage.from(TASK_BUCKET).upload(filePath, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) throw uploadError;

    const { data } = supabase.storage.from(TASK_BUCKET).getPublicUrl(filePath);
    return {
      id: crypto.randomUUID(),
      name: file.name,
      url: data.publicUrl,
      mime: file.type || "",
      size: file.size,
    };
  }

  async function fetchTaskPacks(mentorId, packageId) {
    const supabase = sb();
    const { data, error } = await supabase
      .from("mentor_package_task_packs")
      .select(
        "id, title, description, schedule_kind, deadline_at, starts_at, ends_at, attachments, created_at, updated_at",
      )
      .eq("mentor_id", mentorId)
      .eq("package_id", packageId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return data ?? [];
  }

  async function fetchPackageStudentIds(mentorId, packageId) {
    const supabase = sb();
    const { data, error } = await supabase
      .from("mentor_package_students")
      .select("student_id")
      .eq("mentor_id", mentorId)
      .eq("package_id", packageId);
    if (error) throw error;
    return (data ?? []).map((row) => row.student_id);
  }

  async function fetchActivations(mentorId, packageId, { studentId = null } = {}) {
    const supabase = sb();
    let query = supabase
      .from("mentor_package_task_activations")
      .select("task_pack_id, student_id, is_active")
      .eq("mentor_id", mentorId)
      .eq("package_id", packageId);
    if (studentId) query = query.eq("student_id", studentId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  function isStudentTaskActive(activations, taskId, studentId) {
    return activations.some(
      (row) => row.task_pack_id === taskId && row.student_id === studentId && row.is_active,
    );
  }

  function getPackageActivationSummary(activations, studentIds, taskId) {
    const total = studentIds.length;
    if (!total) return { activeCount: 0, total: 0, allActive: false };
    const activeCount = studentIds.filter((studentId) =>
      activations.some(
        (row) => row.task_pack_id === taskId && row.student_id === studentId && row.is_active,
      ),
    ).length;
    return { activeCount, total, allActive: activeCount === total };
  }

  async function setTaskActiveForStudent(taskPackId, studentId, isActive) {
    const supabase = sb();
    const { error } = await supabase.rpc("set_task_pack_active_for_student", {
      p_task_pack_id: taskPackId,
      p_student_id: studentId,
      p_active: isActive,
    });
    if (error) throw error;
  }

  async function setTaskActiveForPackageStudents(taskPackId, isActive) {
    const supabase = sb();
    const { data, error } = await supabase.rpc("set_task_pack_active_for_package_students", {
      p_task_pack_id: taskPackId,
      p_active: isActive,
    });
    if (error) throw error;
    return Number(data) || 0;
  }

  function createAttachmentPreview(att, { onRemove = null } = {}) {
    const item = document.createElement("div");
    item.className = "mentor-task-pack-attachment";

    if (isImageAttachment(att)) {
      const img = document.createElement("img");
      img.className = "mentor-task-pack-attachment-img";
      img.src = att.url;
      img.alt = att.name || "Ek görsel";
      img.loading = "lazy";
      item.appendChild(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "mentor-task-pack-attachment-doc";
      icon.textContent = "📄";
      item.appendChild(icon);
    }

    const link = document.createElement("a");
    link.className = "mentor-task-pack-attachment-name";
    link.href = att.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = att.name || "Dosya";
    item.appendChild(link);

    if (onRemove) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "mentor-task-pack-attachment-remove";
      removeBtn.setAttribute("aria-label", "Eki kaldır");
      removeBtn.textContent = "×";
      removeBtn.addEventListener("click", onRemove);
      item.appendChild(removeBtn);
    }

    return item;
  }

  function roundToNextHour(date = new Date()) {
    const d = new Date(date);
    d.setMinutes(0, 0, 0);
    if (d <= date) d.setHours(d.getHours() + 1);
    return d;
  }

  function atEndOfDay(date) {
    const d = new Date(date);
    d.setHours(23, 59, 0, 0);
    return d;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function startOfWeekMonday(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  function createDatetimeField({ id, label, hint = "" }) {
    const field = document.createElement("div");
    field.className = "mentor-task-pack-datetime-field";

    const labelEl = document.createElement("label");
    labelEl.className = "mentor-task-pack-datetime-label";
    labelEl.textContent = label;
    labelEl.setAttribute("for", id);

    const wrap = document.createElement("div");
    wrap.className = "mentor-task-pack-datetime-wrap";

    const icon = document.createElement("span");
    icon.className = "mentor-task-pack-datetime-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "📅";

    const input = document.createElement("input");
    input.type = "datetime-local";
    input.id = id;
    input.className = "mentor-task-pack-datetime";

    wrap.append(icon, input);
    field.append(labelEl, wrap);

    if (hint) {
      const hintEl = document.createElement("p");
      hintEl.className = "mentor-task-pack-datetime-hint";
      hintEl.textContent = hint;
      field.appendChild(hintEl);
    }

    return { field, input };
  }

  function createPresetChip(label, onClick) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "mentor-task-pack-preset-chip";
    chip.textContent = label;
    chip.addEventListener("click", onClick);
    return chip;
  }

  function createScheduleBlock({ packageIdSafe, editingTask }) {
    const block = document.createElement("div");
    block.className = "mentor-task-pack-schedule-block";

    const heading = document.createElement("p");
    heading.className = "mentor-task-pack-field-label";
    heading.textContent = "Zamanlama";

    const intro = document.createElement("p");
    intro.className = "mentor-task-pack-schedule-intro";
    intro.textContent = "Öğrencinin görevi ne zamana kadar veya hangi aralıkta tamamlaması gerektiğini belirleyin.";

    const toggle = document.createElement("div");
    toggle.className = "mentor-task-pack-schedule-toggle";
    toggle.setAttribute("role", "radiogroup");
    toggle.setAttribute("aria-label", "Zamanlama türü");

    const initialKind = editingTask?.schedule_kind || "deadline";
    let scheduleKind = initialKind;

    const deadlineBtn = document.createElement("button");
    deadlineBtn.type = "button";
    deadlineBtn.className = "mentor-task-pack-schedule-toggle-btn";
    deadlineBtn.dataset.kind = "deadline";
    deadlineBtn.setAttribute("role", "radio");
    deadlineBtn.setAttribute("aria-checked", initialKind === "deadline" ? "true" : "false");
    deadlineBtn.innerHTML = '<span class="mentor-task-pack-schedule-toggle-icon" aria-hidden="true">⏰</span><span class="mentor-task-pack-schedule-toggle-text"><strong>Son tarih</strong><small>Tek bir teslim zamanı</small></span>';

    const rangeBtn = document.createElement("button");
    rangeBtn.type = "button";
    rangeBtn.className = "mentor-task-pack-schedule-toggle-btn";
    rangeBtn.dataset.kind = "range";
    rangeBtn.setAttribute("role", "radio");
    rangeBtn.setAttribute("aria-checked", initialKind === "range" ? "true" : "false");
    rangeBtn.innerHTML = '<span class="mentor-task-pack-schedule-toggle-icon" aria-hidden="true">↔</span><span class="mentor-task-pack-schedule-toggle-text"><strong>Zaman aralığı</strong><small>Başlangıç ve bitiş</small></span>';

    toggle.append(deadlineBtn, rangeBtn);

    const panel = document.createElement("div");
    panel.className = "mentor-task-pack-schedule-panel";

    const deadlinePane = document.createElement("div");
    deadlinePane.className = "mentor-task-pack-schedule-pane";
    deadlinePane.dataset.pane = "deadline";

    const deadlinePaneTitle = document.createElement("p");
    deadlinePaneTitle.className = "mentor-task-pack-schedule-pane-title";
    deadlinePaneTitle.textContent = "Teslim zamanı";

    const { field: deadlineField, input: deadlineInput } = createDatetimeField({
      id: `task-pack-deadline-${packageIdSafe}`,
      label: "Son tarih ve saat",
      hint: "Öğrenci bu zamana kadar görevi tamamlamalı.",
    });
    deadlineInput.value = toDatetimeLocalValue(editingTask?.deadline_at);

    const deadlinePresets = document.createElement("div");
    deadlinePresets.className = "mentor-task-pack-presets";
    deadlinePresets.append(
      createPresetChip("Yarın akşam", () => {
        deadlineInput.value = toDatetimeLocalValue(atEndOfDay(addDays(new Date(), 1)).toISOString());
      }),
      createPresetChip("3 gün sonra", () => {
        deadlineInput.value = toDatetimeLocalValue(atEndOfDay(addDays(new Date(), 3)).toISOString());
      }),
      createPresetChip("1 hafta sonra", () => {
        deadlineInput.value = toDatetimeLocalValue(atEndOfDay(addDays(new Date(), 7)).toISOString());
      }),
    );

    deadlinePane.append(deadlinePaneTitle, deadlineField, deadlinePresets);

    const rangePane = document.createElement("div");
    rangePane.className = "mentor-task-pack-schedule-pane";
    rangePane.dataset.pane = "range";

    const rangePaneTitle = document.createElement("p");
    rangePaneTitle.className = "mentor-task-pack-schedule-pane-title";
    rangePaneTitle.textContent = "Çalışma aralığı";

    const rangeGrid = document.createElement("div");
    rangeGrid.className = "mentor-task-pack-range-grid";

    const { field: startField, input: startInput } = createDatetimeField({
      id: `task-pack-start-${packageIdSafe}`,
      label: "Başlangıç",
      hint: "Görevin açıldığı an.",
    });
    startInput.value = toDatetimeLocalValue(editingTask?.starts_at);

    const { field: endField, input: endInput } = createDatetimeField({
      id: `task-pack-end-${packageIdSafe}`,
      label: "Bitiş",
      hint: "Görevin kapanacağı an.",
    });
    endInput.value = toDatetimeLocalValue(editingTask?.ends_at);

    rangeGrid.append(startField, endField);

    const rangePresets = document.createElement("div");
    rangePresets.className = "mentor-task-pack-presets";
    rangePresets.append(
      createPresetChip("Bu hafta", () => {
        const start = startOfWeekMonday();
        const end = atEndOfDay(addDays(start, 6));
        startInput.value = toDatetimeLocalValue(start.toISOString());
        endInput.value = toDatetimeLocalValue(end.toISOString());
      }),
      createPresetChip("Gelecek hafta", () => {
        const start = addDays(startOfWeekMonday(), 7);
        const end = atEndOfDay(addDays(start, 6));
        startInput.value = toDatetimeLocalValue(start.toISOString());
        endInput.value = toDatetimeLocalValue(end.toISOString());
      }),
      createPresetChip("7 gün", () => {
        const start = roundToNextHour();
        const end = atEndOfDay(addDays(start, 6));
        startInput.value = toDatetimeLocalValue(start.toISOString());
        endInput.value = toDatetimeLocalValue(end.toISOString());
      }),
    );

    rangePane.append(rangePaneTitle, rangeGrid, rangePresets);
    panel.append(deadlinePane, rangePane);

    function syncScheduleUi() {
      const isDeadline = scheduleKind === "deadline";
      deadlineBtn.classList.toggle("is-active", isDeadline);
      rangeBtn.classList.toggle("is-active", !isDeadline);
      deadlineBtn.setAttribute("aria-checked", isDeadline ? "true" : "false");
      rangeBtn.setAttribute("aria-checked", !isDeadline ? "true" : "false");
      deadlinePane.hidden = !isDeadline;
      rangePane.hidden = isDeadline;
      panel.dataset.kind = scheduleKind;
    }

    function setScheduleKind(kind) {
      scheduleKind = kind === "range" ? "range" : "deadline";
      syncScheduleUi();
    }

    deadlineBtn.addEventListener("click", () => setScheduleKind("deadline"));
    rangeBtn.addEventListener("click", () => setScheduleKind("range"));
    syncScheduleUi();

    block.append(heading, intro, toggle, panel);

    return {
      block,
      getScheduleKind: () => scheduleKind,
      deadlineInput,
      startInput,
      endInput,
    };
  }

  function createTaskForm({ mentorId, packageId, packageIdSafe, editingTask = null, onSaved, onCancel }) {
    const form = document.createElement("form");
    form.className = "mentor-task-pack-form";
    form.noValidate = true;

    const taskId = editingTask?.id || crypto.randomUUID();
    const keptAttachments = [...(editingTask?.attachments || [])];
    const pendingFiles = [];

    const titleLabel = document.createElement("label");
    titleLabel.textContent = "Görev başlığı";
    titleLabel.setAttribute("for", `task-pack-title-${packageIdSafe}`);

    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.id = `task-pack-title-${packageIdSafe}`;
    titleInput.className = "mentor-task-pack-title-input";
    titleInput.maxLength = MAX_TITLE;
    titleInput.required = true;
    titleInput.value = editingTask?.title || "";
    titleInput.placeholder = "Örn: Hafta 1 – Deneme analizi";

    const descLabel = document.createElement("label");
    descLabel.textContent = "Açıklama";
    descLabel.setAttribute("for", `task-pack-desc-${packageIdSafe}`);

    const descInput = document.createElement("textarea");
    descInput.id = `task-pack-desc-${packageIdSafe}`;
    descInput.className = "mentor-task-pack-desc-input";
    descInput.rows = 4;
    descInput.maxLength = MAX_DESCRIPTION;
    descInput.value = editingTask?.description || "";
    descInput.placeholder = "Öğrencinin yapması gerekenleri, kaynakları ve notları yazın…";

    const schedule = createScheduleBlock({ packageIdSafe, editingTask });
    const { deadlineInput, startInput, endInput } = schedule;

    const attachLabel = document.createElement("label");
    attachLabel.className = "mentor-task-pack-field-label";
    attachLabel.textContent = "Belge veya fotoğraf";

    const attachHint = document.createElement("p");
    attachHint.className = "mentor-task-pack-hint";
    attachHint.textContent =
      "JPEG, PNG, WebP, GIF (en fazla 5 MB) veya PDF/Word (en fazla 10 MB). En fazla 8 dosya.";

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.className = "mentor-task-pack-file-input";
    fileInput.multiple = true;
    fileInput.accept = "image/jpeg,image/png,image/webp,image/gif,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

    const attachmentsWrap = document.createElement("div");
    attachmentsWrap.className = "mentor-task-pack-attachments";

    function renderAttachments() {
      attachmentsWrap.replaceChildren();
      keptAttachments.forEach((att) => {
        attachmentsWrap.appendChild(
          createAttachmentPreview(att, {
            onRemove: () => {
              const idx = keptAttachments.findIndex((row) => row.id === att.id);
              if (idx >= 0) keptAttachments.splice(idx, 1);
              renderAttachments();
            },
          }),
        );
      });
      pendingFiles.forEach((file) => {
        const pending = document.createElement("div");
        pending.className = "mentor-task-pack-attachment mentor-task-pack-attachment-pending";
        pending.textContent = `${file.name} (yüklenecek)`;
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "mentor-task-pack-attachment-remove";
        removeBtn.setAttribute("aria-label", "Dosyayı listeden çıkar");
        removeBtn.textContent = "×";
        removeBtn.addEventListener("click", () => {
          const idx = pendingFiles.indexOf(file);
          if (idx >= 0) pendingFiles.splice(idx, 1);
          renderAttachments();
        });
        pending.appendChild(removeBtn);
        attachmentsWrap.appendChild(pending);
      });
    }

    fileInput.addEventListener("change", () => {
      const files = Array.from(fileInput.files || []);
      fileInput.value = "";
      for (const file of files) {
        if (keptAttachments.length + pendingFiles.length >= MAX_ATTACHMENTS) {
          void showAlert("Dosya limiti", `En fazla ${MAX_ATTACHMENTS} dosya ekleyebilirsiniz.`);
          break;
        }
        pendingFiles.push(file);
      }
      renderAttachments();
    });

    renderAttachments();

    const attachmentsBlock = document.createElement("div");
    attachmentsBlock.className = "mentor-task-pack-attachments-block";

    const attachmentsIntro = document.createElement("p");
    attachmentsIntro.className = "mentor-task-pack-attachments-intro";
    attachmentsIntro.textContent = "Görevle birlikte paylaşılacak belge veya görselleri ekleyin.";

    const attachmentsPanel = document.createElement("div");
    attachmentsPanel.className = "mentor-task-pack-attachments-panel";

    attachmentsPanel.append(fileInput, attachmentsWrap);
    attachmentsBlock.append(attachLabel, attachHint, attachmentsIntro, attachmentsPanel);

    const formColumns = document.createElement("div");
    formColumns.className = "mentor-task-pack-form-columns";
    formColumns.append(schedule.block, attachmentsBlock);

    const statusEl = document.createElement("p");
    statusEl.className = "mentor-task-pack-form-status";
    statusEl.hidden = true;

    const actions = document.createElement("div");
    actions.className = "mentor-task-pack-form-actions";

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.className = "mentor-task-pack-save-btn";
    saveBtn.textContent = editingTask ? "Güncelle" : "Kaydet";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "secondary mentor-task-pack-cancel-btn";
    cancelBtn.textContent = "İptal";
    cancelBtn.addEventListener("click", () => {
      if (onCancel) onCancel();
    });

    actions.append(saveBtn, cancelBtn);

    form.append(
      titleLabel,
      titleInput,
      descLabel,
      descInput,
      formColumns,
      statusEl,
      actions,
    );

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const title = titleInput.value.trim();
      if (!title) {
        await showAlert("Eksik bilgi", "Görev başlığı zorunludur.");
        titleInput.focus();
        return;
      }

      const scheduleKind = schedule.getScheduleKind();
      let deadlineAt = null;
      let startsAt = null;
      let endsAt = null;

      if (scheduleKind === "deadline") {
        deadlineAt = fromDatetimeLocalValue(deadlineInput.value);
        if (!deadlineAt) {
          await showAlert("Eksik bilgi", "Son tarih seçin.");
          deadlineInput.focus();
          return;
        }
      } else {
        startsAt = fromDatetimeLocalValue(startInput.value);
        endsAt = fromDatetimeLocalValue(endInput.value);
        if (!startsAt || !endsAt) {
          await showAlert("Eksik bilgi", "Başlangıç ve bitiş tarihlerini seçin.");
          return;
        }
        if (new Date(endsAt) < new Date(startsAt)) {
          await showAlert("Geçersiz aralık", "Bitiş tarihi başlangıçtan önce olamaz.");
          return;
        }
      }

      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      statusEl.hidden = false;
      statusEl.textContent = "Kaydediliyor…";

      try {
        const uploaded = [];
        for (const file of pendingFiles) {
          statusEl.textContent = `Yükleniyor: ${file.name}…`;
          const att = await uploadAttachmentFile({
            mentorId,
            packageId,
            taskId,
            file,
          });
          uploaded.push(att);
        }

        const attachments = [...keptAttachments, ...uploaded];
        const payload = {
          mentor_id: mentorId,
          package_id: packageId,
          title,
          description: descInput.value.trim(),
          schedule_kind: scheduleKind,
          deadline_at: scheduleKind === "deadline" ? deadlineAt : null,
          starts_at: scheduleKind === "range" ? startsAt : null,
          ends_at: scheduleKind === "range" ? endsAt : null,
          attachments,
        };

        const supabase = sb();
        if (editingTask) {
          const { error } = await supabase
            .from("mentor_package_task_packs")
            .update(payload)
            .eq("id", editingTask.id)
            .eq("mentor_id", mentorId);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("mentor_package_task_packs").insert({
            id: taskId,
            ...payload,
          });
          if (error) throw error;
        }

        if (onSaved) await onSaved();
      } catch (error) {
        console.error("mentor task pack save:", error);
        const limitMsg = window.RekabetliImageUploadLimit?.getLimitMessage?.(error);
        await showAlert(
          "Kaydedilemedi",
          limitMsg || error?.message || "Görev paketi kaydedilirken bir hata oluştu.",
        );
        statusEl.textContent = "Kayıt başarısız.";
      } finally {
        saveBtn.disabled = false;
        cancelBtn.disabled = false;
      }
    });

    return form;
  }

  function createTaskCard(task, { onEdit, onDelete, readOnly = false, activation = null } = {}) {
    const card = document.createElement("article");
    card.className = "mentor-task-pack-card";
    card.dataset.taskId = task.id;
    if (activation?.isActive || activation?.allActive) {
      card.classList.add("mentor-task-pack-card--active");
    }

    const head = document.createElement("div");
    head.className = "mentor-task-pack-card-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = "mentor-task-pack-card-title-wrap";

    const title = document.createElement("h3");
    title.className = "mentor-task-pack-card-title";
    title.textContent = task.title;

    titleWrap.appendChild(title);

    if (activation?.mode === "student") {
      const badge = document.createElement("span");
      badge.className = `mentor-task-pack-status-badge${activation.isActive ? " is-active" : ""}`;
      badge.textContent = activation.isActive ? "Aktif" : "Pasif";
      titleWrap.appendChild(badge);
    } else if (activation?.mode === "package") {
      const badge = document.createElement("span");
      badge.className = `mentor-task-pack-status-badge${activation.allActive ? " is-active" : ""}`;
      if (!activation.total) {
        badge.textContent = "Öğrenci yok";
      } else if (activation.allActive) {
        badge.textContent = `Tüm öğrencilerde aktif (${activation.total})`;
      } else if (activation.activeCount > 0) {
        badge.textContent = `${activation.activeCount}/${activation.total} öğrencide aktif`;
      } else {
        badge.textContent = "Pasif";
      }
      titleWrap.appendChild(badge);
    }

    const schedule = document.createElement("p");
    schedule.className = "mentor-task-pack-card-schedule";
    schedule.textContent = formatScheduleLabel(task);

    head.append(titleWrap, schedule);

    const desc = document.createElement("p");
    desc.className = "mentor-task-pack-card-desc";
    desc.textContent = task.description?.trim() || "Açıklama eklenmemiş.";

    const attachments = Array.isArray(task.attachments) ? task.attachments : [];
    let attachmentsEl = null;
    if (attachments.length) {
      attachmentsEl = document.createElement("div");
      attachmentsEl.className = "mentor-task-pack-card-attachments";
      attachments.forEach((att) => {
        attachmentsEl.appendChild(createAttachmentPreview(att));
      });
    }

    const actions = document.createElement("div");
    actions.className = "mentor-task-pack-card-actions";

    if (!readOnly) {
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "secondary mentor-task-pack-edit-btn";
      editBtn.textContent = "Düzenle";
      editBtn.addEventListener("click", () => onEdit(task));
      actions.appendChild(editBtn);

      if (activation?.onToggle) {
        const toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        const isOn =
          activation.mode === "student" ? activation.isActive : activation.allActive;
        toggleBtn.className = isOn
          ? "mentor-task-pack-stop-btn"
          : "mentor-task-pack-activate-btn";
        toggleBtn.textContent = isOn ? "Durdur" : "Aktifleştir";
        if (activation.mode === "package" && !activation.total) {
          toggleBtn.disabled = true;
          toggleBtn.title = "Pakette kayıtlı öğrenci yok";
        }
        toggleBtn.addEventListener("click", () => {
          void activation.onToggle(task);
        });
        actions.appendChild(toggleBtn);
      }

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "mentor-task-pack-delete-btn";
      deleteBtn.textContent = "Sil";
      deleteBtn.addEventListener("click", () => onDelete(task));
      actions.appendChild(deleteBtn);
    }

    card.append(head, desc);
    if (attachmentsEl) card.appendChild(attachmentsEl);
    if (!readOnly) card.appendChild(actions);
    return card;
  }

  async function mountStudentReadOnlySection({ panelEl, mentorId, packageId }) {
    if (!panelEl || !mentorId || !packageId) return;

    panelEl.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "mentor-inbox-empty";
    loading.textContent = "Görevler yükleniyor…";
    panelEl.appendChild(loading);

    let tasks = [];
    try {
      tasks = await fetchTaskPacks(mentorId, packageId);
    } catch (error) {
      console.error("student task packs load:", error);
      panelEl.replaceChildren();
      const err = document.createElement("p");
      err.className = "mentor-inbox-empty";
      err.textContent = error?.message?.includes("mentor_package_task_packs")
        ? "Görevler için veritabanı kurulumu gerekli."
        : "Görevler yüklenemedi.";
      panelEl.appendChild(err);
      return;
    }

    const listWrap = document.createElement("div");
    listWrap.className = "mentor-task-pack-list mentor-task-pack-student-readonly-list";
    if (!tasks.length) {
      const empty = document.createElement("p");
      empty.className = "mentor-inbox-empty mentor-task-pack-empty";
      empty.textContent = "Mentörünüz henüz size aktif görev atamadı.";
      listWrap.appendChild(empty);
    } else {
      tasks.forEach((task) => {
        listWrap.appendChild(createTaskCard(task, { readOnly: true }));
      });
    }

    panelEl.replaceChildren(listWrap);
  }

  async function mountSection({ panelEl, mentorId, packageId }) {
    if (!panelEl || !mentorId || !packageId) return;

    const packageIdSafe = String(packageId).replace(/[^a-zA-Z0-9_-]/g, "");

    panelEl.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "mentor-inbox-empty";
    loading.textContent = "Görev paketleri yükleniyor…";
    panelEl.appendChild(loading);

    let tasks = [];
    let studentIds = [];
    let activations = [];
    try {
      [tasks, studentIds, activations] = await Promise.all([
        fetchTaskPacks(mentorId, packageId),
        fetchPackageStudentIds(mentorId, packageId),
        fetchActivations(mentorId, packageId),
      ]);
    } catch (error) {
      console.error("mentor task packs load:", error);
      panelEl.replaceChildren();
      const err = document.createElement("p");
      err.className = "mentor-inbox-empty";
      err.textContent = error?.message?.includes("mentor_package_task")
        ? "Görev paketleri için veritabanı kurulumu gerekli."
        : "Görev paketleri yüklenemedi.";
      panelEl.appendChild(err);
      return;
    }

    const listWrap = document.createElement("div");
    listWrap.className = "mentor-task-pack-list";

    const formSlot = document.createElement("div");
    formSlot.className = "mentor-task-pack-form-slot";
    formSlot.hidden = true;

    const toolbar = document.createElement("div");
    toolbar.className = "mentor-task-pack-toolbar";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "mentor-task-pack-add-btn";
    addBtn.textContent = "Yeni görev paketi";

    toolbar.appendChild(addBtn);

    async function reloadAll() {
      [tasks, studentIds, activations] = await Promise.all([
        fetchTaskPacks(mentorId, packageId),
        fetchPackageStudentIds(mentorId, packageId),
        fetchActivations(mentorId, packageId),
      ]);
      renderList();
    }

    function renderList() {
      listWrap.replaceChildren();
      if (!tasks.length) {
        const empty = document.createElement("p");
        empty.className = "mentor-inbox-empty mentor-task-pack-empty";
        empty.textContent = "Henüz görev paketi yok. İlk paketi oluşturmak için butona tıklayın.";
        listWrap.appendChild(empty);
        return;
      }
      tasks.forEach((task) => {
        const summary = getPackageActivationSummary(activations, studentIds, task.id);
        listWrap.appendChild(
          createTaskCard(task, {
            onEdit: (item) => openForm(item),
            onDelete: (item) => {
              void deleteTask(item);
            },
            activation: {
              mode: "package",
              activeCount: summary.activeCount,
              total: summary.total,
              allActive: summary.allActive,
              onToggle: async (item) => {
                try {
                  if (!summary.total) {
                    await showAlert("Öğrenci yok", "Bu pakette kayıtlı öğrenci bulunmuyor.");
                    return;
                  }
                  const count = await setTaskActiveForPackageStudents(item.id, !summary.allActive);
                  if (!summary.allActive && count === 0) {
                    await showAlert("Aktifleştirilemedi", "Pakette kayıtlı öğrenci bulunamadı.");
                    return;
                  }
                  await reloadAll();
                } catch (error) {
                  console.error("package task activation:", error);
                  await showAlert(
                    "İşlem başarısız",
                    error?.message?.includes("mentor_package_task_activations")
                      ? "Aktivasyon için veritabanı kurulumu gerekli."
                      : "Görev durumu güncellenemedi.",
                  );
                }
              },
            },
          }),
        );
      });
    }

    function closeForm() {
      formSlot.hidden = true;
      formSlot.replaceChildren();
      addBtn.hidden = false;
    }

    function openForm(editingTask = null) {
      formSlot.hidden = false;
      formSlot.replaceChildren();
      addBtn.hidden = true;
      formSlot.appendChild(
        createTaskForm({
          mentorId,
          packageId,
          packageIdSafe,
          editingTask,
          onSaved: async () => {
            closeForm();
            panelEl.replaceChildren();
            const reload = document.createElement("p");
            reload.className = "mentor-inbox-empty";
            reload.textContent = "Güncelleniyor…";
            panelEl.append(reload);
            try {
              await reloadAll();
            } catch (error) {
              console.error("mentor task packs reload:", error);
            }
            panelEl.replaceChildren(toolbar, formSlot, listWrap);
            renderList();
          },
          onCancel: closeForm,
        }),
      );
      formSlot.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    async function deleteTask(task) {
      const confirmed = await window.rekabetliConfirm?.({
        title: "Görev paketini sil",
        message: `"${task.title}" silinsin mi? Bu işlem geri alınamaz.`,
        confirmLabel: "Sil",
        destructive: true,
      });
      if (!confirmed) return;

      const supabase = sb();
      const { error } = await supabase
        .from("mentor_package_task_packs")
        .delete()
        .eq("id", task.id)
        .eq("mentor_id", mentorId);
      if (error) {
        await showAlert("Silinemedi", error.message);
        return;
      }
      tasks = tasks.filter((row) => row.id !== task.id);
      renderList();
    }

    addBtn.addEventListener("click", () => openForm());

    panelEl.replaceChildren(toolbar, formSlot, listWrap);
    renderList();
  }

  async function mountStudentSection({ panelEl, mentorId, packageId, studentId }) {
    if (!panelEl || !mentorId || !packageId || !studentId) return;

    const packageIdSafe = String(packageId).replace(/[^a-zA-Z0-9_-]/g, "");
    const editFormIdSafe = `${packageIdSafe}-edit`;
    const newFormIdSafe = `${packageIdSafe}-new`;

    panelEl.replaceChildren();
    const loading = document.createElement("p");
    loading.className = "mentor-inbox-empty";
    loading.textContent = "Görev paketleri yükleniyor…";
    panelEl.appendChild(loading);

    let tasks = [];
    let activations = [];
    try {
      [tasks, activations] = await Promise.all([
        fetchTaskPacks(mentorId, packageId),
        fetchActivations(mentorId, packageId, { studentId }),
      ]);
    } catch (error) {
      console.error("mentor student task packs load:", error);
      panelEl.replaceChildren();
      const err = document.createElement("p");
      err.className = "mentor-inbox-empty";
      err.textContent = error?.message?.includes("mentor_package_task")
        ? "Görev paketleri için veritabanı kurulumu gerekli."
        : "Görev paketleri yüklenemedi.";
      panelEl.appendChild(err);
      return;
    }

    const listWrap = document.createElement("div");
    listWrap.className = "mentor-task-pack-list mentor-task-pack-student-list";

    const editFormSlot = document.createElement("div");
    editFormSlot.className = "mentor-task-pack-form-slot mentor-task-pack-student-edit-slot";
    editFormSlot.hidden = true;

    const newSection = document.createElement("section");
    newSection.className = "mentor-task-pack-student-new";

    const newTitle = document.createElement("h3");
    newTitle.className = "mentor-task-pack-student-new-title";
    newTitle.textContent = "Yeni görev ekle";

    const newFormHost = document.createElement("div");
    newFormHost.className = "mentor-task-pack-student-new-form";

    newSection.append(newTitle, newFormHost);

    async function reloadTasks() {
      [tasks, activations] = await Promise.all([
        fetchTaskPacks(mentorId, packageId),
        fetchActivations(mentorId, packageId, { studentId }),
      ]);
      renderList();
    }

    function renderList() {
      listWrap.replaceChildren();
      if (!tasks.length) {
        const empty = document.createElement("p");
        empty.className = "mentor-inbox-empty mentor-task-pack-empty";
        empty.textContent = "Henüz kayıtlı görev yok. Aşağıdan yeni görev ekleyebilirsiniz.";
        listWrap.appendChild(empty);
        return;
      }
      tasks.forEach((task) => {
        const isActive = isStudentTaskActive(activations, task.id, studentId);
        listWrap.appendChild(
          createTaskCard(task, {
            onEdit: (item) => openEditForm(item),
            onDelete: (item) => {
              void deleteTask(item);
            },
            activation: {
              mode: "student",
              isActive,
              onToggle: async (item) => {
                try {
                  await setTaskActiveForStudent(item.id, studentId, !isActive);
                  await reloadTasks();
                } catch (error) {
                  console.error("student task activation:", error);
                  await showAlert(
                    "İşlem başarısız",
                    error?.message?.includes("mentor_package_task_activations")
                      ? "Aktivasyon için veritabanı kurulumu gerekli."
                      : "Görev durumu güncellenemedi.",
                  );
                }
              },
            },
          }),
        );
      });
    }

    function closeEditForm() {
      editFormSlot.hidden = true;
      editFormSlot.replaceChildren();
    }

    function openEditForm(editingTask) {
      editFormSlot.hidden = false;
      editFormSlot.replaceChildren();
      editFormSlot.appendChild(
        createTaskForm({
          mentorId,
          packageId,
          packageIdSafe: editFormIdSafe,
          editingTask,
          onSaved: async () => {
            closeEditForm();
            try {
              await reloadTasks();
            } catch (error) {
              console.error("mentor student task packs reload:", error);
            }
          },
          onCancel: closeEditForm,
        }),
      );
      editFormSlot.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    async function deleteTask(task) {
      const confirmed = await window.rekabetliConfirm?.({
        title: "Görev paketini sil",
        message: `"${task.title}" silinsin mi? Bu işlem geri alınamaz.`,
        confirmLabel: "Sil",
        destructive: true,
      });
      if (!confirmed) return;

      const supabase = sb();
      const { error } = await supabase
        .from("mentor_package_task_packs")
        .delete()
        .eq("id", task.id)
        .eq("mentor_id", mentorId);
      if (error) {
        await showAlert("Silinemedi", error.message);
        return;
      }
      if (!editFormSlot.hidden) closeEditForm();
      tasks = tasks.filter((row) => row.id !== task.id);
      renderList();
    }

    function mountNewTaskForm() {
      newFormHost.replaceChildren();
      newFormHost.appendChild(
        createTaskForm({
          mentorId,
          packageId,
          packageIdSafe: newFormIdSafe,
          editingTask: null,
          onSaved: async () => {
            try {
              await reloadTasks();
            } catch (error) {
              console.error("mentor student task packs reload:", error);
            }
            mountNewTaskForm();
          },
          onCancel: null,
        }),
      );
      const cancelBtn = newFormHost.querySelector(".mentor-task-pack-cancel-btn");
      cancelBtn?.remove();
    }

    panelEl.replaceChildren(listWrap, editFormSlot, newSection);
    renderList();
    mountNewTaskForm();
  }

  window.RekabetliMentorPackageTasks = {
    mountSection,
    mountStudentSection,
    mountStudentReadOnlySection,
  };
})();
