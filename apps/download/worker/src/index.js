
import { checkProviderStatus } from "./providers/sermovie/index.js";

const VERSION = "0.2.0";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store",
    },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "GET") {
      return json({
        success: false,
        error: "METHOD_NOT_ALLOWED",
      }, 405);
    }

    if (url.pathname === "/api/v1/health") {
      return json({
        success: true,
        service: "flicksy-download-api",
        version: VERSION,
        status: "healthy",
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/v1/providers") {
      return json({
        success: true,
        providers: [
          {
            id: "sermovie",
            name: "Sermovie",
            enabled: true,
          },
        ],
      });
    }

    if (url.pathname === "/api/v1/providers/sermovie/status") {
      const result = await checkProviderStatus();

      return json({
        success: true,
        provider: result,
      });
    }

    return json({
      success: false,
      error: "NOT_FOUND",
      message: "The requested API endpoint does not exist.",
    }, 404);
  },
};
