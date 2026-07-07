(function initStudentPanelNotifications() {
  const STUDENT_PANEL_TYPES = [
    "mentor_meeting_proposal",
    "mentor_meeting_confirmed",
    "mentor_meeting_postpone",
    "mentor_meeting_refund_requested",
    "mentor_meeting_reminder_1d",
    "mentor_meeting_reminder_30m",
    "mentor_mentor_reply",
  ];

  function sb() {
    return window.getSupabase?.() || window.sb;
  }

  function isSafeUuid(value) {
    return window.RekabetliSecurity?.isValidUuid?.(value) || false;
  }

  function matchesEnrollment(row, enrollmentId, mentorId) {
    if (isSafeUuid(row.enrollment_id)) {
      return row.enrollment_id === enrollmentId;
    }
    if (row.type === "mentor_mentor_reply" && isSafeUuid(mentorId)) {
      return row.mentor_id === mentorId;
    }
    return false;
  }

  async function fetchUnreadRows(userId) {
    if (!userId) return [];

    const { data, error } = await sb()
      .from("notifications")
      .select("id, enrollment_id, type, mentor_id, conversation_id")
      .eq("user_id", userId)
      .is("read_at", null)
      .in("type", STUDENT_PANEL_TYPES);

    if (error) {
      console.warn("student panel notifications:", error.message);
      return [];
    }

    return Array.isArray(data) ? data : [];
  }

  async function countUnreadForEnrollment({ enrollmentId, mentorId, userId }) {
    if (!userId || !isSafeUuid(enrollmentId)) return 0;
    const rows = await fetchUnreadRows(userId);
    return rows.filter((row) => matchesEnrollment(row, enrollmentId, mentorId)).length;
  }

  async function countUnreadTotal(userId) {
    if (!userId) return 0;
    const rows = await fetchUnreadRows(userId);
    return rows.length;
  }

  async function countUnreadMentorReplies({ mentorId, conversationId, enrollmentId, userId }) {
    if (!userId || !isSafeUuid(mentorId)) return 0;
    const rows = await fetchUnreadRows(userId);
    return rows.filter((row) => {
      if (row.type !== "mentor_mentor_reply" || row.mentor_id !== mentorId) return false;
      if (isSafeUuid(enrollmentId) && isSafeUuid(row.enrollment_id)) {
        return row.enrollment_id === enrollmentId;
      }
      if (conversationId && row.conversation_id === conversationId) return true;
      if (!isSafeUuid(row.enrollment_id)) return true;
      return isSafeUuid(enrollmentId) && row.enrollment_id === enrollmentId;
    }).length;
  }

  async function markEnrollmentNotificationsRead({
    enrollmentId,
    mentorId,
    userId,
    includeMessageReplies = false,
  }) {
    if (!userId || !isSafeUuid(enrollmentId)) return;

    const rows = await fetchUnreadRows(userId);
    const ids = rows
      .filter((row) => {
        if (!matchesEnrollment(row, enrollmentId, mentorId)) return false;
        if (!includeMessageReplies && row.type === "mentor_mentor_reply") return false;
        return true;
      })
      .map((row) => row.id);

    if (!ids.length) return;

    const { error } = await sb()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids)
      .eq("user_id", userId);

    if (error) {
      console.warn("mark student enrollment notifications read:", error.message);
    }
  }

  async function markMentorReplyNotificationsRead({
    mentorId,
    conversationId,
    enrollmentId,
    userId,
  }) {
    if (!userId || !isSafeUuid(mentorId)) return;

    const rows = await fetchUnreadRows(userId);
    const ids = rows
      .filter((row) => {
        if (row.type !== "mentor_mentor_reply" || row.mentor_id !== mentorId) return false;
        if (isSafeUuid(enrollmentId) && isSafeUuid(row.enrollment_id)) {
          return row.enrollment_id === enrollmentId;
        }
        if (conversationId && row.conversation_id === conversationId) return true;
        if (!isSafeUuid(row.enrollment_id)) return true;
        return isSafeUuid(enrollmentId) && row.enrollment_id === enrollmentId;
      })
      .map((row) => row.id);

    if (!ids.length) return;

    const { error } = await sb()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids)
      .eq("user_id", userId);

    if (error) {
      console.warn("mark mentor reply notifications read:", error.message);
    }
  }

  let onGlobalRefresh = null;

  function hookGlobalRefresh() {
    const notifications = window.rekabetliNotifications;
    if (!notifications || notifications.__studentPanelHooked) return;

    const originalRefresh = notifications.refresh?.bind(notifications);
    notifications.refresh = async () => {
      if (originalRefresh) await originalRefresh();
      if (typeof onGlobalRefresh === "function") {
        await onGlobalRefresh();
      }
    };
    notifications.__studentPanelHooked = true;
  }

  window.RekabetliStudentPanelNotifications = {
    types: STUDENT_PANEL_TYPES,
    countUnreadForEnrollment,
    countUnreadTotal,
    countUnreadMentorReplies,
    markEnrollmentNotificationsRead,
    markMentorReplyNotificationsRead,
    set onGlobalRefresh(callback) {
      onGlobalRefresh = callback;
      hookGlobalRefresh();
    },
  };

  hookGlobalRefresh();
})();
