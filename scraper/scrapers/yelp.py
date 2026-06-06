"""Yelp business directory scraper using Playwright + BeautifulSoup fallback."""

from __future__ import annotations

from urllib.parse import quote_plus, urljoin

from bs4 import BeautifulSoup
from playwright.async_api import TimeoutError as PlaywrightTimeout

from utils.helpers import random_delay, safe_float, safe_int, sanitize_text

from .base import BaseScraper, BusinessData, ReviewData


class YelpScraper(BaseScraper):
    source_name = "yelp"

    BASE_URL = "https://www.yelp.com"
    SEARCH_URL = "https://www.yelp.com/search?find_desc={query}&find_loc={location}"

    async def scrape_businesses(
        self, query: str, *, max_results: int = 50
    ) -> list[BusinessData]:
        results: list[BusinessData] = []
        parts = self._split_query(query)
        search_term = parts["term"]
        location = parts["location"]

        context = await self.browser.acquire()
        try:
            page = await self.browser.new_stealth_page(context)
            try:
                start = 0
                per_page = 10

                while len(results) < max_results:
                    url = self.SEARCH_URL.format(
                        query=quote_plus(search_term), location=quote_plus(location)
                    )
                    if start > 0:
                        url += f"&start={start}"

                    await page.goto(url, wait_until="domcontentloaded")
                    await random_delay(2, 4)

                    html = await page.content()
                    page_results = self._parse_search_page(html)

                    if not page_results:
                        # Attempt a fallback parse – the page may have changed layout
                        page_results = await self._extract_with_selectors(page)

                    if not page_results:
                        self.logger.info("No more results at offset %d", start)
                        break

                    results.extend(page_results)
                    start += per_page
                    await random_delay(1.5, 3)

            except PlaywrightTimeout:
                self.logger.warning("Timeout on Yelp search")
            except Exception as exc:
                self.logger.error("Yelp scrape error: %s", exc, exc_info=True)
            finally:
                await page.close()
        finally:
            await self.browser.release(context)

        return results[:max_results]

    async def scrape_reviews(
        self,
        business_name: str,
        location: str,
        *,
        max_reviews: int = 20,
    ) -> list[ReviewData]:
        reviews: list[ReviewData] = []
        context = await self.browser.acquire()
        try:
            page = await self.browser.new_stealth_page(context)
            try:
                url = self.SEARCH_URL.format(
                    query=quote_plus(business_name), location=quote_plus(location)
                )
                await page.goto(url, wait_until="domcontentloaded")
                await random_delay(2, 3)

                # Click the first result
                first_link = await page.query_selector('a[href*="/biz/"]')
                if first_link:
                    href = await first_link.get_attribute("href")
                    if href:
                        biz_url = urljoin(self.BASE_URL, href)
                        await page.goto(biz_url, wait_until="domcontentloaded")
                        await random_delay(2, 3)

                html = await page.content()
                reviews = self._parse_reviews(html, max_reviews)

            except Exception as exc:
                self.logger.error("Yelp review scrape error: %s", exc, exc_info=True)
            finally:
                await page.close()
        finally:
            await self.browser.release(context)
        return reviews

    # ---- parsing helpers ----

    def _parse_search_page(self, html: str) -> list[BusinessData]:
        soup = BeautifulSoup(html, "lxml")
        results: list[BusinessData] = []

        # Yelp uses various containers – try multiple strategies
        containers = soup.select('[data-testid="serp-ia-card"]')
        if not containers:
            containers = soup.select("li .container__09f24__FeTO6")
        if not containers:
            containers = soup.select("div.arrange-unit__09f24__rqHTg")
        if not containers:
            # Broad fallback: look for links to /biz/
            biz_links = soup.select('a[href*="/biz/"]')
            for link in biz_links:
                parent = link.find_parent("div")
                if parent and parent not in containers:
                    containers.append(parent)

        for card in containers:
            biz = BusinessData(source=self.source_name)

            # Name
            name_tag = card.select_one("a[href*='/biz/'] span, a[href*='/biz/'] h3, h3 a")
            if name_tag:
                biz.name = sanitize_text(name_tag.get_text())

            # Rating
            rating_tag = card.select_one('[aria-label*="star rating"], [class*="star"]')
            if rating_tag:
                aria = rating_tag.get("aria-label", "")
                biz.rating = safe_float(aria)

            # Reviews count
            review_tag = card.select_one('span[class*="reviewCount"], a[href*="reviews"]')
            if review_tag:
                biz.reviews_count = safe_int(review_tag.get_text())

            # Category
            cat_tag = card.select_one('span[class*="category"], a[href*="cflt"]')
            if cat_tag:
                biz.category = sanitize_text(cat_tag.get_text())

            # Address / location snippet
            addr_tag = card.select_one('span[class*="secondaryAttributes"], address')
            if addr_tag:
                biz.address = sanitize_text(addr_tag.get_text())

            # Phone
            phone_tag = card.select_one('p[class*="phone"], span[class*="phone"]')
            if phone_tag:
                biz.phone = sanitize_text(phone_tag.get_text())

            # Website link from the card (rare on search page)
            website_tag = card.select_one('a[href*="biz_redir"]')
            if website_tag:
                biz.website = website_tag.get("href", "")

            if biz.name:
                results.append(biz)

        return results

    async def _extract_with_selectors(self, page) -> list[BusinessData]:
        """DOM-based fallback extraction when BS4 parsing fails."""
        results: list[BusinessData] = []
        cards = await page.query_selector_all('div[class*="container"] a[href*="/biz/"]')
        for card in cards:
            biz = BusinessData(source=self.source_name)
            text = await card.inner_text()
            biz.name = sanitize_text(text.split("\n")[0]) if text else ""
            if biz.name:
                results.append(biz)
        return results

    def _parse_reviews(self, html: str, max_reviews: int) -> list[ReviewData]:
        soup = BeautifulSoup(html, "lxml")
        reviews: list[ReviewData] = []

        review_blocks = soup.select('[class*="review__09f24"], [data-review-id], li[class*="margin"]')
        for block in review_blocks[:max_reviews]:
            review = ReviewData(source=self.source_name)

            name_tag = block.select_one('a[href*="/user_details"] span, span[class*="user"]')
            if name_tag:
                review.reviewer_name = sanitize_text(name_tag.get_text())

            rating_tag = block.select_one('[aria-label*="star rating"]')
            if rating_tag:
                review.rating = safe_int(rating_tag.get("aria-label", ""))

            text_tag = block.select_one('p[class*="comment"], span[class*="raw"]')
            if text_tag:
                review.text = sanitize_text(text_tag.get_text())

            date_tag = block.select_one('span[class*="date"], time')
            if date_tag:
                review.date = sanitize_text(date_tag.get_text())

            if review.text:
                reviews.append(review)

        return reviews

    @staticmethod
    def _split_query(query: str) -> dict[str, str]:
        """Split a freeform query like 'Plumber in New York' into term + location."""
        lower = query.lower()
        for sep in [" in ", " near ", " around ", " at "]:
            if sep in lower:
                idx = lower.index(sep)
                return {
                    "term": query[:idx].strip(),
                    "location": query[idx + len(sep):].strip(),
                }
        return {"term": query, "location": ""}
