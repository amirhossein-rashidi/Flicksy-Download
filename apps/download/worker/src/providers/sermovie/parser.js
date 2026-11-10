
const ARCHIVE_ORIGIN = "https://dl5.sermoviedown.pw";

export function parseDirectoryListing(html, currentUrl) {
  const entries = [];
  const seen = new Set();

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
    if (!target.pathname.startsWith("/")) continue;
    if (target.search || target.hash) continue;

    const name = decodeURIComponent(
      target.pathname.split("/").filter(Boolean).pop() || ""
    );

    if (!name || name === ".." || name === ".") continue;

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
