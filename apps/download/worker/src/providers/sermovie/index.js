
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
  "mkv", "mp4", "avi", "mov", "webm", "m4v",
  "srt", "ass", "ssa", "vtt", "sub",
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
        "User-Agent": "FlicksyDownload/0.6.0",
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
        "User-Agent": "FlicksyDownload/0.6.0",
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

function makeStableId(path) {
  return `sermovie-${path
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")}`;
}

function titleFromFolder(folderName) {
  return folderName
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getReleaseYear(entries) {
  const years = new Set();

  for (const entry of entries) {
    const match = entry.name.match(
      /(?:^|[._\s])((?:19|20)\d{2})(?=[._\s])/
    );

    if (match) {
      years.add(Number(match[1]));
    }
  }

  return years.size === 1 ? [...years][0] : null;
}

function makeDirectUrl(path) {
  const url = new URL(path, BASE_URL);

  if (url.origin !== BASE_ORIGIN) {
    throw new Error("REDIRECT_BLOCKED");
  }

  return url.toString();
}

async function listOptionalDirectory(path) {
  try {
    return await listDirectory(path);
  } catch (error) {
    return {
      path,
      count: 0,
      entries: [],
      error: error.message,
    };
  }
}

export async function buildMovieCatalog(path) {
  const movieUrl = validatePath(path);
  const segments = movieUrl.pathname.split("/").filter(Boolean);

  if (
    segments.length !== 3 ||
    segments[0] !== "Movies"
  ) {
    throw new Error("INVALID_MOVIE_PATH");
  }

  const archiveYear = segments[1];
  const folderName = decodeURIComponent(segments[2]);
  const moviePath = `${movieUrl.pathname.replace(/\/+$/, "")}/`;

  const root = await listDirectory(moviePath);

  const webFolder = root.entries.find(
    (entry) => entry.isDirectory && entry.name.replace(/\/$/, "") === "Web"
  );

  const subFolder = root.entries.find(
    (entry) => entry.isDirectory && entry.name.replace(/\/$/, "") === "Sub"
  );

  const webResult = webFolder
    ? await listOptionalDirectory(webFolder.path)
    : { entries: [], count: 0, error: "WEB_FOLDER_NOT_FOUND" };

  const subResult = subFolder
    ? await listOptionalDirectory(subFolder.path)
    : { entries: [], count: 0, error: "SUB_FOLDER_NOT_FOUND" };

  const qualityFolders = webResult.entries.filter(
    (entry) => entry.isDirectory
  );

  const qualityResults = await Promise.all(
    qualityFolders.map(async (folder) => ({
      folder: folder.name.replace(/\/$/, ""),
      result: await listOptionalDirectory(folder.path),
    }))
  );

  const downloads = [];

  for (const item of qualityResults) {
    for (const entry of item.result.entries) {
      if (entry.isDirectory) continue;

      const metadata = entry.metadata || parseFilename(entry.name, entry.path);

      if (metadata.mediaType !== "video") continue;

      downloads.push({
        id: makeStableId(entry.path),
        name: entry.name,
        path: entry.path,
        qualityFolder: item.folder,
        metadata,
        sizeBytes: null,
        downloadUrl: makeDirectUrl(entry.path),
      });
    }
  }

  const subtitles = subResult.entries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => {
      const metadata = entry.metadata || parseFilename(entry.name, entry.path);

      return {
        id: makeStableId(entry.path),
        name: entry.name,
        path: entry.path,
        format: metadata.extension,
        language: "unknown",
        sizeBytes: null,
        downloadUrl: makeDirectUrl(entry.path),
      };
    });

  return {
    id: makeStableId(moviePath),
    type: "movie",
    provider: "sermovie",
    title: titleFromFolder(folderName),
    archiveYear,
    releaseYear: getReleaseYear(downloads),
    path: moviePath,
    downloadCount: downloads.length,
    subtitleCount: subtitles.length,
    downloads,
    subtitles,
    warnings: [
      ...(webResult.error ? [webResult.error] : []),
      ...(subResult.error ? [subResult.error] : []),
      ...qualityResults
        .filter((item) => item.result.error)
        .map((item) => `${item.folder}: ${item.result.error}`),
    ],
  };
}

function getSeasonNumber(folderName) {
  const match = folderName.match(/^S(\d{1,2})$/i);
  return match ? Number(match[1]) : null;
}

function getEpisodeKey(season, episode) {
  return `${season}-${episode}`;
}

function sortByEpisode(a, b) {
  return a.episodeNumber - b.episodeNumber;
}

export async function buildSeriesCatalog(path) {
  const seriesUrl = validatePath(path);
  const segments = seriesUrl.pathname.split("/").filter(Boolean);

  if (
    segments.length !== 3 ||
    segments[0] !== "Series"
  ) {
    throw new Error("INVALID_SERIES_PATH");
  }

  const archiveYear = segments[1];
  const folderName = decodeURIComponent(segments[2]);
  const seriesPath = `${seriesUrl.pathname.replace(/\/+$/, "")}/`;

  const root = await listDirectory(seriesPath);

  const seasonFolders = root.entries
    .filter((entry) => entry.isDirectory)
    .map((entry) => ({
      ...entry,
      seasonNumber: getSeasonNumber(entry.name.replace(/\/$/, "")),
    }))
    .filter((entry) => entry.seasonNumber !== null)
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
    .slice(0, 20);

  const warnings = [];
  const seasons = [];

  for (const seasonFolder of seasonFolders) {
    const seasonNumber = seasonFolder.seasonNumber;
    const seasonRoot = await listOptionalDirectory(seasonFolder.path);

    if (seasonRoot.error) {
      warnings.push(`S${String(seasonNumber).padStart(2, "0")}: ${seasonRoot.error}`);
    }

    const subtitleFolder = seasonRoot.entries.find(
      (entry) =>
        entry.isDirectory &&
        entry.name.replace(/\/$/, "").toLowerCase() === "sub"
    );

    const qualityFolders = seasonRoot.entries
      .filter((entry) => entry.isDirectory && entry !== subtitleFolder)
      .slice(0, 12);

    const qualityResults = await Promise.all(
      qualityFolders.map(async (folder) => ({
        folder: folder.name.replace(/\/$/, ""),
        result: await listOptionalDirectory(folder.path),
      }))
    );

    const episodeMap = new Map();

    for (const item of qualityResults) {
      if (item.result.error) {
        warnings.push(
          `S${String(seasonNumber).padStart(2, "0")}/${item.folder}: ${item.result.error}`
        );
        continue;
      }

      for (const entry of item.result.entries) {
        if (entry.isDirectory) continue;

        const metadata = entry.metadata || parseFilename(entry.name, entry.path);

        if (metadata.mediaType !== "video") continue;

        const episodeNumber = metadata.episode;

        if (!Number.isInteger(episodeNumber)) continue;

        const detectedSeason = metadata.season || seasonNumber;
        const key = getEpisodeKey(detectedSeason, episodeNumber);

        if (!episodeMap.has(key)) {
          episodeMap.set(key, {
            id: `${makeStableId(seriesPath)}-s${String(detectedSeason).padStart(2, "0")}e${String(episodeNumber).padStart(2, "0")}`,
            type: "episode",
            seasonNumber: detectedSeason,
            episodeNumber,
            title: `Episode ${String(episodeNumber).padStart(2, "0")}`,
            downloadCount: 0,
            downloads: [],
            subtitles: [],
          });
        }

        const episode = episodeMap.get(key);

        episode.downloads.push({
          id: makeStableId(entry.path),
          name: entry.name,
          path: entry.path,
          qualityFolder: item.folder,
          metadata,
          sizeBytes: null,
          downloadUrl: makeDirectUrl(entry.path),
        });

        episode.downloadCount++;
      }
    }

    const seasonSubtitles = subtitleFolder
      ? (await listOptionalDirectory(subtitleFolder.path)).entries
          .filter((entry) => !entry.isDirectory)
          .map((entry) => {
            const metadata = entry.metadata || parseFilename(entry.name, entry.path);

            return {
              id: makeStableId(entry.path),
              name: entry.name,
              path: entry.path,
              episodeNumber: metadata.episode,
              format: metadata.extension,
              language: "unknown",
              sizeBytes: null,
              downloadUrl: makeDirectUrl(entry.path),
            };
          })
      : [];

    for (const subtitle of seasonSubtitles) {
      if (!Number.isInteger(subtitle.episodeNumber)) continue;

      const episode = episodeMap.get(
        getEpisodeKey(seasonNumber, subtitle.episodeNumber)
      );

      if (episode) {
        episode.subtitles.push(subtitle);
      }
    }

    const episodes = [...episodeMap.values()]
      .sort(sortByEpisode)
      .map((episode) => {
        episode.downloads.sort((a, b) => {
          const resolutionA = Number.parseInt(a.metadata.resolution || "0", 10);
          const resolutionB = Number.parseInt(b.metadata.resolution || "0", 10);
          return resolutionB - resolutionA;
        });

        return episode;
      });

    seasons.push({
      id: `${makeStableId(seriesPath)}-s${String(seasonNumber).padStart(2, "0")}`,
      seasonNumber,
      title: `Season ${seasonNumber}`,
      path: seasonFolder.path,
      episodeCount: episodes.length,
      downloadCount: episodes.reduce(
        (total, episode) => total + episode.downloadCount,
        0
      ),
      subtitleCount: seasonSubtitles.length,
      subtitles: seasonSubtitles,
      episodes,
    });
  }

  const episodeCount = seasons.reduce(
    (total, season) => total + season.episodeCount,
    0
  );

  const downloadCount = seasons.reduce(
    (total, season) => total + season.downloadCount,
    0
  );

  const subtitleCount = seasons.reduce(
    (total, season) => total + season.subtitleCount,
    0
  );

  return {
    id: makeStableId(seriesPath),
    type: "series",
    provider: "sermovie",
    title: titleFromFolder(folderName),
    archiveYear,
    path: seriesPath,
    seasonCount: seasons.length,
    episodeCount,
    downloadCount,
    subtitleCount,
    seasons,
    warnings,
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
