"""JPY -> PHP のレートを4社から取得して public/rates.json に書き出す。

各社の取得は独立していて、1社が失敗しても他社は出力される。
HTML構造が変わった場合は、該当の fetch_xxx() だけ直せばよい。
"""
import json
import re
import sys
import datetime as dt
import requests
from bs4 import BeautifulSoup

UA = "Mozilla/5.0 (compatible; remit-rate-page/1.0; +https://github.com/YOUR_NAME/YOUR_REPO)"
TIMEOUT = 20

URLS = {
    "SBI Remit": "https://ires.remit.co.jp/IRESWeb/Exchange_Rate.jsf",
    "Smiles": "https://www.smileswallet.com/japan/exchange-rates/",
    "D-com": "https://sendmoney.co.jp/en/fx-rate",
    "City Express": "https://www.cityremit.com/en/exchange-rates/",
}


def get_soup(url, session=None):
    s = session or requests
    r = s.get(url, headers={"User-Agent": UA, "Accept-Language": "en,ja;q=0.8"}, timeout=TIMEOUT)
    r.raise_for_status()
    r.encoding = r.apparent_encoding if not r.encoding or r.encoding.lower() == "iso-8859-1" else r.encoding
    return BeautifulSoup(r.text, "html.parser")


def squash(text):
    return re.sub(r"\s+", " ", text).strip()


def to_rate(text):
    m = re.search(r"(\d+(?:\.\d+)?)", text.replace(",", ""))
    if not m:
        raise ValueError(f"数値が見つからない: {text!r}")
    return float(m.group(1))


# def fetch_sbi():
#     # JSESSIONID が発行されるので Session を使う
#     with requests.Session() as s:
#         soup = get_soup(URLS["SBI Remit"], s)
#     rows = []
#     for tr in soup.find_all("tr"):
#         tds = [squash(td.get_text(" ")) for td in tr.find_all("td")]
#         if len(tds) >= 4 and tds[0] == "Philippines" and "PHP" in tds[2]:
#             rows.append({"method": tds[3], "rate": to_rate(tds[2])})
#     if not rows:
#         raise ValueError("Philippines の行が見つからない")
#     return rows

def fetch_sbi():
    # JSESSIONID が発行されるので Session を使う
    with requests.Session() as s:
        soup = get_soup(URLS["SBI Remit"], s)
    rows = []
    for tr in soup.find_all("tr"):
        tds = [squash(td.get_text(" ")) for td in tr.find_all("td")]
        if len(tds) >= 4 and tds[0] == "Philippines" and "PHP" in tds[2]:
            rows.append({"method": tds[3], "rate": to_rate(tds[2])})
    if rows:
        return rows

    # 診断: 表を埋める AJAX の送り方を調べる
    form = soup.find("form")
    print(f"[DEBUG] SBI: form attrs={form.attrs if form else None}", file=sys.stderr)
    print(f"[DEBUG] SBI: inputs={[(i.get('name'), (i.get('value') or '')[:30]) for i in soup.find_all('input')]}",
          file=sys.stderr)
    print(f"[DEBUG] SBI: buttons={[(b.get('id'), b.get('onclick')) for b in soup.find_all(['button','a']) if b.get('id')]}",
          file=sys.stderr)
    t = soup.find("table")
    print(f"[DEBUG] SBI: table={str(t)[:700]!r}", file=sys.stderr)
    print(f"[DEBUG] SBI: script_src={[x.get('src') for x in soup.find_all('script') if x.get('src')]}",
          file=sys.stderr)
    for i, sc in enumerate(soup.find_all("script")):
        body = sc.get_text()
        if any(k in body for k in ("ab(", "ajax", "jsf", "remoteCommand", "poll", "Poll")):
            print(f"[DEBUG] SBI: script{i}={squash(body)[:1200]!r}", file=sys.stderr)
    raise ValueError("Philippines の行が見つからない")


def fetch_smiles():
    soup = get_soup(URLS["Smiles"])
    for a in soup.find_all("a"):
        txt = squash(a.get_text(" "))
        m = re.fullmatch(r"(\d+(?:\.\d+)?)\s*PHP", txt)
        if m:
            return [{"method": "App", "rate": float(m.group(1))}]
    raise ValueError("PHP のレートが見つからない")


def fetch_dcom():
    soup = get_soup(URLS["D-com"])
    text = squash(soup.get_text(" "))
    m = re.search(r"\(PHP\)\s*PHP\s*(\d+(?:\.\d+)?)", text)
    if not m:
        raise ValueError("PHP のレートが見つからない")
    return [{"method": "App", "rate": float(m.group(1))}]


def fetch_cityexpress():
    soup = get_soup(URLS["City Express"])
    for tr in soup.find_all("tr"):
        tds = [squash(td.get_text(" ")) for td in tr.find_all(["td", "th"])]
        if tds and tds[0] == "Philippines":
            return [{"method": "App", "rate": to_rate(tds[-1])}]
    # 表が <table> でない場合の保険: 本文から "PhilippinesPHP0.395000" を探す
    text = soup.get_text("")
    m = re.search(r"PhilippinesPHP\s*(\d+(?:\.\d+)?)", text)
    if m:
        return [{"method": "App", "rate": float(m.group(1))}]
    raise ValueError("Philippines の行が見つからない")


PROVIDERS = {
    "SBI Remit": fetch_sbi,
    "Smiles": fetch_smiles,
    "D-com": fetch_dcom,
    "City Express": fetch_cityexpress,
}


def main():
    result = {
        "updated": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "pair": "JPY/PHP",
        "providers": [],
    }
    ok = 0
    for name, fn in PROVIDERS.items():
        entry = {"name": name, "url": URLS[name]}
        try:
            entry["rates"] = fn()
            ok += 1
        except Exception as e:  # 1社の失敗で全体を止めない
            entry["error"] = f"{type(e).__name__}: {e}"
            print(f"[WARN] {name}: {entry['error']}", file=sys.stderr)
        result["providers"].append(entry)

    with open("public/rates.json", "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    # 全社失敗のときだけジョブを失敗させ、古いサイトを残す
    if ok == 0:
        sys.exit("全社の取得に失敗しました")


if __name__ == "__main__":
    main()
