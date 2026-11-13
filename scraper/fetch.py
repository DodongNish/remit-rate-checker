
"""
JPY -> PHP のレートを4社から取得して public/rates.json に書き出す。

各社の取得は独立していて、1社が失敗しても他社は出力される。
HTML構造が変わった場合は、該当の fetch_xxx() だけ直せばよい。
"""

import json
import re
import sys
import datetime as dt
from pathlib import Path

import requests
from bs4 import BeautifulSoup


UA = (
    "Mozilla/5.0 (compatible; remit-rate-page/1.0; "
    "+https://github.com/DodongNish/remit-rate-checker)"
)
TIMEOUT = 20

# HTML側のリンク先と統一
URLS = {
    "City Express": (
        "https://www.cityremit.com/en/exchange-rates/"
        "#:~:text=PHILIPPINES"
    ),
    "SBI Remit": (
        "https://ires.remit.co.jp/IRESWeb/Exchange_Rate.jsf"
    ),
    "Smiles": (
        "https://www.smileswallet.com/japan/exchange-rates/"
        "#:~:text=Philippines"
    ),
    "DCOM": (
        "https://sendmoney.co.jp/en/fx-rate"
        "#:~:text=Philippines"
    ),
}


def get_soup(url, session=None):
    """URLからHTMLを取得してBeautifulSoupを返す。"""
    s = session or requests

    # URLフラグメントはHTTPリクエストには送信されない
    r = s.get(
        url,
        headers={
            "User-Agent": UA,
            "Accept-Language": "en,ja;q=0.8",
        },
        timeout=TIMEOUT,
    )
    r.raise_for_status()

    if not r.encoding or r.encoding.lower() == "iso-8859-1":
        r.encoding = r.apparent_encoding

    return BeautifulSoup(r.text, "html.parser")


def squash(text):
    """連続する空白・改行を1つにまとめる。"""
    return re.sub(r"\s+", " ", text).strip()


def to_rate(text):
    """文字列から為替レートを数値として取得する。"""
    text = text.replace(",", "")
    m = re.search(r"(\d+\.\d+|\d+)", text)

    if not m:
        raise ValueError(f"数値が見つからない: {text!r}")

    rate = float(m.group(1))

    # JPY -> PHP のレートとして不自然な値を除外
    if not 0 < rate < 10:
        raise ValueError(f"レートが想定範囲外: {rate}")

    return rate


SBI_ENTRY = "https://ires.remit.co.jp/IRESWeb/ExchangeDirect.jsf"
SBI_START = "https://www.remit.co.jp/en/kaigaisoukin/exchangeratecommission/exchange/"
SBI_TARGET = "**/Exchange_Rate.jsf*"


def parse_sbi(html):
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    for tr in soup.find_all("tr"):
        tds = [squash(td.get_text(" ")) for td in tr.find_all("td")]
        if len(tds) >= 4 and tds[0] == "Philippines" and "PHP" in tds[2]:
            rows.append({"method": tds[3], "rate": to_rate(tds[2])})
    if not rows:
        raise ValueError("Philippines の行が見つからない")
    return rows


def fetch_sbi():
    # SBI は実ブラウザの遷移(入口 → Exchange_Rate.jsf)でしか表が出ないため Playwright を使う
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            ctx = browser.new_context(user_agent=UA, locale="ja-JP")
            page = ctx.new_page()
            page.set_default_timeout(20000)
            try:
                # 1) 入口に直接アクセスして、自動転送されるか見る
                page.goto(SBI_ENTRY, wait_until="domcontentloaded")
                page.wait_for_url(SBI_TARGET)
            except PWTimeout:
                # 2) 転送されなければ、公式ページの「Exchange Rates」ボタンから辿る
                page.goto(SBI_START, wait_until="domcontentloaded")
                page.locator("a:has-text('Exchange Rates'), button:has-text('Exchange Rates')").first.click()
                page = ctx.pages[-1]  # 新しいタブで開く場合に備える
                page.wait_for_url(SBI_TARGET)
            page.wait_for_selector("tr:has(td:text-is('Philippines'))")
            html = page.content()
        finally:
            browser.close()
    return parse_sbi(html)


def fetch_smiles():
    """Smilesからレートを取得する。"""

    soup = get_soup(URLS["Smiles"])

    for a in soup.find_all("a"):
        txt = squash(a.get_text(" "))

        m = re.fullmatch(
            r"(\d+(?:\.\d+)?)\s*PHP",
            txt,
        )

        if m:
            return [{
                "method": "App",
                "rate": to_rate(m.group(1)),
            }]

    raise ValueError("PHP のレートが見つからない")


def fetch_dcom():
    """DCOMからレートを取得する。"""

    soup = get_soup(URLS["DCOM"])
    text = squash(soup.get_text(" "))

    m = re.search(
        r"\(PHP\)\s*PHP\s*(\d+(?:\.\d+)?)",
        text,
    )

    if not m:
        raise ValueError("PHP のレートが見つからない")

    return [{
        "method": "App",
        "rate": to_rate(m.group(1)),
    }]


def fetch_cityexpress():
    """City Expressからレートを取得する。"""

    soup = get_soup(URLS["City Express"])

    # テーブル形式の場合
    for tr in soup.find_all("tr"):
        tds = [
            squash(td.get_text(" "))
            for td in tr.find_all(["td", "th"])
        ]

        if tds and tds[0] == "Philippines":
            return [{
                "method": "App",
                "rate": to_rate(tds[-1]),
            }]

    # テーブル形式でない場合の保険
    text = soup.get_text("")

    m = re.search(
        r"PhilippinesPHP\s*(\d+(?:\.\d+)?)",
        text,
    )

    if m:
        return [{
            "method": "App",
            "rate": to_rate(m.group(1)),
        }]

    raise ValueError("Philippines の行が見つからない")


# HTML側の表示順に統一
PROVIDERS = {
    "City Express": fetch_cityexpress,
    "SBI Remit": fetch_sbi,
    "Smiles": fetch_smiles,
    "DCOM": fetch_dcom,
}


def main():
    result = {
        "updated": dt.datetime.now(
            dt.timezone.utc
        ).isoformat(timespec="seconds"),
        "pair": "JPY/PHP",
        "providers": [],
    }

    ok = 0

    for name, fn in PROVIDERS.items():
        entry = {
            "name": name,
            "url": URLS[name],
        }

        try:
            entry["rates"] = fn()
            ok += 1

            print(
                f"[OK] {name}: "
                + ", ".join(
                    f"{r['rate']:.4f} PHP ({r['method']})"
                    for r in entry["rates"]
                )
            )

        except Exception as e:
            entry["error"] = f"{type(e).__name__}: {e}"

            print(
                f"[WARN] {name}: {entry['error']}",
                file=sys.stderr,
            )

        result["providers"].append(entry)

    # 出力先
    output_path = Path("public/rates.json")
    output_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with output_path.open("w", encoding="utf-8") as f:
        json.dump(
            result,
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(
        f"\n取得成功: {ok}/{len(PROVIDERS)} 社"
    )
    print(f"出力先: {output_path}")

    # 全社失敗のときだけジョブを失敗させる
    if ok == 0:
        sys.exit("全社の取得に失敗しました")


if __name__ == "__main__":
    main()
