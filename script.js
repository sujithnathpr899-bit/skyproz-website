const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu-toggle]");
const navigation = document.querySelector("[data-navigation]");
const year = document.querySelector("#year");
const revealItems = document.querySelectorAll(".reveal");
const projectFilters = document.querySelectorAll("[data-filter]");
const projectCards = document.querySelectorAll("[data-category]");
const lightbox = document.querySelector("[data-lightbox-modal]");
const lightboxTitle = document.querySelector("[data-lightbox-title]");
const lightboxClose = document.querySelector("[data-lightbox-close]");
const workerDropdown = document.querySelector(".nav-dropdown");
const workerDropdownToggle = document.querySelector(".nav-dropdown-toggle");

if (year) year.textContent = new Date().getFullYear();

if (menuButton && navigation) {
  menuButton.addEventListener("click", () => {
    const isOpen = navigation.classList.toggle("is-open");
    menuButton.setAttribute("aria-expanded", String(isOpen));
  });

  navigation.addEventListener("click", (event) => {
    if (event.target instanceof HTMLAnchorElement) {
      navigation.classList.remove("is-open");
      menuButton.setAttribute("aria-expanded", "false");
    }
  });
}


if (workerDropdown && workerDropdownToggle) {
  workerDropdownToggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = workerDropdown.classList.toggle("is-open");
    workerDropdownToggle.setAttribute("aria-expanded", String(isOpen));
  });
  document.addEventListener("click", () => {
    workerDropdown.classList.remove("is-open");
    workerDropdownToggle.setAttribute("aria-expanded", "false");
  });
}

const workerAccount = document.querySelector("[data-worker-account]");
const workerMenu = document.querySelector("[data-worker-menu]");

function workerDashboardLinks(useButtons = false) {
  const items = [
    ["Dashboard", "/workers/dashboard"],
    ["My Profile", "/workers/profile"],
    ["My Applications", "/workers/dashboard#applications"],
    ["Saved Jobs", "/workers/dashboard#saved-jobs"],
    ["Messages", "/workers/dashboard#messages"]
  ];
  const links = items.map(([label, href]) => `<a href="${href}">${label}</a>`).join("");
  const logout = useButtons ? '<button type="button" data-worker-logout>Logout</button>' : '<button type="button" data-worker-logout>Logout</button>';
  return `${links}${logout}`;
}

function renderWorkerHeader(worker) {
  if (workerAccount) {
    if (worker) {
      workerAccount.innerHTML = `<div class="worker-account-dropdown">
        <button class="button button-small button-gold worker-account-toggle" type="button" aria-expanded="false">My Dashboard</button>
        <div class="worker-account-menu" role="menu" aria-label="Worker account menu">${workerDashboardLinks(true)}</div>
      </div>`;
      const dropdown = workerAccount.querySelector(".worker-account-dropdown");
      const toggle = workerAccount.querySelector(".worker-account-toggle");
      toggle?.addEventListener("click", (event) => {
        event.stopPropagation();
        const isOpen = dropdown.classList.toggle("is-open");
        toggle.setAttribute("aria-expanded", String(isOpen));
      });
      document.addEventListener("click", () => {
        dropdown?.classList.remove("is-open");
        toggle?.setAttribute("aria-expanded", "false");
      });
    } else {
      workerAccount.innerHTML = '<a class="button button-small button-gold" href="/workers/signup">Join Our Workforce</a>';
    }
  }

  if (workerMenu) {
    workerMenu.innerHTML = worker
      ? workerDashboardLinks(true)
      : '<a href="/workers">Find Opportunities</a><a href="/workers/login">Worker Login</a><a href="/workers/signup">Worker Sign Up</a><a href="/workers/dashboard">My Dashboard</a>';
  }

  document.querySelectorAll("[data-worker-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      await fetch("/api/workers/auth/logout", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      window.location.href = "/workers/login";
    });
  });
}

async function initWorkerHeader() {
  try {
    const response = await fetch("/api/workers/auth/me", { headers: { accept: "application/json" } });
    const payload = response.ok ? await response.json() : { worker: null };
    renderWorkerHeader(payload.worker);
  } catch {
    renderWorkerHeader(null);
  }
}

initWorkerHeader();
function updateHeader() {
  if (!header) return;
  header.classList.toggle("is-scrolled", window.scrollY > 18);
}

window.addEventListener("scroll", updateHeader, { passive: true });
updateHeader();

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.12 });

  revealItems.forEach((item) => revealObserver.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

projectFilters.forEach((filterButton) => {
  filterButton.addEventListener("click", () => {
    const selected = filterButton.dataset.filter || "all";
    projectFilters.forEach((button) => button.classList.toggle("is-active", button === filterButton));
    projectCards.forEach((card) => {
      const isVisible = selected === "all" || card.dataset.category === selected;
      card.classList.toggle("is-hidden", !isVisible);
    });
  });
});

function closeLightbox() {
  if (!lightbox) return;
  lightbox.classList.remove("is-open");
  lightbox.setAttribute("aria-hidden", "true");
}

projectCards.forEach((card) => {
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Open project preview: ${card.dataset.lightbox || "Project"}`);

  function openCard() {
    if (!lightbox || !lightboxTitle) return;
    lightboxTitle.textContent = card.dataset.lightbox || "Project Capability";
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    lightboxClose?.focus();
  }

  card.addEventListener("click", openCard);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCard();
    }
  });
});

lightboxClose?.addEventListener("click", closeLightbox);
lightbox?.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeLightbox();
});
