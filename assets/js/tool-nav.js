function detectCurrentTool(nav) {
  if (nav.dataset.current) {
    return nav.dataset.current;
  }

  const match = window.location.pathname.match(/\/tools\/([^/]+)/);
  return match?.[1] ?? '';
}

function createToolLink(item, baseHref) {
  const link = document.createElement('a');
  link.className = 'topbar-link';
  link.href = `${baseHref}${item.id}/`;
  link.textContent = item.label;
  return link;
}

function renderToolNav(items, root = document) {
  root.querySelectorAll('[data-tool-nav]').forEach((nav) => {
    const currentTool = detectCurrentTool(nav);
    const baseHref = nav.dataset.baseHref ?? '../';
    nav.replaceChildren(
      ...items
        .filter((item) => item.id !== currentTool)
        .map((item) => createToolLink(item, baseHref)),
    );
  });
}

async function loadToolNavItems() {
  const scriptUrl = document.currentScript?.src ?? '../../assets/js/tool-nav.js';
  const dataUrl = new URL('tool-nav-data.json', scriptUrl);
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error(`Failed to load tool nav data: ${response.status}`);
  }
  return response.json();
}

loadToolNavItems()
  .then((items) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => renderToolNav(items), { once: true });
    } else {
      renderToolNav(items);
    }
  })
  .catch((error) => {
    console.error(error);
  });
