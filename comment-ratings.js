(function initCommentRatings() {
  const MIN_SCORE = 1;
  const MAX_SCORE = 5;

  function getClient() {
    return window.getSupabase?.() || window.sb;
  }

  function buildStats(ratingRows, currentUserId) {
    const byCommentId = new Map();
    const myRatingByCommentId = new Map();

    (ratingRows ?? []).forEach((row) => {
      const commentId = row.comment_id;
      const agg = byCommentId.get(commentId) ?? { sum: 0, count: 0 };
      agg.sum += Number(row.score) || 0;
      agg.count += 1;
      byCommentId.set(commentId, agg);

      if (currentUserId && row.rater_user_id === currentUserId) {
        myRatingByCommentId.set(commentId, Number(row.score) || 0);
      }
    });

    return { byCommentId, myRatingByCommentId };
  }

  function enrichComments(comments, stats) {
    const { byCommentId, myRatingByCommentId } = stats;
    comments.forEach((comment) => {
      const agg = byCommentId.get(comment.id);
      comment.ratingCount = agg?.count ?? 0;
      comment.ratingAvg = agg && agg.count > 0 ? agg.sum / agg.count : null;
      comment.myRating = myRatingByCommentId.get(comment.id) ?? null;
    });
    return comments;
  }

  async function loadStatsForCommentIds(commentIds, currentUserId) {
    const supabase = getClient();
    if (!supabase || !commentIds.length) {
      return { byCommentId: new Map(), myRatingByCommentId: new Map() };
    }

    const { data, error } = await supabase
      .from("comment_ratings")
      .select("comment_id, rater_user_id, score")
      .in("comment_id", commentIds);

    if (error) {
      console.error("Comment ratings load error:", error.message);
      return { byCommentId: new Map(), myRatingByCommentId: new Map() };
    }

    return buildStats(data, currentUserId);
  }

  function formatAvg(avg) {
    if (avg == null || Number.isNaN(avg)) return "—";
    return (Math.round(avg * 10) / 10).toLocaleString("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function renderSummaryEl(answer) {
    const summary = document.createElement("span");
    summary.className = "answer-rating-summary";
    summary.setAttribute("aria-live", "polite");

    const count = answer.ratingCount ?? 0;
    const avg = answer.ratingAvg;

    if (count === 0) {
      summary.textContent = "Henüz puan yok";
      return summary;
    }

    const avgEl = document.createElement("strong");
    avgEl.className = "answer-rating-avg";
    avgEl.textContent = formatAvg(avg);

    summary.append("Ortalama ", avgEl, ` / 5 · ${count} değerlendirme`);
    return summary;
  }

  function renderRatingBlock(answerEl, answer, options = {}) {
    const {
      currentUserId = null,
      isLoggedIn = false,
      onRequireLogin = () => {
        window.location.href = "/login";
      },
      onRated = null,
    } = options;

    const existing = answerEl.querySelector(".answer-rating-block");
    if (existing) existing.remove();

    const block = document.createElement("div");
    block.className = "answer-rating-block";

    const head = document.createElement("div");
    head.className = "answer-rating-head";

    const label = document.createElement("span");
    label.className = "answer-rating-label";
    label.textContent = "Bu yanıt ne kadar faydalı?";

    head.append(label, renderSummaryEl(answer));
    block.appendChild(head);

    const isOwner = Boolean(currentUserId && answer.userId && answer.userId === currentUserId);
    const canRate = Boolean(isLoggedIn && currentUserId && answer.userId && !isOwner);

    if (canRate) {
      const row = document.createElement("div");
      row.className = "answer-rating-controls";

      const starsWrap = document.createElement("div");
      starsWrap.className = "answer-rating-stars";
      starsWrap.setAttribute("role", "group");
      starsWrap.setAttribute("aria-label", "Faydalılık puanı ver");

      const buttons = [];

      for (let score = MIN_SCORE; score <= MAX_SCORE; score += 1) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "answer-rating-star";
        btn.dataset.score = String(score);
        btn.title = `${score} — ${score === 1 ? "Az faydalı" : score === 5 ? "Çok faydalı" : `${score} puan`}`;
        btn.setAttribute("aria-label", `${score} puan`);

        const num = document.createElement("span");
        num.className = "answer-rating-star-num";
        num.textContent = String(score);
        btn.appendChild(num);

        if (answer.myRating === score) {
          btn.classList.add("is-selected");
          btn.setAttribute("aria-pressed", "true");
        } else {
          btn.setAttribute("aria-pressed", "false");
        }

        btn.addEventListener("click", async () => {
          if (btn.disabled) return;
          buttons.forEach((b) => {
            b.disabled = true;
          });

          try {
            const result = await submitRating(answer.id, score);
            answer.ratingAvg = result.ratingAvg;
            answer.ratingCount = result.ratingCount;
            answer.myRating = result.myRating;
            renderRatingBlock(answerEl, answer, options);
            onRated?.(answer);
          } catch (err) {
            console.error("Rating submit error:", err?.message || err);
            await rekabetliAlert?.({
              title: "Puan kaydedilemedi",
              message: err?.message || "Bağlantı veya izinleri kontrol edin.",
            });
            buttons.forEach((b) => {
              b.disabled = false;
            });
          }
        });

        buttons.push(btn);
        starsWrap.appendChild(btn);
      }

      row.appendChild(starsWrap);

      if (answer.myRating) {
        const yours = document.createElement("span");
        yours.className = "answer-rating-yours";
        yours.textContent = `Sizin puanınız: ${answer.myRating}`;
        row.appendChild(yours);
      }

      block.appendChild(row);
    } else if (!isLoggedIn && answer.userId) {
      const hint = document.createElement("p");
      hint.className = "answer-rating-hint";
      hint.textContent = "Puan vermek için giriş yapın.";
      block.appendChild(hint);
    } else if (isOwner) {
      const hint = document.createElement("p");
      hint.className = "answer-rating-hint";
      hint.textContent = "Kendi yanıtınıza puan veremezsiniz.";
      block.appendChild(hint);
    }

    answerEl.appendChild(block);
  }

  async function submitRating(commentId, score) {
    const supabase = getClient();
    if (!supabase) throw new Error("Bağlantı kurulamadı.");

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user?.id) throw new Error("Giriş yapmanız gerekiyor.");

    const safeScore = Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(Number(score) || 0)));
    if (safeScore < MIN_SCORE) throw new Error("Geçersiz puan.");

    const row = {
      comment_id: commentId,
      rater_user_id: session.user.id,
      score: safeScore,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("comment_ratings").upsert(row, { onConflict: "comment_id,rater_user_id" });

    if (error) throw error;

    const stats = await loadStatsForCommentIds([commentId], session.user.id);
    const agg = stats.byCommentId.get(commentId);

    return {
      myRating: stats.myRatingByCommentId.get(commentId) ?? safeScore,
      ratingCount: agg?.count ?? 0,
      ratingAvg: agg && agg.count > 0 ? agg.sum / agg.count : null,
    };
  }

  function getProfileRatingDisplay(profile) {
    const count = Number(profile?.answer_rating_count) || 0;
    const sum = Number(profile?.answer_rating_sum) || 0;
    if (count === 0) return null;
    const avg = sum / count;
    return { avg, count };
  }

  window.RekabetliCommentRatings = {
    MIN_SCORE,
    MAX_SCORE,
    buildStats,
    enrichComments,
    loadStatsForCommentIds,
    renderRatingBlock,
    submitRating,
    formatAvg,
    getProfileRatingDisplay,
  };
})();
