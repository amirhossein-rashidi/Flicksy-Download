
const ARCHIVE_ORIGIN = "https://dl5.sermoviedown.pw";

export function parseDirectoryListing(html, currentUrl) {
  const entries = [];
  const seen = new Set();

  const current = new URL(currentUrl);
  const currentPath = current.pathname.endsWith("/")
    ? current.pathname
    : `${current.pathname}/`;

  const parentPath = currentPath.split("/").filter(Boolean).slice(0, -1);
  const parentUrl = `/${parentPath.join("/")}${parentPath.length ? "/" : ""}`;

  const anchors = html.matchAll(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  );

  for (const match of anchors) {
    const href = match[1].trim();
    const label = match[2].replace(/<[^>]*>/g, "").trim();

    if (!href || href.startsWith("?") || href.startsWith("#")) {
      continue;
    }

    let target;

    try {
      target = new URL(href, currentUrl);
    } catch {
      continue;
    }

    if (target.origin !== ARCHIVE_ORIGIN) continue;
    if (target.search || target.hash) continue;

    let name;

    try {
      name = decodeURIComponent(
        target.pathname.split("/").filter(Boolean).pop() || ""
      );
    } catch {
      continue;
    }

    if (!name || name === "." || name === "..") continue;

    // حذف لینک بازگشت به پوشه والد
    if (
      label.toLowerCase().includes("parent directory") ||
      target.pathname === parentUrl
    ) {
      continue;
    }

    const isDirectory = target.pathname.endsWith("/");
    const path = target.pathname;

    if (seen.has(path)) continue;
    seen.add(path);

    entries.push({
      name: label || name,
      path,
      isDirectory,
    });
  }

  return entries;
}
