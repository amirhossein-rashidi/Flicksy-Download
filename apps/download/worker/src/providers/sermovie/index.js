
import {
  parseDirectoryListing,
  parseFilename,
} from "./parser.js";

const BASE_URL = "https://dl5.sermoviedown.pw";
const BASE_ORIGIN = new URL(BASE_URL).origin;

const CHECK_PATHS = [
  { name: "root", path: "/" },
  { name: "movies", path: "/Movies/" },
  { name: "series", path: "/Series/" },
];

const ALLOWED_EXTENSIONS = new Set([
  "mkv",
  "mp4",
  "avi",
  "mov",
  "webm",
  "m4v",
  "srt",
  "ass",
  "ssa",
  "vtt",
  "sub",
]);

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

  if (
    decoded.includes("\\") ||
    decoded.includes("?") ||
    decoded.includes("#")
  ) {
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
        "User-Agent": "FlicksyDownload/0.3.0",
        Accept: "text/html",
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

async function fetchFileSize(url) {
  let currentUrl = url;

  for (let attempt = 0; attempt <= 3; attempt++) {
    const response = await fetch(currentUrl.toString(), {
      method: "GET",
      headers: {
        "User-Agent": "FlicksyDownload/0.3.0",
        Range: "bytes=0-0",
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

      if (nextUrl.origin !== BASE_ORIGIN || nextUrl.hash) {
        throw new Error("REDIRECT_BLOCKED");
      }

      validatePath(nextUrl.pathname);
      currentUrl = nextUrl;
      continue;
    }

    const contentRange = response.headers.get("content-range") || "";
    const rangeMatch = contentRange.match(/bytes\s+\d+-\d+\/(\d+)/i);
    const unsatisfiedRangeMatch = contentRange.match(/bytes\s+\*\/(\d+)/i);

    let sizeBytes = null;
    let method = null;

    if (response.status === 206 && rangeMatch) {
      sizeBytes = Number(rangeMatch[1]);
      method = "content-range";
    } else if (response.status === 200) {
      const contentLength = response.headers.get("content-length");

      if (contentLength && /^\d+$/.test(contentLength)) {
        sizeBytes = Number(contentLength);
        method = "content-length";
      }
    } else if (response.status === 416 && unsatisfiedRangeMatch) {
      sizeBytes = Number(unsatisfiedRangeMatch[1]);
      method = "content-range";
    }

    await response.body?.cancel();

    if (
      sizeBytes !== null &&
      (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0)
    ) {
      sizeBytes = null;
      method = null;
    }

    if (!response.ok && response.status !== 416) {
      throw new Error(`SOURCE_HTTP_${response.status}`);
    }

    return {
      sizeBytes,
      method,
      rangeSupported: response.status === 206,
      downloadUrl: currentUrl.toString(),
      httpStatus: response.status,
    };
  }

  throw new Error("REDIRECT_LIMIT");
}

export async function inspectFile(path) {
  const url = validatePath(path);

  if (url.pathname.endsWith("/")) {
    throw new Error("NOT_A_FILE");
  }

  let filename;

  try {
    filename = decodeURIComponent(
      url.pathname.split("/").filter(Boolean).pop() || ""
    );
  } catch {
    throw new Error("INVALID_PATH");
  }

  const extension = filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();

  if (!extension || !ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("FILE_TYPE_NOT_ALLOWED");
  }

  const metadata = parseFilename(filename, url.pathname);
  const fileInfo = await fetchFileSize(url);

  return {
    name: filename,
    path: url.pathname,
    metadata: {
      ...metadata,
      size: fileInfo.sizeBytes,
    },
    sizeBytes: fileInfo.sizeBytes,
    sizeMethod: fileInfo.method,
    rangeSupported: fileInfo.rangeSupported,
    downloadUrl: fileInfo.downloadUrl,
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
