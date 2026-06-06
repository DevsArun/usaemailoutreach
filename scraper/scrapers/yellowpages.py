"""YellowPages directory scraper using Playwright + BeautifulSoup."""

from __future__ import annotations

from urllib.parse import quote_plus

from bs4 import BeautifulSoup
from playwright.async_api import TimeoutError as PlaywrightTimeout

from utils.helpers import random_delay, safe_float, safe_int, sanitize_text

from .base import BaseScraper, BusinessData


class YellowPagesScraper(BaseScraper):
    source_name = "yellowpages"

    BASE_URL = "https://www.yellowpages.com"
    SEARCH_URL = "https://www.yellowpages.com/search?search_terms={term}&geo_location_terms={location}"

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
                        term=quote_plus(parts["term"]),
                        location=quote_plus(parts["location"]),
                    )
                    if current_page > 1:
                        url += f"&page={current_page}"

                    await page.goto(url, wait_until="domcontentloaded")
                    await random_delay(2, 4)

                    html = await page.content()
                    page_results = self._parse_results(html)

                    if not page_results:
                        self.logger.info("No more YellowPages results at page %d", current_page)
                        break

                    results.extend(page_results)
                    current_page += 1
                    await random_delay(1.5, 3)

            except PlaywrightTimeout:
                self.logger.warning("Timeout on YellowPages search")
            except Exception as exc:
                self.logger.error("YellowPages scrape error: %s", exc, exc_info=True)
            finally:
                await page.close()
        finally:
            await self.browser.release(context)

        return results[:max_results]

    def _parse_results(self, html: str) -> list[BusinessData]:
        soup = BeautifulSoup(html, "lxml")
        results: list[BusinessData] = []

        listings = soup.select("div.result, div.search-results div.v-card, div.srp-listing")
        if not listings:
            listings = soup.select("div.info")

        for card in listings:
            biz = BusinessData(source=self.source_name)

            # Name
            name_tag = card.select_one("a.business-name, h2 a, a[class*='business-name']")
            if name_tag:
                biz.name = sanitize_text(name_tag.get_text())

            # Phone
            phone_tag = card.select_one("div.phones, div.phone, a[href^='tel:']")
            if phone_tag:
                biz.phone = sanitize_text(phone_tag.get_text())

            # Address
            street = card.select_one("div.street-address, span.street-address")
            locality = card.select_one("div.locality, span.locality")
            addr_parts = []
            if street:
                addr_parts.append(sanitize_text(street.get_text()))
            if locality:
                addr_parts.append(sanitize_text(locality.get_text()))
            biz.address = ", ".join(addr_parts)

            # Website
            website_tag = card.select_one('a.track-visit-website, a[href*="redirect"], a[class*="website"]')
            if website_tag:
                href = website_tag.get("href", "")
                biz.website = href

            # Rating
            rating_tag = card.select_one("div.ratings div.result-rating, div[class*='rating']")
            if rating_tag:
                # Try aria-label or title first (e.g., "4.5 star rating")
                aria = rating_tag.get("aria-label", "") or rating_tag.get("title", "")
                if aria:
                    biz.rating = safe_float(aria)
                else:
                    # Try extracting from text content
                    text = sanitize_text(rating_tag.get_text())
                    if text:
                        biz.rating = safe_float(text)
                    else:
                        # Fallback: count child elements with "star" class
                        stars = rating_tag.select("[class*='star-fill'], [class*='full']")
                        half = rating_tag.select("[class*='half']")
                        if stars:
                            biz.rating = float(len(stars)) + (0.5 * len(half))

            # Category
            cat_tag = card.select_one("div.categories a, a[class*='category']")
            if cat_tag:
                biz.category = sanitize_text(cat_tag.get_text())

            # Reviews count
            review_tag = card.select_one("span.count, a[class*='review-count']")
            if review_tag:
                biz.reviews_count = safe_int(review_tag.get_text())

            if biz.name:
                results.append(biz)

        return results

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
