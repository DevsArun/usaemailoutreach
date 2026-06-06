"""Google Maps scraper using Playwright with stealth."""

from __future__ import annotations

import asyncio
import re
from urllib.parse import quote_plus

from playwright.async_api import Page, TimeoutError as PlaywrightTimeout

from utils.helpers import random_delay, safe_float, safe_int, sanitize_text

from .base import BaseScraper, BusinessData, ReviewData


class GoogleMapsScraper(BaseScraper):
    source_name = "google_maps"

    MAPS_SEARCH_URL = "https://www.google.com/maps/search/{query}"

    async def scrape_businesses(
        self, query: str, *, max_results: int = 50
    ) -> list[BusinessData]:
        results: list[BusinessData] = []
        context = await self.browser.acquire()
        try:
            page = await self.browser.new_stealth_page(context)
            try:
                url = self.MAPS_SEARCH_URL.format(query=quote_plus(query))
                await page.goto(url, wait_until="domcontentloaded")
                await random_delay(2, 4)

                # Accept cookies / consent if prompted
                await self._dismiss_consent(page)

                # Wait for the results feed to appear
                feed_selector = 'div[role="feed"]'
                try:
                    await page.wait_for_selector(feed_selector, timeout=15_000)
                except PlaywrightTimeout:
                    self.logger.warning("Results feed not found – page layout may have changed")
                    return results

                # Scroll to load more results
                results_loaded = await self._scroll_results(page, feed_selector, max_results)
                self.logger.info("Loaded %d result cards", results_loaded)

                # Gather listing links
                cards = await page.query_selector_all(f'{feed_selector} a[href*="/maps/place/"]')
                cards = cards[:max_results]

                for idx, card in enumerate(cards):
                    if len(results) >= max_results:
                        break
                    try:
                        biz = await self._extract_card(page, card)
                        if biz and biz.name:
                            results.append(biz)
                    except Exception as exc:
                        self.logger.debug("Error extracting card %d: %s", idx, exc)
                    await random_delay(1, 2.5)

            except PlaywrightTimeout:
                self.logger.warning("Timeout during Google Maps scraping")
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
        reviews: list[ReviewData] = []
        context = await self.browser.acquire()
        try:
            page = await self.browser.new_stealth_page(context)
            try:
                query = f"{business_name} {location}"
                url = self.MAPS_SEARCH_URL.format(query=quote_plus(query))
                await page.goto(url, wait_until="domcontentloaded")
                await random_delay(2, 4)
                await self._dismiss_consent(page)

                # Click the first result to open the detail panel
                first_link = await page.query_selector('a[href*="/maps/place/"]')
                if first_link:
                    await first_link.click()
                    await random_delay(2, 3)

                # Click the reviews tab / "Reviews" button
                reviews_btn = await page.query_selector('button[aria-label*="Reviews"], button[data-tab-index="1"]')
                if reviews_btn:
                    await reviews_btn.click()
                    await random_delay(2, 3)

                # Scroll the reviews container
                review_container = await page.query_selector('div[class*="review"]')
                if review_container:
                    for _ in range(max_reviews // 3 + 1):
                        await page.evaluate("(el) => el.scrollTop = el.scrollHeight", review_container)
                        await random_delay(1, 2)

                # Extract reviews
                review_elements = await page.query_selector_all('div[data-review-id], div[class*="review"]')
                for el in review_elements[:max_reviews]:
                    try:
                        review = await self._extract_review(el)
                        if review and review.text:
                            reviews.append(review)
                    except Exception:
                        pass
            except Exception as exc:
                self.logger.error("Google Maps review scrape error: %s", exc, exc_info=True)
            finally:
                await page.close()
        finally:
            await self.browser.release(context)

        return reviews

    # ---- internal helpers ----

    async def _dismiss_consent(self, page: Page) -> None:
        """Try to dismiss Google consent / cookie banners."""
        for selector in [
            'button[aria-label="Accept all"]',
            'form[action*="consent"] button',
            "button:has-text('Accept')",
            "button:has-text('Reject all')",
        ]:
            try:
                btn = await page.query_selector(selector)
                if btn:
                    await btn.click()
                    await random_delay(0.5, 1)
                    break
            except Exception:
                pass

    async def _scroll_results(
        self, page: Page, feed_selector: str, target: int
    ) -> int:
        """Scroll the results feed until *target* cards are loaded or no more appear."""
        prev_count = 0
        stall_count = 0
        for _ in range(30):  # max 30 scroll iterations
            cards = await page.query_selector_all(f'{feed_selector} a[href*="/maps/place/"]')
            count = len(cards)
            if count >= target:
                return count
            if count == prev_count:
                stall_count += 1
                if stall_count >= 3:
                    return count
            else:
                stall_count = 0
            prev_count = count

            feed = await page.query_selector(feed_selector)
            if feed:
                await page.evaluate("(el) => el.scrollTop = el.scrollHeight", feed)
            await random_delay(1, 2)
        return prev_count

    async def _extract_card(self, page: Page, card) -> BusinessData | None:
        """Click a result card and scrape the detail panel."""
        biz = BusinessData(source=self.source_name)

        # Get basic info visible on the card
        aria = await card.get_attribute("aria-label")
        if aria:
            biz.name = sanitize_text(aria)

        try:
            await card.click()
            await random_delay(1.5, 3)
        except Exception:
            return biz if biz.name else None

        # Name from header
        name_el = await page.query_selector('h1[class*="header"], h1[class*="title"]')
        if name_el:
            txt = await name_el.inner_text()
            if txt:
                biz.name = sanitize_text(txt)

        # Rating
        rating_el = await page.query_selector('span[aria-hidden="true"][role="img"], div[class*="rating"] span')
        if rating_el:
            biz.rating = safe_float(await rating_el.inner_text())

        # Reviews count
        review_el = await page.query_selector('button[aria-label*="reviews"], span[aria-label*="reviews"]')
        if review_el:
            label = await review_el.get_attribute("aria-label") or await review_el.inner_text()
            biz.reviews_count = safe_int(label)

        # Category
        cat_el = await page.query_selector('button[jsaction*="category"], span[class*="category"]')
        if cat_el:
            biz.category = sanitize_text(await cat_el.inner_text())

        # Address, phone, website from info rows
        info_buttons = await page.query_selector_all('button[data-item-id], a[data-item-id]')
        for btn in info_buttons:
            item_id = await btn.get_attribute("data-item-id") or ""
            aria_label = await btn.get_attribute("aria-label") or ""
            if item_id.startswith("address") or "address" in aria_label.lower():
                biz.address = sanitize_text(aria_label.replace("Address:", "").strip())
            elif item_id.startswith("phone") or "phone" in aria_label.lower():
                biz.phone = sanitize_text(aria_label.replace("Phone:", "").strip())
            elif item_id.startswith("authority") or "website" in aria_label.lower():
                biz.website = sanitize_text(aria_label.replace("Website:", "").strip())

        # Fallback: grab href for website
        if not biz.website:
            website_link = await page.query_selector('a[data-item-id="authority"], a[aria-label*="Website"]')
            if website_link:
                href = await website_link.get_attribute("href")
                if href and "google" not in href:
                    biz.website = href

        # Opening hours
        hours_el = await page.query_selector('div[aria-label*="Monday"], table[class*="hour"]')
        if hours_el:
            aria_label = await hours_el.get_attribute("aria-label") or ""
            biz.opening_hours = self._parse_hours(aria_label)

        # Coordinates from URL
        current_url = page.url
        coord_match = re.search(r"@(-?\d+\.\d+),(-?\d+\.\d+)", current_url)
        if coord_match:
            biz.latitude = float(coord_match.group(1))
            biz.longitude = float(coord_match.group(2))

        return biz

    async def _extract_review(self, el) -> ReviewData | None:
        review = ReviewData(source=self.source_name)

        name_el = await el.query_selector('div[class*="name"], a[class*="name"]')
        if name_el:
            review.reviewer_name = sanitize_text(await name_el.inner_text())

        rating_el = await el.query_selector('span[role="img"]')
        if rating_el:
            aria = await rating_el.get_attribute("aria-label") or ""
            review.rating = safe_int(aria)

        text_el = await el.query_selector('span[class*="text"], div[class*="text"]')
        if text_el:
            review.text = sanitize_text(await text_el.inner_text())

        date_el = await el.query_selector('span[class*="date"], span[class*="time"]')
        if date_el:
            review.date = sanitize_text(await date_el.inner_text())

        return review

    @staticmethod
    def _parse_hours(text: str) -> dict[str, str]:
        hours: dict[str, str] = {}
        days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        for day in days:
            pattern = rf"{day},?\s*([\d:]+\s*[APMapm]*\s*(?:to|–|-)\s*[\d:]+\s*[APMapm]*|Closed|Open 24 hours)"
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                hours[day] = sanitize_text(match.group(1))
        return hours
