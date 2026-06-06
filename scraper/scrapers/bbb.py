"""Better Business Bureau (BBB) directory scraper."""

from __future__ import annotations

from urllib.parse import quote_plus

from bs4 import BeautifulSoup
from playwright.async_api import TimeoutError as PlaywrightTimeout

from utils.helpers import random_delay, safe_float, safe_int, sanitize_text

from .base import BaseScraper, BusinessData


class BBBScraper(BaseScraper):
    source_name = "bbb"

    SEARCH_URL = "https://www.bbb.org/search?find_country=US&find_text={query}&find_loc={location}&page={page}"

    async def scrape_businesses(
        self, query: str, *, max_results: int = 50
    ) -> list[BusinessData]:
        results: list[BusinessData] = []
        parts = self._split_query(query)

        context = await self.browser.acquire()
        try:
            page = await self.browser.new_stealth_page(context)
            try:
                current_page = 1
                while len(results) < max_results:
                    url = self.SEARCH_URL.format(
                        query=quote_plus(parts["term"]),
                        location=quote_plus(parts["location"]),
                        page=current_page,
                    )
                    await page.goto(url, wait_until="domcontentloaded")
                    await random_delay(2, 4)

                    html = await page.content()
                    page_results = self._parse_results(html)

                    if not page_results:
                        self.logger.info("No more BBB results at page %d", current_page)
                        break

                    results.extend(page_results)
                    current_page += 1
                    await random_delay(1.5, 3)

            except PlaywrightTimeout:
                self.logger.warning("Timeout on BBB search")
            except Exception as exc:
                self.logger.error("BBB scrape error: %s", exc, exc_info=True)
            finally:
                await page.close()
        finally:
            await self.browser.release(context)

        return results[:max_results]

    def _parse_results(self, html: str) -> list[BusinessData]:
        soup = BeautifulSoup(html, "lxml")
        results: list[BusinessData] = []

        # BBB result cards
        cards = soup.select('div[class*="result-item"], div[class*="search-result"], li[class*="result"]')
        if not cards:
            cards = soup.select("a[class*='business-card'], div[data-testid*='result']")

        for card in cards:
            biz = BusinessData(source=self.source_name)

            # Name
            name_tag = card.select_one("h3 a, h4 a, a[class*='business-name'], span[class*='name']")
            if name_tag:
                biz.name = sanitize_text(name_tag.get_text())

            # BBB Rating (A+, A, B, etc.)
            rating_tag = card.select_one('span[class*="rating"], div[class*="rating"], span[class*="grade"]')
            if rating_tag:
                grade_text = sanitize_text(rating_tag.get_text())
                biz.rating = self._grade_to_float(grade_text)

            # Phone
            phone_tag = card.select_one('a[href^="tel:"], span[class*="phone"]')
            if phone_tag:
                biz.phone = sanitize_text(phone_tag.get_text())

            # Address
            addr_tag = card.select_one('p[class*="address"], span[class*="address"], address')
            if addr_tag:
                biz.address = sanitize_text(addr_tag.get_text())

            # Category
            cat_tag = card.select_one('span[class*="category"], div[class*="category"]')
            if cat_tag:
                biz.category = sanitize_text(cat_tag.get_text())

            # Website
            website_tag = card.select_one('a[class*="website"], a[href*="redirect"]')
            if website_tag:
                biz.website = website_tag.get("href", "")

            # Reviews / complaints count
            review_tag = card.select_one('span[class*="review"], span[class*="complaint"]')
            if review_tag:
                biz.reviews_count = safe_int(review_tag.get_text())

            if biz.name:
                results.append(biz)

        return results

    @staticmethod
    def _grade_to_float(grade: str) -> float:
        """Convert a BBB letter grade to a numeric score 0-5."""
        mapping = {
            "A+": 5.0, "A-": 4.3, "A": 4.7,
            "B+": 4.0, "B-": 3.3, "B": 3.7,
            "C+": 3.0, "C-": 2.3, "C": 2.7,
            "D+": 2.0, "D-": 1.3, "D": 1.7,
            "F": 1.0,
        }
        cleaned = grade.strip().upper()
        # Try exact match first
        if cleaned in mapping:
            return mapping[cleaned]
        # Then try substring (longer keys checked first thanks to ordering)
        for key, value in mapping.items():
            if key in cleaned:
                return value
        return 0.0

    @staticmethod
    def _split_query(query: str) -> dict[str, str]:
        lower = query.lower()
        for sep in [" in ", " near ", " around ", " at "]:
            if sep in lower:
                idx = lower.index(sep)
                return {
                    "term": query[:idx].strip(),
                    "location": query[idx + len(sep):].strip(),
                }
        return {"term": query, "location": ""}
