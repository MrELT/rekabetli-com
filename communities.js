// Menü Kontrolü (Garanti Yöntem - En üstte ve bağımsız)
document.addEventListener("click", (event) => {
  const mobileMenu = document.getElementById("mobile-menu");
  if (!mobileMenu) return;

  // Menüyü Açma (Hamburger ikonu)
  if (event.target.closest("#open-mobile-menu")) {
    mobileMenu.hidden = false;
  }
  
  // Menüyü Kapatma (X ikonu veya siyah arka plan)
  if (event.target.closest("#close-mobile-menu") || event.target.id === "mobile-menu") {
    mobileMenu.hidden = true;
  }
});

const supabaseClient = window.sb;

function formatDate(isoDate) {
  return new Date(isoDate).toLocaleString("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// DOM Elemanları
const form = document.getElementById("question-form");
const questionList = document.getElementById("question-list");
const resetBtn = document.getElementById("reset-btn");
const template = document.getElementById("question-template");
const questionModal = document.getElementById("question-modal");
const openQuestionModalButtons = document.querySelectorAll(".js-open-question-modal");
const closeQuestionModalBtn = document.getElementById("close-question-modal");

const desktopProfileBtn = document.getElementById("desktop-profile-btn");
const mobileProfileBtn = document.getElementById("mobile-profile-btn");

let questions = [];

// --- Modal Fonksiyonları ---
function openQuestionModal() {
  if (questionModal) questionModal.hidden = false;
}

function closeQuestionModal() {
  if (questionModal) questionModal.hidden = true;
}

// --- Veritabanı ve Oturum İşlemleri ---
async function syncCommunitiesProfileNav() {
  if (typeof window.syncProfileNavState === "function") {
    await window.syncProfileNavState();
    return;
  }

  const { data, error } = await supabaseClient.auth.getSession();
  if (error) {
    console.error("Session check error:", error.message);
  }
  const isLoggedIn = Boolean(data?.session);
  const label = isLoggedIn ? "Profil" : "Giriş Yap";
  let targetHref = isLoggedIn ? "/ogrenci-sayfam#profil" : "/login";

  if (isLoggedIn && window.RekabetliPanelHome?.resolve) {
    const panelHome = await window.RekabetliPanelHome.resolve(data.session.user);
    targetHref =
      window.RekabetliPanelHome.withProfileTab?.(panelHome) || `${panelHome}#profil`;
  }

  if (desktopProfileBtn) {
    desktopProfileBtn.textContent = label;
    desktopProfileBtn.setAttribute("href", targetHref);
  }
  if (mobileProfileBtn) {
    mobileProfileBtn.textContent = label;
    mobileProfileBtn.setAttribute("href", targetHref);
  }
}

function renderAnswers(container, answers) {
  container.replaceChildren();
  if (!answers.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Henüz yanıt yok.";
    container.appendChild(empty);
    return;
  }

  answers.forEach((answer) => {
    const answerEl = document.createElement("div");
    answerEl.className = "answer";

    const header = document.createElement("div");
    header.className = "answer-header";
    const author = document.createElement("strong");
    author.textContent = answer.author;
    header.append(author, document.createTextNode(` · ${formatDate(answer.createdAt)}`));

    const content = document.createElement("div");
    content.className = "rich-content";
    window.RekabetliQuill?.renderRichContent(content, answer.content);

    answerEl.append(header, content);
    container.appendChild(answerEl);
  });
}

function mapPostRow(postRow) {
  return {
    id: postRow.id,
    author: postRow.author,
    title: postRow.title,
    content: postRow.content,
    createdAt: postRow.created_at,
    answers: [],
  };
}

function mapCommentRow(commentRow) {
  return {
    id: commentRow.id,
    postId: commentRow.post_id,
    author: commentRow.author,
    content: commentRow.content,
    createdAt: commentRow.created_at,
  };
}

async function loadPosts() {
  const { data: postRows, error: postsError } = await supabaseClient
    .from("posts")
    .select("id, author, title, content, created_at")
    .order("created_at", { ascending: false });

  if (postsError) {
    console.error("Posts load error:", postsError.message);
    if (questionList) {
      questionList.replaceChildren();
      window.RekabetliSecurity?.appendEmptyMessage(
        questionList,
        "Veriler yüklenemedi. Tablo ve RLS ayarlarını kontrol et."
      );
    }
    return;
  }

  const mappedPosts = (postRows ?? []).map(mapPostRow);
  const postIds = mappedPosts.map((post) => post.id);

  let commentRows = [];
  if (postIds.length > 0) {
    const { data, error: commentsError } = await supabaseClient
      .from("comments")
      .select("id, post_id, author, content, created_at")
      .in("post_id", postIds)
      .order("created_at", { ascending: false });

    if (commentsError) {
      console.error("Comments load error:", commentsError.message);
    } else {
      commentRows = data ?? [];
    }
  }

  const commentsByPostId = new Map();
  commentRows.map(mapCommentRow).forEach((comment) => {
    const list = commentsByPostId.get(comment.postId) ?? [];
    list.push(comment);
    commentsByPostId.set(comment.postId, list);
  });

  questions = mappedPosts.map((post) => ({
    ...post,
    answers: commentsByPostId.get(post.id) ?? [],
  }));

  renderQuestions();
}

async function savePost({ author, title, content }) {
  const { data, error } = await supabaseClient
    .from("posts")
    .insert([{ author, title, content }])
    .select("id, author, title, content, created_at")
    .single();

  if (error) throw error;
  return mapPostRow(data);
}

async function saveComment({ postId, author, content }) {
  const { data, error } = await supabaseClient
    .from("comments")
    .insert([{ post_id: postId, author, content }])
    .select("id, post_id, author, content, created_at")
    .single();

  if (error) throw error;
  return mapCommentRow(data);
}

function renderQuestions() {
  if (!questionList) return;
  
  questionList.replaceChildren();
  if (!questions.length) {
    window.RekabetliSecurity?.appendEmptyMessage(
      questionList,
      "Henüz soru yok. İlk soruyu sen ekleyebilirsin."
    );
    return;
  }

  const ordered = [...questions].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  ordered.forEach((question) => {
    const fragment = template.content.cloneNode(true);

    fragment.querySelector(".question-title").textContent = question.title;
    fragment.querySelector(".question-meta").textContent = `${question.author} · ${formatDate(question.createdAt)}`;
    const questionContentEl = fragment.querySelector(".question-content");
    window.RekabetliQuill?.renderRichContent(questionContentEl, question.content);

    const answersContainer = fragment.querySelector(".answers");
    renderAnswers(answersContainer, question.answers);

    const answerToggleBtn = fragment.querySelector(".answer-toggle-btn");
    const answerForm = fragment.querySelector(".answer-form");
    
    answerToggleBtn.addEventListener("click", () => {
      const shouldShowForm = answerForm.hidden;
      answerForm.hidden = !shouldShowForm;
      answerToggleBtn.textContent = shouldShowForm ? "Vazgeç" : "Cevapla";
    });

    answerForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(answerForm);
      const answerAuthor = String(data.get("answerAuthor")).trim();
      const answerContent = String(data.get("answerContent")).trim();

      if (!answerAuthor || !answerContent) return;

      try {
        const newComment = await saveComment({
          postId: question.id,
          author: answerAuthor,
          content: answerContent,
        });

        const target = questions.find((q) => q.id === question.id);
        if (target) {
          target.answers.unshift(newComment);
          renderQuestions();
        }
      } catch (error) {
        console.error("Comment insert error:", error.message);
        alert("Yanıt kaydedilemedi. Supabase tablo izinlerini kontrol et.");
      }
    });

    questionList.appendChild(fragment);
  });
}

// --- Event Listeners (Tıklama Olayları) ---
document.addEventListener("DOMContentLoaded", () => {
  
  // Başlangıç durumu
  closeQuestionModal();
  
  // Yeni Soru Ekleme Formu
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);

      const author = String(data.get("author")).trim();
      const title = String(data.get("title")).trim();
      const content = String(data.get("content")).trim();

      if (!author || !title || !content) return;

      try {
        const newPost = await savePost({ author, title, content });
        questions.unshift({ ...newPost, answers: [] });
        form.reset();
        closeQuestionModal();
        renderQuestions();
      } catch (error) {
        console.error("Post insert error:", error.message);
        alert("Soru kaydedilemedi. Supabase tablo izinlerini kontrol et.");
      }
    });
  }

  // Soru Sor Butonları
  openQuestionModalButtons.forEach((button) => {
    button.addEventListener("click", () => {
      // mobileMenu kapatma mantığını da garantiye alalım
      const mobileMenu = document.getElementById("mobile-menu");
      if (mobileMenu) mobileMenu.hidden = true;
      openQuestionModal();
    });
  });

  // Modal Kapatma Butonu
  closeQuestionModalBtn?.addEventListener("click", closeQuestionModal);
  
  // Modal Dışına Tıklayınca Kapanma Mantığı
  questionModal?.addEventListener("click", (event) => {
    if (event.target === questionModal) closeQuestionModal();
  });

  // ESC Tuşuna Basınca Kapanma
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (questionModal && !questionModal.hidden) closeQuestionModal();
      const mobileMenu = document.getElementById("mobile-menu");
      if (mobileMenu && !mobileMenu.hidden) mobileMenu.hidden = true;
    }
  });

  resetBtn?.addEventListener("click", () => {
    loadPosts();
  });

  // İlk Yüklemeler
  supabaseClient.auth.onAuthStateChange(() => {
    syncCommunitiesProfileNav();
  });

  syncCommunitiesProfileNav();
  loadPosts();
});