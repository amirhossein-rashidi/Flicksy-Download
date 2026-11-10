
import { parseDirectoryListing } from "./parser.js";

const BASE_URL = "https://dl5.sermoviedown.pw";

const CHECK_PATHS = [
  { name: "root", path: "/" },
  { name: "movies", path: "/Movies/" },
  { name: "series", path: "/Series/" },
];

async function checkDirectory(path) {
  const url = new URL(path, BASE_URL);

  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "FlicksyDownload/0.1.0",
        "Accept": "text/html",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });

    const finalUrl = new URL(response.url);

    if (finalUrl.origin !== new URL(BASE_URL).origin) {
      await response.body?.cancel();

      return {
        status: response.status,
        accessible: false,
        listingDetected: false,
        count: 0,
        entries: [],
        error: "REDIRECT_BLOCKED",
      };
    }

    const result = {
      status: response.status,
      accessible: response.ok,
      listingDetected: false,
      count: 0,
      entries: [],
    };

    if (!response.ok) {
      await response.body?.cancel();
      return result;
    }

    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
      await response.body?.cancel();
      return result;
    }

    const html = await response.text();
    const entries = parseDirectoryListing(html, url.toString());

    result.count = entries.length;
    result.entries = entries.slice(0, 10);
    result.listingDetected = entries.length > 0;

    return result;
  } catch (error) {
    return {
      status: null,
      accessible: false,
      listingDetected: false,
      count: 0,
      entries: [],
      error: error.name === "TimeoutError" ? "TIMEOUT" : "FETCH_FAILED",
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
    (item) => item.listingDetected
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
