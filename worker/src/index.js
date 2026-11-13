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
    name: "SBI Remit",
    url: "https://www.remit.co.jp/en/kaigaisoukin/exchangeratecommission/exchange/",
    async fetchRates() {
      const endpoint = "https://ires.remit.co.jp/IRESWeb/ExchangeDirect.jsf";
      const headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      };
      const initial = await fetch(endpoint, { headers, redirect: "manual", signal: AbortSignal.timeout(15000) });
      if (!initial.ok) throw new Error("Initial page HTTP " + initial.status);
      const initialHtml = await initial.text();
      const setCookie = initial.headers.get("set-cookie") || "";
      const cookie = [...setCookie.matchAll(/(?:^|,\s*)([^=;,\s]+)=([^;,\s]+)/g)]
        .map((match) => match[1] + "=" + match[2]).join("; ");
      const token = initialHtml.match(/name="uniqueToken"\s+value="([^"]+)"/i)?.[1];
      const viewState = initialHtml.match(/name="javax\.faces\.ViewState"\s+id="[^"]+"\s+value="([^"]+)"/i)?.[1];
      if (!cookie || !token || !viewState) throw new Error("SBI session initialization data not found");

      const form = new URLSearchParams();
      form.set("dummyForm", "dummyForm");
      form.set("uniqueToken", token);
      form.set("mulClickToken", "");
      form.set("dummyForm:doInit", "");
      form.set("javax.faces.ViewState", viewState);
      const posted = await fetch(endpoint, {
        method: "POST",
        headers: {
          ...headers, "Content-Type": "application/x-www-form-urlencoded",
          "Cookie": cookie, "Origin": "https://ires.remit.co.jp", "Referer": endpoint,
        },
        body: form.toString(), redirect: "manual", signal: AbortSignal.timeout(20000),
      });
      if (posted.status < 300 || posted.status >= 400) throw new Error("SBI initialization HTTP " + posted.status);
      const location = posted.headers.get("location");
      if (!location) throw new Error("SBI exchange-rate redirect not found");
      const target = new URL(location, endpoint);
      target.protocol = "https:";
      const page = await fetch(target.toString(), {
        headers: { ...headers, "Cookie": cookie, "Referer": endpoint },
        redirect: "manual", signal: AbortSignal.timeout(20000),
      });
      if (!page.ok) throw new Error("SBI exchange-rate page HTTP " + page.status);
      const html = await page.text();
      const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
        .map((row) => [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
          .map((cell) => plainText(cell[1])));
      const updatedAt = plainText(html).match(/(\\d{4}\\/\\d{2}\\/\\d{2}\\s+\\d{2}:\\d{2})\\s*現在?/)?.[1] ?? null;
      const rates = rows
        .filter((cells) => cells.length >= 4 && cells[0] === "Philippines")
        .map((cells) => {
          const rate = cells[2].match(/([0-9]+(?:\.[0-9]+)?)\s*PHP/i);
          return rate ? { method: cells[3].replace(/\s+/g, " ").trim(), rate: Number(rate[1]) } : null;
        })
        .filter((item) => item && Number.isFinite(item.rate) && item.rate > 0);
      if (!rates.length) throw new Error("SBI PHP rates not found");
      return { rates, updatedAt };
    },
  },
  {
    name: "City Express",
    url: "https://www.cityremit.com/en/exchange-rates/#:~:text=PHILIPPINES",
    async fetchRates() {
      const apiUrl = "https://admin.ctxpress.co.jp/api/public/rates";
      const response = await fetch(apiUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; remit-rate-checker/1.0)",
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error(`API HTTP ${response.status}`);
      const data = await response.json();
      const rate = Number(data?.rates?.PHP);
      if (!Number.isFinite(rate) || rate <= 0) {
        throw new Error("PHP rate not found in API response");
      }
      return {
        rates: [{ method: "App", rate }],
        updatedAt: data?.asOf ?? null,
      };
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
  let adminApiProbe;
  try {
    const adminApiUrl = "https://admin.ctxpress.co.jp/api/public/rates";
    const adminApiResponse = await fetch(adminApiUrl, {
      headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(12000),
    });
    const adminApiBody = await adminApiResponse.text();
    adminApiProbe = {
      url: adminApiUrl,
      status: adminApiResponse.status,
      contentType: adminApiResponse.headers.get("content-type"),
      body: adminApiBody.slice(0, 20000),
    };
  } catch (error) {
    adminApiProbe = { error: error instanceof Error ? error.message : String(error) };
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
      const moduleDefinitions = [...scriptText.matchAll(/31945/g)].slice(0, 5).map((item) => ({
        offset: item.index,
        context: scriptText.slice(Math.max(0, item.index - 500), Math.min(scriptText.length, item.index + 1800)),
      }));
      const urlLiterals = [...new Set(scriptText.match(/https?:\/\/[^"' \t\n]+/g) ?? [])].slice(0, 40);
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
    adminApiProbe,
    textAroundRates: ["0.395", "0.397"].map((term) => {
      const index = text.indexOf(term);
      return { term, context: index >= 0 ? text.slice(Math.max(0, index - 100), index + 150) : null };
    }),
  };
}


async function inspectSBI() {
  const url = "https://ires.remit.co.jp/IRESWeb/ExchangeDirect.jsf";
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
  };
  const initial = await fetch(url, { headers, redirect: "manual", signal: AbortSignal.timeout(15000) });
  const initialHtml = await initial.text();
  const setCookie = initial.headers.get("set-cookie") || "";
  const cookie = [...setCookie.matchAll(/(?:^|,\s*)([^=;,\s]+)=([^;,\s]+)/g)].map((m) => m[1] + "=" + m[2]).join("; ");
  const token = initialHtml.match(/name="uniqueToken"\s+value="([^"]+)"/i)?.[1];
  const viewState = initialHtml.match(/name="javax\.faces\.ViewState"\s+id="[^"]+"\s+value="([^"]+)"/i)?.[1];
  const formData = new URLSearchParams();
  formData.set("dummyForm", "dummyForm");
  if (token) formData.set("uniqueToken", token);
  formData.set("mulClickToken", "");
  formData.set("dummyForm:doInit", "");
  if (viewState) formData.set("javax.faces.ViewState", viewState);
  let postResult = null;
  let exchangePage = null;
  if (token && viewState && cookie) {
    const posted = await fetch(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded", "Cookie": cookie, "Origin": "https://ires.remit.co.jp", "Referer": url },
      body: formData.toString(), redirect: "manual", signal: AbortSignal.timeout(20000),
    });
    const postHtml = await posted.text();
    const location = posted.headers.get("location");
    postResult = { status: posted.status, location, setCookie: posted.headers.get("set-cookie"), htmlLength: postHtml.length, bodyStart: postHtml.slice(0, 1000) };
    if (posted.status >= 300 && posted.status < 400 && location) {
      const target = new URL(location, url);
      target.protocol = "https:";
      const page = await fetch(target.toString(), {
        headers: { ...headers, "Cookie": cookie, "Referer": url },
        redirect: "manual", signal: AbortSignal.timeout(20000),
      });
      const html = await page.text();
      exchangePage = {
        requestedUrl: target.toString(), status: page.status, location: page.headers.get("location"),
        setCookie: page.headers.get("set-cookie"), htmlLength: html.length,
        title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? null,
        tables: [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((m) => plainText(m[1]).slice(0, 8000)),
        rows: [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => [...m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => plainText(c[1]))).filter((cells) => cells.length),
        textPreview: plainText(html).slice(0, 12000), bodyStart: html.slice(0, 18000),
      };
    }
  }
  return { initial: { status: initial.status, finalUrl: initial.url, setCookie, cookie, htmlLength: initialHtml.length, tokenFound: Boolean(token), viewStateFound: Boolean(viewState) }, postResult, exchangePage };
}
async function fetchProvider(provider) {
  try {
    if (provider.fetchRates) {
      const result = await provider.fetchRates();
      return {
        name: provider.name,
        url: provider.url,
        rates: Array.isArray(result) ? result : result.rates,
        updatedAt: Array.isArray(result) ? null : result.updatedAt ?? null,
      };
    }
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
    return {
      name: provider.name,
      url: provider.url,
      rates: provider.parse(html),
      updatedAt: provider.getUpdatedAt?.(html) ?? null,
    };
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
    if (url.pathname === "/api/debug/sbi" && request.method === "GET") {
      try {
        return Response.json(await inspectSBI(), {
          headers: { ...corsHeaders, "Cache-Control": "no-store, max-age=0" },
        });
      } catch (error) {
        return Response.json(
          { error: error instanceof Error ? error.message : String(error) },
          { status: 502, headers: corsHeaders },
        );
      }
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
