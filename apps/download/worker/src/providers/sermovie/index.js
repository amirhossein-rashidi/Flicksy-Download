
import { parseDirectoryListing } from "./parser.js";

const BASE_URL = "https://dl5.sermoviedown.pw";
const BASE_ORIGIN = new URL(BASE_URL).origin;

const CHECK_PATHS = [
  { name: "root", path: "/" },
  { name: "movies", path: "/Movies/" },
  { name: "series", path: "/Series/" },
];

function validatePath(path) {
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error("INVALID_PATH");
  }

  let decoded;

  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error("INVALID_PATH");
  }

  if (decoded.includes("\\") || decoded.includes("?") || decoded.includes("#")) {
    throw new Error("INVALID_PATH");
  }

  const segments = decoded.split("/").filter(Boolean);

  if (segments.some((part) => part === "." || part === "..")) {
    throw new Error("INVALID_PATH");
  }

  const allowed = ["Movies", "Series", "Anime"];

  if (segments.length > 0 && !allowed.includes(segments[0])) {
    throw new Error("PATH_NOT_ALLOWED");
  }

  const url = new URL(path, BASE_URL);

  if (url.origin !== BASE_ORIGIN || url.search || url.hash) {
    throw new Error("INVALID_PATH");
  }

  return url;
}

async function fetchDirectory(url) {
  let currentUrl = url;

  for (let attempt = 0; attempt <= 3; attempt++) {
    const response = await fetch(currentUrl.toString(), {
      headers: {
        "User-Agent": "FlicksyDownload/0.2.0",
        "Accept": "text/html",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(12000),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();

      if (!location || attempt === 3) {
        throw new Error("REDIRECT_LIMIT");
      }

      const nextUrl = new URL(location, currentUrl);

      if (nextUrl.origin !== BASE_ORIGIN) {
        throw new Error("REDIRECT_BLOCKED");
      }

      currentUrl = nextUrl;
      continue;
    }

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`SOURCE_HTTP_${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
      await response.body?.cancel();
      throw new Error("NOT_HTML");
    }

    return {
      html: await response.text(),
      url: currentUrl.toString(),
      status: response.status,
    };
  }

  throw new Error("REDIRECT_LIMIT");
}

export async function listDirectory(path) {
  const url = validatePath(path);
  const result = await fetchDirectory(url);

  const entries = parseDirectoryListing(result.html, result.url);

  return {
    path: url.pathname,
    count: entries.length,
    entries: entries.slice(0, 100),
  };
}

async function checkDirectory(path) {
  try {
    const result = await listDirectory(path);

    return {
      status: 200,
      accessible: true,
      listingDetected: result.count > 0,
      count: result.count,
      entries: result.entries.slice(0, 10),
    };
  } catch (error) {
    const match = error.message.match(/^SOURCE_HTTP_(\d+)$/);

    return {
      status: match ? Number(match[1]) : null,
      accessible: false,
      listingDetected: false,
      count: 0,
      entries: [],
      error: error.message,
    };
  }
}

export async function checkProviderStatus() {
  const checks = await Promise.all(
    CHECK_PATHS.map(async (item) => ({
      name: item.name,
      path: item.path,
      ...(await checkDirectory(item.path)),
    }))
  );

  const accessibleCount = checks.filter(
    (item) => item.accessible
  ).length;

  return {
    id: "sermovie",
    name: "Sermovie",
    baseUrl: BASE_URL,
    status:
      accessibleCount === CHECK_PATHS.length
        ? "healthy"
        : accessibleCount > 0
          ? "degraded"
          : "unavailable",
    checkedAt: new Date().toISOString(),
    checks,
  };
}
