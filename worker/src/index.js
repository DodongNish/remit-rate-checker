const PROVIDERS = [
  {
    name: "Smiles",
    url: "https://www.smileswallet.com/japan/exchange-rates/#:~:text=Philippines",
    parse(html) {
      const anchors = [...html.matchAll(/<a\\b[^>]*>([\\s\\S]*?)<\\/a>/gi)];
      for (const match of anchors) {
        const text = plainText(match[1]);
        const rate = text.match(/^(\\d+(?:\\.\\d+)?)\\s*PHP$/i);
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
      const rate = text.match(/\\(PHP\\)\\s*PHP\\s*(\\d+(?:\\.\\d+)?)/i);
      if (!rate) throw new Error("PHP rate not found");
      return [{ method: "App", rate: Number(rate[1]) }];
    },
  },
  {
    name: "City Express",
    url: "https://www.cityremit.com/en/exchange-rates/#:~:text=PHILIPPINES",
    parse(html) {
      const rows = [...html.matchAll(/<tr\\b[^>]*>([\\s\\S]*?)<\\/tr>/gi)];
      for (const row of rows) {
        const cells = [...row[1].matchAll(/<t[dh]\\b[^>]*>([\\s\\S]*?)<\\/t[dh]>/gi)]
          .map((cell) => plainText(cell[1]));
        if (cells.length && /^Philippines$/i.test(cells[0])) {
          const rate = cells[cells.length - 1].match(/(\\d+(?:\\.\\d+)?)/);
          if (rate) return [{ method: "App", rate: Number(rate[1]) }];
        }
      }
      const text = plainText(html).replace(/\\s+/g, "");
      const fallback = text.match(/PhilippinesPHP(\\d+(?:\\.\\d+)?)/i);
      if (fallback) return [{ method: "App", rate: Number(fallback[1]) }];
      throw new Error("Philippines rate not found");
    },
  },
];

function plainText(value) {
  return value
    .replace(/<script\\b[^>]*>[\\s\\S]*?<\\/script>/gi, " ")
    .replace(/<style\\b[^>]*>[\\s\\S]*?<\\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\\s+/g, " ")
    .trim();
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
