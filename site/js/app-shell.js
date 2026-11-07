const main = document.querySelector("main.workspace");
const header = main?.querySelector(":scope > header");
const oldNav = header?.querySelector("nav");

if (main && header && oldNav) {
  const isStudent = location.pathname.toLowerCase().includes("/aluno/");
  const roleLabel = isStudent ? "Espaço do aluno" : "Área do professor";
  const navLinks = [...oldNav.querySelectorAll("a, button")];
  const sidebar = document.createElement("aside");
  sidebar.className = "app-sidebar";
  sidebar.setAttribute("aria-label", `Navegação — ${roleLabel}`);

  const brand = document.createElement("a");
  brand.className = "brand sidebar-brand";
  brand.href = "../index.html";
  brand.setAttribute("aria-label", "Quizziolando, início");
  brand.innerHTML = '<span class="brand-icon" aria-hidden="true">Q</span><span>QUIZZI<span class="brand-light">OLANDO</span></span>';

  const role = document.createElement("p");
  role.className = "sidebar-role";
  role.textContent = roleLabel;

  const navigation = document.createElement("nav");
  navigation.className = "app-navigation";
  navigation.setAttribute("aria-label", roleLabel);
  navLinks.forEach((item) => {
    item.classList.remove("active");
    if (item instanceof HTMLAnchorElement) {
      const target = new URL(item.href, location.href);
      const normalize = (path) => path.toLowerCase().replace(/\.html$/, "").replace(/\/+$/, "");
      if (target.origin === location.origin && normalize(target.pathname) === normalize(location.pathname)) {
        item.classList.add("active");
        item.setAttribute("aria-current", "page");
      }
    }

    navigation.append(item);
  });

  const sidebarFooter = document.createElement("p");
  sidebarFooter.className = "sidebar-footer";
  sidebarFooter.textContent = isStudent
    ? "Seu progresso, suas conquistas e suas próximas atividades em um só lugar."
    : "Planeje atividades, acompanhe turmas e veja a aprendizagem acontecer.";

  sidebar.append(brand, role, navigation, sidebarFooter);

  const content = document.createElement("div");
  content.className = "app-content";
  const context = document.createElement("div");
  context.className = "app-context";
  context.textContent = roleLabel;
  const page = document.createElement("div");
  page.className = "app-page";

  while (main.firstChild && main.firstChild !== header) page.append(main.firstChild);
  while (header.nextSibling) page.append(header.nextSibling);
  header.removeChild(oldNav);
  page.prepend(header);
  content.append(context, page);
  main.classList.add("app-layout");
  main.append(sidebar, content);

  if (isStudent) {
    const sectionLinks = [];
    const sections = [];
    const overview = document.createElement("a");
    const pageHeader = page.querySelector("header");
    if (pageHeader && !pageHeader.id) pageHeader.id = "student-overview";
    overview.href = `#${pageHeader?.id || "student-overview"}`;
    overview.textContent = "Visão geral";
    overview.classList.add("active");
    overview.setAttribute("aria-current", "location");
    navigation.prepend(overview);
    page.querySelectorAll("section.card").forEach((section, index) => {
      const title = section.querySelector("h2");
      if (!title || section.hidden) return;
      if (!section.id) section.id = `student-section-${index + 1}`;
      const link = document.createElement("a");
      link.href = `#${section.id}`;
      link.textContent = title.textContent.trim();
      sectionLinks.push(link);
      sections.push(section);
    });
    if (sectionLinks.length) {
      const label = document.createElement("p");
      label.className = "sidebar-section-label";
      label.textContent = "Seu espaço";
      navigation.append(label, ...sectionLinks);
      const sectionObserver = new IntersectionObserver((entries) => {
        const current = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!current) return;
        navigation.querySelectorAll('a[href^="#"]').forEach((link) => {
          const active = link.hash === `#${current.target.id}`;
          link.classList.toggle("active", active);
          if (active) link.setAttribute("aria-current", "location");
          else link.removeAttribute("aria-current");
        });
      }, { rootMargin: "-18% 0px -68% 0px", threshold: [0, 0.15, 0.4] });
      sections.forEach((section) => sectionObserver.observe(section));
    }
  }
}

const teacherDashboard = document.querySelector("#teacher-view");
const teacherNav = teacherDashboard?.querySelector(":scope > nav.site-nav");

if (teacherDashboard && teacherNav) {
  const sidebar = document.createElement("aside");
  sidebar.className = "app-sidebar";
  sidebar.setAttribute("aria-label", "Navegação — Área do professor");

  const brand = document.createElement("a");
  brand.className = "brand sidebar-brand";
  brand.href = "./index.html";
  brand.setAttribute("aria-label", "Quizziolando, início");
  brand.innerHTML = '<span class="brand-icon" aria-hidden="true">Q</span><span>QUIZZI<span class="brand-light">OLANDO</span></span>';

  const role = document.createElement("p");
  role.className = "sidebar-role";
  role.textContent = "Área do professor";

  const navigation = document.createElement("nav");
  navigation.className = "app-navigation";
  navigation.setAttribute("aria-label", "Ferramentas do professor");
  const overview = document.createElement("a");
  overview.href = "#teacher-overview";
  overview.textContent = "Visão geral";
  overview.className = "active";
  overview.setAttribute("aria-current", "page");
  navigation.append(overview);
  [...teacherNav.querySelectorAll("a")].forEach((link) => navigation.append(link));

  const sidebarFooter = document.createElement("p");
  sidebarFooter.className = "sidebar-footer";
  sidebarFooter.textContent = "Crie experiências de aprendizagem e acompanhe o progresso da sua turma.";
  sidebar.append(brand, role, navigation, sidebarFooter);

  const context = document.createElement("div");
  context.className = "app-context";
  context.textContent = "Área do professor";
  const page = document.createElement("div");
  page.className = "teacher-app-page";
  const heading = teacherDashboard.querySelector(".page-heading");
  if (heading) heading.id = "teacher-overview";
  [...teacherDashboard.children].forEach((child) => {
    if (child !== teacherNav) page.append(child);
  });
  const content = document.createElement("div");
  content.className = "teacher-app-content";
  content.append(context, page);
  teacherDashboard.classList.add("teacher-app-layout");
  teacherDashboard.replaceChildren(sidebar, content);
}
