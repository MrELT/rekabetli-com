(function initMentorPublicPage() {
  const supabase = window.getSupabase?.() || window.sb;
  const vitrin = window.RekabetliMentorVitrin;
  const params = new URLSearchParams(window.location.search);
  const mentorId = params.get("id");

  const statusEl = document.getElementById("mentor-public-status");
  const showcaseEl = document.getElementById("mentor-public-showcase");
  let availabilityUi = null;

  if (!supabase || !vitrin) {
    if (statusEl) statusEl.textContent = "Sayfa yüklenemedi.";
    return;
  }

  if (!vitrin.isValidMentorId(mentorId)) {
    if (statusEl) statusEl.textContent = "Geçersiz mentör bağlantısı.";
    return;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function renderPublicPage(page, packageFillCounts = new Map(), viewOptions = {}) {
    document.title = `${page.displayName} — Mentör | rekabetli.com`;

    const nameEl = document.getElementById("mentor-display-name");
    const photoImg = document.getElementById("mentor-photo-img");
    const photoFallback = document.getElementById("mentor-photo-fallback");
    const summaryBranches = document.getElementById("mentor-summary-branches");
    const summaryLessons = document.getElementById("mentor-summary-lessons");
    const aboutContent = document.getElementById("mentor-about-content");
    const branchesList = document.getElementById("mentor-public-branches");
    const lessonsList = document.getElementById("mentor-public-lessons");
    const packagesList = document.getElementById("mentor-public-packages");

    vitrin.applyVitrinShellAccent(showcaseEl, page.vitrinAccent);

    if (nameEl) nameEl.textContent = page.displayName;
    availabilityUi = vitrin.mountVitrinAvailabilityUI?.(
      document.getElementById("mentor-vitrin-availability-slot"),
      {
        vitrinActive: page.vitrinActive,
        mentorId: page.userId,
        mentorName: page.displayName,
        enableWatch: viewOptions.enableWatch !== false,
      },
    );

    if (page.photoUrl) {
      vitrin.setSafeImage(photoImg, page.photoUrl, { alt: page.displayName });
      if (photoFallback) photoFallback.hidden = true;
    } else if (photoFallback) {
      photoFallback.textContent = vitrin.getInitials(page.displayName);
      photoFallback.hidden = false;
      if (photoImg) photoImg.hidden = true;
    }

    vitrin.fillSummaryList(summaryBranches, page.branches, "Branş bilgisi yok", "branch");
    vitrin.fillSummaryList(summaryLessons, page.lessons, "Ders bilgisi yok", "lesson");
    vitrin.fillAboutContent(aboutContent, page.about);

    vitrin.renderVitrinBranches(branchesList, page.branches, "Henüz branş eklenmemiş.");
    vitrin.renderVitrinLessons(lessonsList, page.lessons, "Henüz özel ders eklenmemiş.");
    vitrin.renderVitrinPackages(packagesList, page.packages, "Henüz paket eklenmemiş.", {
      mentorId: page.userId,
      mentorName: page.displayName,
      packageFillCounts,
      mentorAcceptsPayments: page.vitrinActive,
    });

    if (statusEl) statusEl.hidden = true;
    if (showcaseEl) showcaseEl.hidden = false;

    const messagingRoot = document.getElementById("mentor-student-messaging");
    if (messagingRoot && window.RekabetliMentorMessaging?.mountStudentPanel) {
      const deepLink = window.RekabetliMentorMessaging.parseStudentMessagingDeepLink?.() || null;
      void window.RekabetliMentorMessaging.mountStudentPanel({
        root: messagingRoot,
        mentorId: page.userId,
        mentorName: page.displayName,
        deepLink,
      });
    }
  }

  async function isCurrentUserAdmin(userId) {
    if (!userId) return false;
    const { data, error } = await supabase
      .from("admin_users")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.warn("admin check:", error.message);
      return false;
    }
    return Boolean(data?.user_id);
  }

  function showAdminPreviewBanner(reviewStatus) {
    if (!showcaseEl) return;
    let banner = document.getElementById("mentor-admin-preview-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "mentor-admin-preview-banner";
      banner.className = "mentor-admin-preview-banner";
      showcaseEl.prepend(banner);
    }
    const label =
      window.RekabetliMentorVitrin?.vitrinReviewStatusLabel?.(reviewStatus) ||
      String(reviewStatus || "pending");
    banner.textContent = `Admin önizleme — bu vitrin henüz halka açık değil (${label}).`;
    banner.hidden = false;
  }

  async function boot() {
    setStatus("Mentör profili yükleniyor…");

    const [{ data: profile, error: profileError }, { data: pageRow, error: pageError }] =
      await Promise.all([
        supabase
          .from("profiles")
          .select("id, display_name, is_mentor, avatar_url")
          .eq("id", mentorId)
          .eq("is_mentor", true)
          .maybeSingle(),
        supabase
          .from("mentor_pages")
          .select("user_id, photo_url, vitrin_accent, about, branches, private_lessons, packages, meeting_platform, meeting_link, vitrin_active, vitrin_review_status")
          .eq("user_id", mentorId)
          .maybeSingle(),
      ]);

    if (profileError || pageError) {
      console.error("mentor public:", profileError?.message || pageError?.message);
      setStatus("Mentör profili yüklenemedi.");
      return;
    }

    if (!profile || !pageRow) {
      setStatus("Mentör profili bulunamadı.");
      return;
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const viewerId = session?.user?.id ?? null;
    const isOwner = viewerId === mentorId;
    const isAdmin = await isCurrentUserAdmin(viewerId);
    const isApproved = vitrin.isVitrinReviewApproved(pageRow);

    if (!isApproved && !isOwner && !isAdmin) {
      setStatus("Mentör profili bulunamadı.");
      return;
    }

    const page = vitrin.normalizePageRow({ ...pageRow, profiles: profile });
    if (!page) {
      setStatus("Mentör profili bulunamadı.");
      return;
    }

    const fillCounts = await vitrin.fetchPackageFillCounts(supabase, mentorId);
    renderPublicPage(page, fillCounts, {
      enableWatch: Boolean(viewerId) && viewerId !== page.userId && isApproved,
    });

    if (isAdmin && !isApproved) {
      showAdminPreviewBanner(pageRow.vitrin_review_status);
    }

    if (params.get("watchVitrin") === "1" && availabilityUi?.subscribeIfPending) {
      void availabilityUi.subscribeIfPending();
    }

    if (params.get("openCheckout") === "1") {
      const packageId = params.get("packageId");
      const pending = vitrin.restorePendingPackageCheckoutFromStorage?.();
      const checkoutContext =
        pending ||
        (vitrin.isValidMentorId(mentorId) && packageId
          ? {
              mentorId,
              packageId,
              title: "Paket",
              mentorAcceptsPayments: page.vitrinActive,
            }
          : null);
      if (checkoutContext && page.vitrinActive && isApproved) {
        void vitrin.startPackageCheckout?.(checkoutContext);
      }
    }
  }

  void boot();
})();
