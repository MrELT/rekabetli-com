(function initMentorPanelShell() {

  const MOBILE_MQ = "(max-width: 760px)";



  function initMobileSidebar() {

    const shell = document.querySelector(".mentor-panel-shell");

    const sidebar = shell?.querySelector(".mentor-panel-sidebar");

    const content = shell?.querySelector(".mentor-panel-content");

    if (!shell || !sidebar || !content) return;



    if (!sidebar.id) {

      sidebar.id = "mentor-panel-sidebar";

    }



    let toggle = shell.querySelector(".mentor-panel-mobile-toggle");

    if (!toggle) {

      toggle = document.createElement("button");

      toggle.type = "button";

      toggle.className = "mentor-panel-mobile-toggle";

      toggle.setAttribute("aria-expanded", "false");

      toggle.setAttribute("aria-controls", sidebar.id);

      toggle.textContent = "Menüyü Aç";

      content.insertBefore(toggle, content.firstChild);

    }



    let backdrop = shell.querySelector(".mentor-panel-mobile-backdrop");

    if (!backdrop) {

      backdrop = document.createElement("div");

      backdrop.className = "mentor-panel-mobile-backdrop";

      backdrop.hidden = true;

      shell.insertBefore(backdrop, sidebar);

    }



    let closeBtn = sidebar.querySelector(".mentor-panel-mobile-close");

    if (!closeBtn) {

      closeBtn = document.createElement("button");

      closeBtn.type = "button";

      closeBtn.className = "secondary mentor-panel-mobile-close";

      closeBtn.textContent = "Menüyü Kapat";

      sidebar.appendChild(closeBtn);

    }



    const mq = window.matchMedia(MOBILE_MQ);



    function setOpen(open) {

      shell.classList.toggle("is-sidebar-open", open);

      toggle.setAttribute("aria-expanded", open ? "true" : "false");

      toggle.textContent = open ? "Menüyü Kapat" : "Menüyü Aç";

      closeBtn.hidden = !open || !mq.matches;

      backdrop.hidden = !open;

      document.body.classList.toggle("mentor-panel-menu-open", open);

    }



    function closeMenu() {

      setOpen(false);

    }



    toggle.addEventListener("click", () => {

      setOpen(!shell.classList.contains("is-sidebar-open"));

    });



    backdrop.addEventListener("click", closeMenu);

    closeBtn.addEventListener("click", closeMenu);



    sidebar.addEventListener("click", (event) => {

      if (!mq.matches) return;

      if (event.target.closest(".mentor-panel-nav-btn")) {

        closeMenu();

      }

    });



    mq.addEventListener("change", () => {

      if (!mq.matches) {

        closeMenu();

      }

    });



    setOpen(false);

  }



  if (document.readyState === "loading") {

    document.addEventListener("DOMContentLoaded", initMobileSidebar);

  } else {

    initMobileSidebar();

  }

})();

