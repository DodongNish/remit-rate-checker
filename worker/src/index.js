const PROVIDERS = [
  {
    name: "Smiles",
    url: "https://www.smileswallet.com/japan/exchange-rates/#:~:text=Philippines",
    parse(html) {
      const anchors = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
      for (const match of anchors) {
        const text = plainText(match[1]);
        const rate = text.match(/^(\d+(?:\.\d+)?)\s*PHP$/i);
        if (rate) return [{ method: "App", rate: Number(rate[1]) }];
      }
      throw new Error("PHP rate not found");
    },
  },
  {
    name: "D-com",
    url: "https://sendmoney.co.jp/en/fx-rate#:~:text=Philippines",
    parse(html) {
      const text = plainText(html);
      const rate = text.match(/\(PHP\)\s*PHP\s*(\d+(?:\.\d+)?)/i);
      if (!rate) throw new Error("PHP rate not found");
      return [{ method: "App", rate: Number(rate[1]) }];
    },
  },
  {
    name: "City Express",
    url: "https://www.cityremit.com/en/exchange-rates/#:~:text=PHILIPPINES",
    parse(html) {
      const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
      for (const row of rows) {
        const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
          .map((cell) => plainText(cell[1]));
        if (cells.length && /^Philippines$/i.test(cells[0])) {
          const rate = cells[cells.length - 1].match(/(\d+(?:\.\d+)?)/);
          if (rate) return [{ method: "App", rate: Number(rate[1]) }];
        }
      }
      const text = plainText(html).replace(/\s+/g, "");
      const fallback = text.match(/PhilippinesPHP(\d+(?:\.\d+)?)/i);
      if (fallback) return [{ method: "App", rate: Number(fallback[1]) }];
      throw new Error("Philippines rate not found");
    },
  },
];

function plainText(value) {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}


async function inspectCityExpress() {
  const provider = PROVIDERS.find((item) => item.name === "City Express");
  const response = await fetch(provider.url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; remit-rate-checker/1.0)",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en,ja;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((row) => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((cell) => plainText(cell[1])))
    .filter((cells) => cells.some((cell) => /Philippines|0\.395|0\.397/i.test(cell)));
  const text = plainText(html);
  let apiProbe;
  try {
    const apiResponse = await fetch(new URL("/api/public/rates", response.url), {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    const body = await apiResponse.text();
    apiProbe = { url: new URL("/api/public/rates", response.url).href, status: apiResponse.status, contentType: apiResponse.headers.get("content-type"), body: body.slice(0, 12000) };
  } catch (error) {
    apiProbe = { error: error instanceof Error ? error.message : String(error) };
  }
  const scriptTags = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const scripts = await Promise.all(scriptTags.map(async (match) => {
    const src = match[1].match(/\bsrc=["']([^"']+)["']/i)?.[1] ?? null;
    const inline = match[2];
    const scriptUrl = src ? new URL(src, response.url).href : null;
    if (!scriptUrl) {
      return /exchange.?rate|currency|philippines|\bPHP\b|\bapi\b|ajax|graphql/i.test(inline)
        ? { src: null, inlineLength: inline.length, relevantInline: inline.slice(0, 2000) }
        : null;
    }
    try {
      const scriptResponse = await fetch(scriptUrl, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "*/*" },
        signal: AbortSignal.timeout(12000),
      });
      const scriptText = await scriptResponse.text();
      const matches = [...scriptText.matchAll(/exchange|currency|philippines|PHP|api|graphql|fetch|axios/gi)]
        .slice(0, 15).map((item) => scriptText.slice(Math.max(0, item.index - 100), Math.min(scriptText.length, item.index + 180)));
      const deepInspection = ["api/public/rates", "58443", "31945", "apiBase", "baseUrl", "NEXT_PUBLIC", "apiUrl", "API_URL", "https://"].map((term) => {
        const index = scriptText.indexOf(term);
        return { term, context: index >= 0 ? scriptText.slice(Math.max(0, index - 1800), Math.min(scriptText.length, index + 2600)) : null };
      }).filter((item) => item.context);
      const moduleDefinitions = [...scriptText.matchAll(/(?:^|[,\\[])31945\\s*,/g)].slice(0, 5).map((item) => ({
        offset: item.index,
        context: scriptText.slice(Math.max(0, item.index - 500), Math.min(scriptText.length, item.index + 1800)),
      }));
      const urlLiterals = [...new Set(scriptText.match(/https?:\\/\\/[^"'\\s`]+/g) ?? [])].slice(0, 40);
      return { src: scriptUrl, status: scriptResponse.status, length: scriptText.length, matches, deepInspection, moduleDefinitions, urlLiterals };
    } catch (error) {
      return { src: scriptUrl, error: error instanceof Error ? error.message : String(error) };
    }
  })).then((items) => items.filter(Boolean));
  return {
    fetchedUrl: response.url,
    httpStatus: response.status,
    htmlLength: html.length,
    matchingRows: rows,
    scripts,
    apiProbe,
    textAroundRates: ["0.395", "0.397"].map((term) => {
      const index = text.indexOf(term);
      return { term, context: index >= 0 ? text.slice(Math.max(0, index - 100), index + 150) : null };
    }),
  };
}

async function fetchProvider(provider) {
  try {
    const response = await fetch(provider.url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; remit-rate-checker/1.0)",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en,ja;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    return { name: provider.name, url: provider.url, rates: provider.parse(html) };
  } catch (error) {
    return {
      name: provider.name,
      url: provider.url,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    if (url.pathname === "/api/debug/city-express" && request.method === "GET") {
      try {
        return Response.json(await inspectCityExpress(), {
          headers: { ...corsHeaders, "Cache-Control": "no-store, max-age=0" },
        });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 502, headers: corsHeaders },
        );
      }
    }
    if (url.pathname !== "/api/rates") {
      return Response.json({ error: "Not found" }, { status: 404, headers: corsHeaders });
    }
    if (request.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
    }

    const providers = await Promise.all(PROVIDERS.map(fetchProvider));
    const successful = providers.filter((provider) => provider.rates?.length);
    const body = {
      updated: new Date().toISOString(),
      pair: "JPY/PHP",
      providers,
    };
    return Response.json(body, {
      headers: {
        ...corsHeaders,
        "Cache-Control": "no-store, max-age=0",
      },
      status: successful.length ? 200 : 502,
    });
  },
};
