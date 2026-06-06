"""Facebook Business Pages scraper using Playwright."""

from __future__ import annotations

from urllib.parse import quote_plus

from bs4 import BeautifulSoup
from playwright.async_api import TimeoutError as PlaywrightTimeout

from utils.helpers import random_delay, safe_float, safe_int, sanitize_text

from .base import BaseScraper, BusinessData


class FacebookScraper(BaseScraper):
    source_name = "facebook"

    SEARCH_URL = "https://www.facebook.com/search/pages/?q={query}"
    PUBLIC_SEARCH_URL = "https://www.facebook.com/public/{query}"

    async def scrape_businesses(
        self, query: str, *, max_results: int = 50
    ) -> list[BusinessData]:
        results: list[BusinessData] = []
        context = await self.browser.acquire()
        try:
            page = await self.browser.new_stealth_page(context)
            try:
                # Try public search first (no login required)
                url = self.PUBLIC_SEARCH_URL.format(query=quote_plus(query))
                await page.goto(url, wait_until="domcontentloaded")
                await random_delay(2, 4)

                # Check for login wall
                login_wall = await page.query_selector('div[id="login_form"], div[data-testid="login_form"]')
                if login_wall:
                    self.logger.info("Facebook login wall detected – using search endpoint")
                    url = self.SEARCH_URL.format(query=quote_plus(query))
                    await page.goto(url, wait_until="domcontentloaded")
                    await random_delay(2, 4)

                # Scroll to load more
                for _ in range(min(max_results // 5, 8)):
                    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                    await random_delay(1.5, 2.5)

                html = await page.content()
                results = self._parse_results(html)

                # DOM fallback
                if not results:
                    results = await self._dom_extract(page)

            except PlaywrightTimeout:
                self.logger.warning("Timeout on Facebook search")
            except Exception as exc:
                self.logger.error("Facebook scrape error: %s", exc, exc_info=True)
            finally:
                await page.close()
        finally:
            await self.browser.release(context)

        return results[:max_results]

    def _parse_results(self, html: str) -> list[BusinessData]:
        soup = BeautifulSoup(html, "lxml")
        results: list[BusinessData] = []

        # Public page listings
        cards = soup.select(
            'div[data-testid="browse-result-content"], '
            'div[class*="search-result"], '
            'div[role="article"]'
        )

        for card in cards:
            biz = BusinessData(source=self.source_name)

            # Name
            name_tag = card.select_one(
                'a[role="presentation"] span, '
                "h2 span, "
                'span[dir="auto"]'
            )
            if name_tag:
                biz.name = sanitize_text(name_tag.get_text())

            # Category
            cat_tag = card.select_one('span[class*="category"], div[class*="type"]')
            if cat_tag:
                biz.category = sanitize_text(cat_tag.get_text())

            # Rating
            rating_tag = card.select_one('span[class*="rating"]')
            if rating_tag:
                biz.rating = safe_float(rating_tag.get_text())

            # Link to page
            link_tag = card.select_one("a[href*='facebook.com/']")
            if link_tag:
                href = link_tag.get("href", "")
                if href and "/search/" not in href:
                    biz.social_links["facebook"] = href

            # Phone
            phone_tag = card.select_one('span[class*="phone"]')
            if phone_tag:
                biz.phone = sanitize_text(phone_tag.get_text())

            # Address
            addr_tag = card.select_one('span[class*="location"], span[class*="address"]')
            if addr_tag:
                biz.address = sanitize_text(addr_tag.get_text())

            if biz.name:
                results.append(biz)

        return results

    async def _dom_extract(self, page) -> list[BusinessData]:
        """Fallback: extract data directly from visible DOM."""
        results: list[BusinessData] = []
        articles = await page.query_selector_all('div[role="article"]')
        for article in articles:
            biz = BusinessData(source=self.source_name)
            text = await article.inner_text()
            lines = [l.strip() for l in text.split("\n") if l.strip()]
            if lines:
                biz.name = sanitize_text(lines[0])
            if len(lines) > 1:
                biz.category = sanitize_text(lines[1])

            # Try to grab the page link
            link = await article.query_selector("a[href*='facebook.com/']")
            if link:
                href = await link.get_attribute("href")
                if href:
                    biz.social_links["facebook"] = href

            if biz.name:
                results.append(biz)

        return results
