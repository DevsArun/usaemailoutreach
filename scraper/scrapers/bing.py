"""Bing Places / Bing Maps local results scraper."""

from __future__ import annotations

from urllib.parse import quote_plus

from bs4 import BeautifulSoup
from playwright.async_api import TimeoutError as PlaywrightTimeout

from utils.helpers import random_delay, safe_float, safe_int, sanitize_text

from .base import BaseScraper, BusinessData


class BingPlacesScraper(BaseScraper):
    source_name = "bing"

    SEARCH_URL = "https://www.bing.com/maps?q={query}"

    async def scrape_businesses(
        self, query: str, *, max_results: int = 50
    ) -> list[BusinessData]:
        results: list[BusinessData] = []
        context = await self.browser.acquire()
        try:
            page = await self.browser.new_stealth_page(context)
            try:
                url = self.SEARCH_URL.format(query=quote_plus(query))
                await page.goto(url, wait_until="domcontentloaded")
                await random_delay(2, 4)

                # Wait for results list
                try:
                    await page.wait_for_selector(
                        'div.entity-listing, div[class*="listItem"], li[class*="bm_listings"]',
                        timeout=12_000,
                    )
                except PlaywrightTimeout:
                    self.logger.warning("Bing Maps results list not found")

                # Scroll for more results
                listing_container = await page.query_selector(
                    'div[class*="taskPanel"], div[id="TextFeed"]'
                )
                if listing_container:
                    for _ in range(min(max_results // 5, 10)):
                        await page.evaluate(
                            "(el) => el.scrollTop = el.scrollHeight", listing_container
                        )
                        await random_delay(1, 2)

                html = await page.content()
                results = self._parse_results(html)

                # If BS4 produced nothing, try DOM extraction
                if not results:
                    results = await self._dom_extract(page)

            except PlaywrightTimeout:
                self.logger.warning("Timeout on Bing search")
            except Exception as exc:
                self.logger.error("Bing scrape error: %s", exc, exc_info=True)
            finally:
                await page.close()
        finally:
            await self.browser.release(context)

        return results[:max_results]

    def _parse_results(self, html: str) -> list[BusinessData]:
        soup = BeautifulSoup(html, "lxml")
        results: list[BusinessData] = []

        cards = soup.select(
            "div.entity-listing, li[class*='bm_listings'], div[class*='listItem']"
        )
        for card in cards:
            biz = BusinessData(source=self.source_name)

            name_tag = card.select_one("a[class*='name'], h2, div[class*='title']")
            if name_tag:
                biz.name = sanitize_text(name_tag.get_text())

            addr_tag = card.select_one("div[class*='address'], span[class*='addr']")
            if addr_tag:
                biz.address = sanitize_text(addr_tag.get_text())

            phone_tag = card.select_one("a[href^='tel:'], span[class*='phone']")
            if phone_tag:
                biz.phone = sanitize_text(phone_tag.get_text())

            rating_tag = card.select_one("span[class*='rating'], div[class*='star']")
            if rating_tag:
                biz.rating = safe_float(rating_tag.get("aria-label", rating_tag.get_text()))

            review_tag = card.select_one("span[class*='count'], span[class*='reviews']")
            if review_tag:
                biz.reviews_count = safe_int(review_tag.get_text())

            cat_tag = card.select_one("span[class*='category'], div[class*='type']")
            if cat_tag:
                biz.category = sanitize_text(cat_tag.get_text())

            website_tag = card.select_one("a[class*='website'], a[href*='redirect']")
            if website_tag:
                biz.website = website_tag.get("href", "")

            if biz.name:
                results.append(biz)

        return results

    async def _dom_extract(self, page) -> list[BusinessData]:
        results: list[BusinessData] = []
        items = await page.query_selector_all(
            "div.entity-listing, li[class*='bm_listings'], div[class*='listItem']"
        )
        for item in items:
            biz = BusinessData(source=self.source_name)
            text = await item.inner_text()
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            if lines:
                biz.name = lines[0]
            if len(lines) > 1:
                biz.address = lines[1]
            if biz.name:
                results.append(biz)
        return results
