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
    const isOwner = session?.user?.id === mentorId;

    if (!vitrin.isVitrinReviewApproved(pageRow) && !isOwner) {
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
      enableWatch: session?.user?.id !== page.userId,
    });

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
      if (checkoutContext && page.vitrinActive && vitrin.isVitrinReviewApproved(pageRow)) {
        void vitrin.startPackageCheckout?.(checkoutContext);
      }
    }
  }

  void boot();
})();
