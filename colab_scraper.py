"""
============================================================
  LeadForge AI — Google Maps Scraper for Google Colab
============================================================
Run this in Google Colab (its IP is NOT blocked by Google Maps).
It scrapes businesses + reviews, then pushes them straight into your
LeadForge platform, which then crawls each website, finds & VERIFIES
emails, runs AI analysis and generates outreach automatically.

HOW TO USE
----------
1. Open https://colab.research.google.com  ->  New notebook.
2. Paste this whole file into one cell.
3. Edit the CONFIG block below (PLATFORM_URL, EMAIL, PASSWORD, SEARCH_QUERY).
4. Run the cell. Done — open your platform's Campaigns page to watch it process.
============================================================
"""

# ====================== CONFIG ======================
PLATFORM_URL = "https://YOUR-SPACE.hf.space"   # <-- your LeadForge URL (no trailing slash)
EMAIL        = "admin@admin.com"               # <-- your login email
PASSWORD     = "your-password"                 # <-- your login password
SEARCH_QUERY = "Plumber in New York"           # <-- "<business> in <city>"
MAX_RESULTS  = 40                              # how many businesses to scrape
# ====================================================

# --- Install dependencies (Colab) ---
import subprocess, sys
subprocess.run("apt-get update -qq", shell=True)
subprocess.run(
    "apt-get install -y -qq libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 "
    "libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 "
    "libpango-1.0-0 libcairo2 libasound2", shell=True)
subprocess.run(f"{sys.executable} -m pip install -q playwright requests nest_asyncio", shell=True)
subprocess.run("playwright install chromium", shell=True)

import asyncio, re, urllib.parse, requests
import nest_asyncio
nest_asyncio.apply()
from playwright.async_api import async_playwright


def clean(t):
    if not t:
        return ""
    t = re.sub(r"[^\x20-\x7E]+", " ", str(t))
    return re.sub(r"\s+", " ", t).strip()


async def scrape():
    results = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        context = await browser.new_context(
            viewport={"width": 1366, "height": 768},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        )
        page = await context.new_page()

        async def block(route):
            if route.request.resource_type in ("image", "media", "font"):
                await route.abort()
            else:
                await route.continue_()
        await page.route("**/*", block)

        url = f"https://www.google.com/maps/search/{urllib.parse.quote(SEARCH_QUERY)}"
        print(f"Searching: {SEARCH_QUERY}")
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=60000)
        except Exception:
            pass
        await page.wait_for_timeout(5000)

        for i in range(8):
            await page.evaluate(
                "() => { const f=document.querySelector('[role=\"feed\"]'); "
                "if(f) f.scrollTo(0, f.scrollHeight); else window.scrollTo(0, document.body.scrollHeight); }"
            )
            await page.wait_for_timeout(2500)

        links = await page.eval_on_selector_all(
            'a[href*="/maps/place"]', "els => [...new Set(els.map(e => e.href))]"
        )
        print(f"Found {len(links)} businesses")

        for idx, link in enumerate(links[:MAX_RESULTS], 1):
            try:
                await page.goto(link, wait_until="domcontentloaded", timeout=45000)
                await page.wait_for_timeout(2500)

                body = await page.inner_text("body")
                if "permanently closed" in body.lower():
                    continue

                name = ""
                h1 = await page.query_selector("h1")
                if h1:
                    name = clean(await h1.inner_text())
                if not name:
                    continue

                info = await page.evaluate(r"""() => {
                    const r = {address:"",phone:"",website:"",rating:"",reviews:"",category:""};
                    let c = document.querySelector('.DkEaL, .mgr77e, button[jsaction*="category"]');
                    if (c) r.category = c.innerText.trim();
                    const a = document.querySelector('button[data-item-id*="address"]');
                    if (a) { const al=a.getAttribute('aria-label')||''; r.address = al.includes('Address:')?al.replace(/^Address:\s*/i,'').trim():a.innerText.trim(); }
                    const ph = document.querySelector('button[data-item-id*="phone"]');
                    if (ph) { const al=ph.getAttribute('aria-label')||''; if(al.includes('Phone:')) r.phone=al.replace(/^Phone:\s*/i,'').trim(); }
                    const w = document.querySelector('a[data-item-id*="authority"]');
                    if (w) { let h=w.href||''; if(h.includes('google.com/url?q=')){const m=h.match(/[?&]q=([^&]+)/); if(m)h=decodeURIComponent(m[1]);} r.website=h; }
                    const rd = document.querySelector('div[class*="F7nice"]');
                    if (rd){ const m=(rd.innerText||'').match(/([\d.]+)\s*\(([\d,]+)\)/); if(m){r.rating=m[1];r.reviews=m[2].replace(/,/g,'');} }
                    return r;
                }""")

                reviews = []
                try:
                    tab = page.locator('button[role="tab"]:has-text("Reviews"), button[aria-label*="Reviews"]')
                    if await tab.count() > 0:
                        await tab.first.click(timeout=5000)
                        await page.wait_for_timeout(2500)
                        for _ in range(3):
                            await page.evaluate(
                                "() => { const ps=document.querySelectorAll('.m6QErb.DxyBCb.kA9KIf.dS8AEf'); "
                                "if(ps.length){const t=ps[ps.length-1]; t.scrollTo(0,t.scrollHeight);} }"
                            )
                            await page.wait_for_timeout(1500)
                        reviews = await page.evaluate(r"""() => {
                            const out=[]; const bs=document.querySelectorAll('div.jftiEf');
                            for (let i=0;i<Math.min(bs.length,20);i++){
                                const b=bs[i];
                                const nm=b.querySelector('.d4r55'); const dt=b.querySelector('.rsqaWe'); const tx=b.querySelector('.MyEned');
                                const st=b.querySelector('span[role="img"][aria-label*="star"]');
                                let rating=0; if(st){const m=(st.getAttribute('aria-label')||'').match(/([\d.]+)/); if(m)rating=Math.round(parseFloat(m[1]));}
                                const text=tx?tx.innerText.trim().replace(/\n/g,' '):'';
                                if(text) out.push({reviewer_name:nm?nm.innerText.trim():'Anonymous', rating:rating, text:text, date:dt?dt.innerText.trim():''});
                            }
                            return out;
                        }""")
                except Exception:
                    pass

                website = info["website"]
                if "google.com" in website:
                    website = ""

                results.append({
                    "name": name,
                    "category": clean(info["category"]),
                    "address": re.sub(r"^[,.\s]+", "", clean(info["address"])),
                    "phone": clean(info["phone"]),
                    "website": website,
                    "rating": info["rating"] or None,
                    "reviews_count": info["reviews"] or 0,
                    "reviews": reviews,
                })
                print(f"  [{idx}] {name}  ({len(reviews)} reviews)")
            except Exception:
                continue

        await browser.close()
    return results


def push_to_platform(businesses):
    base = PLATFORM_URL.rstrip("/")
    print("Logging in to platform...")
    r = requests.post(f"{base}/api/auth/login", json={"email": EMAIL, "password": PASSWORD}, timeout=30)
    r.raise_for_status()
    token = r.json()["data"]["token"]

    print(f"Uploading {len(businesses)} businesses...")
    resp = requests.post(
        f"{base}/api/campaigns/import",
        json={"query": SEARCH_QUERY, "businesses": businesses},
        headers={"Authorization": f"Bearer {token}"},
        timeout=120,
    )
    resp.raise_for_status()
    print("✅", resp.json().get("message", "Imported."))


# ===================== RUN =====================
data = asyncio.get_event_loop().run_until_complete(scrape())
if data:
    push_to_platform(data)
    print(f"\nDone! {len(data)} businesses sent. Open your Campaigns page — "
          f"website crawl, email verification, AI analysis & outreach are now running.")
else:
    print("No data scraped. Try a more specific query like '<business> in <city>'.")
