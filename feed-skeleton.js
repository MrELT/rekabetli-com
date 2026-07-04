(function initFeedSkeleton() {
  const SKELETON_COUNT = 3;

  function createSkeletonLine(className) {
    const line = document.createElement("span");
    line.className = `bento-skeleton bento-skeleton-line ${className}`;
    line.setAttribute("aria-hidden", "true");
    return line;
  }

  function createSkeletonCard(index) {
    const card = document.createElement("article");
    card.className = "question-card question-card-skeleton";
    card.setAttribute("aria-hidden", "true");

    const head = document.createElement("div");
    head.className = "feed-skeleton-head";

    const avatar = document.createElement("span");
    avatar.className = "bento-skeleton feed-skeleton-avatar";
    avatar.setAttribute("aria-hidden", "true");

    const body = document.createElement("div");
    body.className = "feed-skeleton-body";
    body.append(
      createSkeletonLine("feed-skeleton-line-title"),
      createSkeletonLine("feed-skeleton-line-meta"),
      createSkeletonLine("feed-skeleton-line-content"),
      createSkeletonLine("feed-skeleton-line-content feed-skeleton-line-content--short"),
    );

    head.append(avatar, body);

    const actions = document.createElement("div");
    actions.className = "feed-skeleton-actions";

    for (let i = 0; i < 2; i += 1) {
      const action = document.createElement("span");
      action.className = "bento-skeleton feed-skeleton-action";
      action.setAttribute("aria-hidden", "true");
      actions.appendChild(action);
    }

    card.append(head, actions);

    if (index > 0) {
      card.style.setProperty("--feed-skeleton-delay", `${index * 0.1}s`);
    }

    return card;
  }

  function setFeedLoadingState(container) {
    if (!container) return;
    container.classList.add("is-loading");
    container.setAttribute("aria-busy", "true");
    container.replaceChildren();
    for (let i = 0; i < SKELETON_COUNT; i += 1) {
      container.appendChild(createSkeletonCard(i));
    }
  }

  function clearFeedLoadingState(container) {
    if (!container) return;
    container.classList.remove("is-loading");
    container.setAttribute("aria-busy", "false");
  }

  window.RekabetliFeedSkeleton = {
    setFeedLoadingState,
    clearFeedLoadingState,
  };
})();
