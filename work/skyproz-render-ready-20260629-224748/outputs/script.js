const header = document.querySelector("[data-header]");
const menuButton = document.querySelector("[data-menu-toggle]");
const navigation = document.querySelector("[data-navigation]");
const year = document.querySelector("#year");
const counters = document.querySelectorAll("[data-count]");
const revealItems = document.querySelectorAll(".reveal");
const projectFilters = document.querySelectorAll("[data-filter]");
const projectCards = document.querySelectorAll("[data-category]");
const lightbox = document.querySelector("[data-lightbox-modal]");
const lightboxTitle = document.querySelector("[data-lightbox-title]");
const lightboxClose = document.querySelector("[data-lightbox-close]");

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

function updateHeader() {
  if (!header) return;
  header.classList.toggle("is-scrolled", window.scrollY > 18);
}

window.addEventListener("scroll", updateHeader, { passive: true });
updateHeader();

function animateCounter(element) {
  if (element.dataset.counted === "true") return;
  element.dataset.counted = "true";
  const target = Number(element.dataset.count || 0);
  const duration = 1100;
  const start = performance.now();

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = String(Math.round(target * eased));
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

if ("IntersectionObserver" in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  }, { threshold: 0.12 });

  revealItems.forEach((item) => revealObserver.observe(item));

  const counterObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      animateCounter(entry.target);
      counterObserver.unobserve(entry.target);
    }
  }, { threshold: 0.7 });

  counters.forEach((counter) => counterObserver.observe(counter));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
  counters.forEach(animateCounter);
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
