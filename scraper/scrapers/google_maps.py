"""Google Maps scraper using Playwright.

Reliable approach (proven in production): instead of clicking each card in
the results feed, we collect every ``/maps/place`` link first, then navigate
to each listing URL directly and extract details + recent reviews with a
single page.evaluate() call using stable Google Maps selectors.
"""

from __future__ import annotations

import os
import re
import time
from urllib.parse import quote

from playwright.async_api import Page, TimeoutError as PlaywrightTimeout

from utils.helpers import random_delay, safe_float, safe_int, sanitize_text

from .base import BaseScraper, BusinessData, ReviewData


class GoogleMapsScraper(BaseScraper):
    source_name = "google_maps"

    MAPS_SEARCH_URL = "https://www.google.com/maps/search/{query}?hl=en&gl=us"

    # ── public API ──────────────────────────────────────────────────────
    async def scrape_businesses(
        self, query: str, *, max_results: int = 50
    ) -> list[BusinessData]:
        results: list[BusinessData] = []
        context = await self.browser.acquire()
        try:
            # Pre-set Google's consent cookie to bypass the cookie/consent wall
            # that datacenter IPs (HF Spaces, Render, etc.) almost always hit —
            # this is the usual reason "0 business links" are found.
            try:
                await context.add_cookies([
                    {"name": "CONSENT", "value": "YES+cb.20240101-00-p0.en+FX+000",
                     "domain": ".google.com", "path": "/"},
                    {"name": "SOCS", "value": "CAISNQgDEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwMTAxLjA0X3AwGgJlbiACGgYIgL...",
                     "domain": ".google.com", "path": "/"},
                ])
            except Exception:
                pass

            page = await self.browser.new_stealth_page(context)
            # Block images / media to speed up navigation.
            await self._block_heavy_resources(page)
            try:
                url = self.MAPS_SEARCH_URL.format(query=quote(query))
                links = []
                for attempt in range(2):
                    try:
                        await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                    except PlaywrightTimeout:
                        self.logger.warning("Maps load timed out (attempt %d)", attempt + 1)
                    await page.wait_for_timeout(5_000)
                    await self._dismiss_consent(page)

                    # Wait for the results feed / listings to actually appear.
                    try:
                        await page.wait_for_selector(
                            'a[href*="/maps/place"], [role="feed"], div[role="article"]',
                            timeout=20_000,
                        )
                    except Exception:
                        self.logger.warning("Results feed did not appear within 20s (attempt %d)", attempt + 1)

                    await self._scroll_results(page, scrolls=8)

                    links = await page.eval_on_selector_all(
                        'a[href*="/maps/place"]',
                        "els => [...new Set(els.map(e => e.href))]",
                    )
                    if links:
                        break
                    self.logger.warning("No links on attempt %d; reloading...", attempt + 1)
                    await page.wait_for_timeout(3_000)

                if not links:
                    try:
                        title = await page.title()
                        self.logger.warning(
                            "0 place links found. Likely datacenter-IP soft-block. "
                            "title='%s' url='%s' — consider setting PROXY_URLS (residential proxy).",
                            title, page.url,
                        )
                    except Exception:
                        pass
                self.logger.info("Found %d business links for '%s'", len(links), query)

                # Time budget so we always return what we have rather than being
                # cancelled (and losing everything) by the outer timeout.
                budget = float(os.getenv("SCRAPE_TIME_BUDGET", "480"))
                deadline = time.monotonic() + budget

                for idx, link in enumerate(links[:max_results], 1):
                    if len(results) >= max_results:
                        break
                    if time.monotonic() > deadline:
                        self.logger.warning(
                            "Scrape time budget reached; returning %d businesses", len(results)
                        )
                        break
                    try:
                        biz = await self._scrape_place(page, link)
                        if biz and biz.name and biz.name != "N/A":
                            results.append(biz)
                            self.logger.info("  [%d] %s", idx, biz.name)
                    except Exception as exc:
                        self.logger.debug("Error on place %d: %s", idx, exc)
                    await random_delay(0.8, 1.8)

            except Exception as exc:
                self.logger.error("Google Maps scrape error: %s", exc, exc_info=True)
            finally:
                await page.close()
        finally:
            await self.browser.release(context)

        return results

    async def scrape_reviews(
        self,
        business_name: str,
        location: str,
        *,
        max_reviews: int = 20,
    ) -> list[ReviewData]:
        """Standalone review scrape (kept for the /scrape/reviews endpoint).

        The main pipeline now collects reviews inline during business scraping,
        but this remains available for ad-hoc requests.
        """
        reviews: list[ReviewData] = []
        context = await self.browser.acquire()
        try:
            page = await self.browser.new_stealth_page(context)
            await self._block_heavy_resources(page)
            try:
                query = f"{business_name} {location}".strip()
                url = self.MAPS_SEARCH_URL.format(query=quote(query))
                try:
                    await page.goto(url, wait_until="domcontentloaded", timeout=60_000)
                except PlaywrightTimeout:
                    pass
                await page.wait_for_timeout(4_000)
                await self._dismiss_consent(page)

                first_link = await page.query_selector('a[href*="/maps/place"]')
                if first_link:
                    href = await first_link.get_attribute("href")
                    if href:
                        await page.goto(href, wait_until="domcontentloaded", timeout=45_000)
                        await page.wait_for_timeout(3_000)

                raw = await self._extract_reviews(page, max_reviews)
                for r in raw:
                    reviews.append(ReviewData(
                        reviewer_name=r.get("reviewer_name", ""),
                        rating=safe_int(r.get("rating", 0)),
                        text=r.get("text", ""),
                        date=r.get("date", ""),
                        source=self.source_name,
                    ))
            except Exception as exc:
                self.logger.error("Review scrape error: %s", exc, exc_info=True)
            finally:
                await page.close()
        finally:
            await self.browser.release(context)

        return reviews

    # ── internal helpers ────────────────────────────────────────────────
    async def _block_heavy_resources(self, page: Page) -> None:
        async def _route(route):
            if route.request.resource_type in ("image", "media", "font"):
                try:
                    await route.abort()
                except Exception:
                    pass
            else:
                try:
                    await route.continue_()
                except Exception:
                    pass

        try:
            await page.route("**/*", _route)
        except Exception:
            pass

    async def _dismiss_consent(self, page: Page) -> None:
        for selector in [
            'button[aria-label="Accept all"]',
            'button[aria-label="Reject all"]',
            "form[action*='consent'] button",
            "button:has-text('Accept all')",
            "button:has-text('I agree')",
        ]:
            try:
                btn = await page.query_selector(selector)
                if btn:
                    await btn.click()
                    await page.wait_for_timeout(1_000)
                    break
            except Exception:
                pass

    async def _scroll_results(self, page: Page, *, scrolls: int = 8) -> None:
        for i in range(scrolls):
            try:
                await page.evaluate(
                    """() => {
                        const feed = document.querySelector('[role="feed"]');
                        if (feed) { feed.scrollTo(0, feed.scrollHeight); }
                        else { window.scrollTo(0, document.body.scrollHeight); }
                    }"""
                )
                await page.wait_for_timeout(2_500)
            except Exception:
                break

    async def _scrape_place(self, page: Page, link: str) -> BusinessData | None:
        biz = BusinessData(source=self.source_name, place_url=link)

        await page.goto(link, wait_until="domcontentloaded", timeout=45_000)
        await page.wait_for_timeout(2_500)

        # Skip permanently-closed listings.
        try:
            body = await page.inner_text("body")
            if body and "permanently closed" in body.lower():
                return None
        except Exception:
            pass

        # Name from the H1 header.
        try:
            h1 = await page.query_selector("h1")
            if h1:
                biz.name = sanitize_text(await h1.inner_text())
        except Exception:
            pass

        # Core details via a single evaluate (stable Maps selectors).
        info = await page.evaluate(
            r"""() => {
                const r = { address: "", phone: "", website: "", rating: "", reviews: "", category: "" };

                let catEl = document.querySelector('.DkEaL, .mgr77e, .LBgpqf .fontBodyMedium, button[jsaction*="category"]');
                if (catEl && catEl.innerText) r.category = catEl.innerText.trim();

                const addrBtn = document.querySelector('button[data-item-id*="address"]');
                if (addrBtn) {
                    const aria = addrBtn.getAttribute('aria-label') || '';
                    if (aria.toLowerCase().includes('address:')) r.address = aria.replace(/^Address:\s*/i, '').trim();
                    else r.address = (addrBtn.innerText || '').trim().replace(/\n/g, ', ');
                }

                const phoneBtn = document.querySelector('button[data-item-id*="phone"]');
                if (phoneBtn) {
                    const aria = phoneBtn.getAttribute('aria-label') || '';
                    if (aria.toLowerCase().includes('phone:')) {
                        r.phone = aria.replace(/^Phone:\s*/i, '').trim();
                    } else {
                        const container = phoneBtn.closest('div[role="region"]') || phoneBtn.parentElement;
                        if (container) {
                            for (const div of container.querySelectorAll('div')) {
                                const txt = (div.innerText || '').trim();
                                const digits = txt.replace(/\D/g, '');
                                if (digits.length >= 10 && digits.length <= 13 && /^[\d\s\+\-\(\)]+$/.test(txt)) { r.phone = txt; break; }
                            }
                        }
                    }
                }

                const webBtn = document.querySelector('a[data-item-id*="authority"]');
                if (webBtn) {
                    let href = webBtn.href || '';
                    if (href.includes('google.com/url?q=')) {
                        const m = href.match(/[?&]q=([^&]+)/);
                        if (m) href = decodeURIComponent(m[1]);
                    }
                    r.website = href;
                }

                const rateDiv = document.querySelector('div[class*="F7nice"]');
                if (rateDiv) {
                    const m = (rateDiv.innerText || '').match(/([\d.]+)\s*\(([\d,]+)\)/);
                    if (m) { r.rating = m[1]; r.reviews = m[2].replace(/,/g, ''); }
                }
                return r;
            }"""
        )

        biz.address = sanitize_text(re.sub(r"^[,.\s]+", "", info.get("address", "") or ""))
        phone = sanitize_text(info.get("phone", "") or "")
        biz.phone = phone if len(re.sub(r"\D", "", phone)) >= 10 else ""
        website = (info.get("website", "") or "").strip()
        biz.website = website if website and "google.com" not in website else ""
        biz.category = sanitize_text(info.get("category", "") or "")
        biz.rating = safe_float(info.get("rating", "")) if info.get("rating") else 0.0
        biz.reviews_count = safe_int(info.get("reviews", "")) if info.get("reviews") else 0

        # Coordinates from the place URL.
        coord = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", page.url)
        if coord:
            biz.latitude = float(coord.group(1))
            biz.longitude = float(coord.group(2))

        # Recent reviews (best effort).
        try:
            biz.reviews = await self._extract_reviews(page, 20)
        except Exception:
            biz.reviews = []

        return biz

    async def _extract_reviews(self, page: Page, max_reviews: int) -> list[dict]:
        """Open the Reviews tab and extract recent reviews."""
        try:
            tab = page.locator(
                'button[role="tab"]:has-text("Reviews"), '
                'button[aria-label*="Reviews"], '
                'button[jsaction*="reviewChart"]'
            )
            if await tab.count() > 0:
                await tab.first.click(timeout=5_000)
                await page.wait_for_timeout(2_500)
            else:
                return []
        except Exception:
            return []

        # Scroll the reviews pane to load more.
        for _ in range(3):
            try:
                await page.evaluate(
                    """() => {
                        const panes = document.querySelectorAll('.m6QErb.DxyBCb.kA9KIf.dS8AEf, div[class*="m6QErb"][tabindex="-1"]');
                        if (panes.length) { const t = panes[panes.length - 1]; t.scrollTo(0, t.scrollHeight); }
                    }"""
                )
                await page.wait_for_timeout(1_500)
            except Exception:
                break

        try:
            reviews = await page.evaluate(
                r"""(maxReviews) => {
                    const blocks = document.querySelectorAll('div.jftiEf, div[data-review-id]');
                    const out = [];
                    for (let i = 0; i < Math.min(blocks.length, maxReviews); i++) {
                        const b = blocks[i];
                        const nameEl = b.querySelector('.d4r55, div[class*="fontTitleMedium"]');
                        const dateEl = b.querySelector('.rsqaWe, span[class*="rsqaWe"]');
                        const textEl = b.querySelector('.MyEned, span[class*="wiI7pd"]');
                        const starEl = b.querySelector('span[role="img"][aria-label*="star"], .kvMYJc');
                        let rating = 0;
                        if (starEl) {
                            const al = starEl.getAttribute('aria-label') || '';
                            const m = al.match(/([\d.]+)/);
                            if (m) rating = Math.round(parseFloat(m[1]));
                        }
                        const text = textEl ? (textEl.innerText || '').trim().replace(/\n/g, ' ') : '';
                        if (text) {
                            out.push({
                                reviewer_name: nameEl ? (nameEl.innerText || '').trim() : 'Anonymous',
                                rating: rating,
                                text: text,
                                date: dateEl ? (dateEl.innerText || '').trim() : '',
                            });
                        }
                    }
                    return out;
                }""",
                max_reviews,
            )
            return reviews or []
        except Exception:
            return []
