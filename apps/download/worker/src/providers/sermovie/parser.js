
const ARCHIVE_ORIGIN = "https://dl5.sermoviedown.pw";

function parseFilename(filename, path) {
  const extension = filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || null;

  const qualityPath = path.toLowerCase();

  const resolution =
    filename.match(/\b(2160|1080|720|480|360)p\b/i)?.[0]?.toLowerCase() ||
    null;

  const qualityFromFolder =
    qualityPath.match(/\/(2160|1080|720|480|360)x?265\//)?.[1] ||
    qualityPath.match(/\/(2160|1080|720|480)\//)?.[1] ||
    null;

  const codecMatch = filename.match(/\b(x265|h265|hevc|x264|h264|avc|av1)\b/i);

  let codec = null;

  if (codecMatch) {
    const value = codecMatch[1].toLowerCase();

    codec = ["x265", "h265", "hevc"].includes(value)
      ? "HEVC"
      : ["x264", "h264", "avc"].includes(value)
        ? "AVC"
        : "AV1";
  }

  const seasonEpisode = filename.match(/S(\d{1,2})E(\d{1,3})/i);

  const bitDepth = filename.match(/\b(8|10|12)bit\b/i)?.[0] || null;

  const audioChannels =
    filename.match(/\b(2CH|6CH|8CH|5\.1|7\.1)\b/i)?.[0] || null;

  const sourceMatch = filename.match(
    /\b(WEB-DL|WEBRip|BluRay|BDRip|HDRip|HDTV|DVDRip)\b/i
  );

  const source = sourceMatch?.[1]?.toUpperCase() || null;

  const isSubtitle = [
    "srt",
    "ass",
    "ssa",
    "vtt",
    "sub",
  ].includes(extension);

  return {
    extension,
    mediaType: isSubtitle ? "subtitle" : "video",
    resolution: resolution || (qualityFromFolder ? `${qualityFromFolder}p` : null),
    codec,
    bitDepth,
    source,
    audioChannels,
    season: seasonEpisode ? Number(seasonEpisode[1]) : null,
    episode: seasonEpisode ? Number(seasonEpisode[2]) : null,
    softSub: /\bSoftSub\b/i.test(filename),
    size: null,
  };
}

export function parseDirectoryListing(html, currentUrl) {
  const entries = [];
  const seen = new Set();

  const current = new URL(currentUrl);
  const currentPath = current.pathname.endsWith("/")
    ? current.pathname
    : `${current.pathname}/`;

  const parentPath = currentPath
    .split("/")
    .filter(Boolean)
    .slice(0, -1);

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

    const entry = {
      name: label || name,
      path,
      isDirectory,
    };

    if (!isDirectory) {
      entry.metadata = parseFilename(name, path);
    }

    entries.push(entry);
  }

  return entries;
}
