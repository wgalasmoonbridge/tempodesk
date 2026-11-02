const header = document.querySelector("[data-header]");
const menuToggle = document.querySelector("[data-menu-toggle]");
const navigation = document.querySelector("[data-nav]");

function updateHeader() {
  header?.classList.toggle("scrolled", window.scrollY > 12);
}

function closeMenu() {
  navigation?.classList.remove("open");
  menuToggle?.setAttribute("aria-expanded", "false");
  menuToggle?.setAttribute("aria-label", "Open navigation");
}

menuToggle?.addEventListener("click", () => {
  const open = !navigation?.classList.contains("open");
  navigation?.classList.toggle("open", open);
  menuToggle.setAttribute("aria-expanded", String(open));
  menuToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
});

navigation?.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
window.addEventListener("scroll", updateHeader, { passive: true });
window.addEventListener("resize", () => {
  if (window.innerWidth > 820) closeMenu();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeMenu();
});
updateHeader();

const showcase = document.querySelector("[data-showcase]");
const shotImage = showcase?.querySelector("[data-shot-image]");
const shotTitle = showcase?.querySelector("[data-shot-title]");
const shotButtons = showcase?.querySelectorAll("[data-shot]") ?? [];

shotButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (button.classList.contains("active") || !shotImage) return;

    shotButtons.forEach((item) => {
      const active = item === button;
      item.classList.toggle("active", active);
      item.setAttribute("aria-selected", String(active));
    });

    shotImage.classList.add("switching");
    const nextImage = new Image();
    nextImage.src = button.dataset.src ?? "";
    nextImage.onload = () => {
      window.setTimeout(() => {
        shotImage.src = nextImage.src;
        shotImage.alt = button.dataset.alt ?? "TempoDesk application screenshot";
        if (shotTitle) shotTitle.textContent = button.textContent.trim();
        shotImage.classList.remove("switching");
      }, 100);
    };
  });
});

const reveals = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -30px" },
  );
  reveals.forEach((element) => observer.observe(element));
} else {
  reveals.forEach((element) => element.classList.add("visible"));
}

document.querySelectorAll("[data-year]").forEach((element) => {
  element.textContent = String(new Date().getFullYear());
});
