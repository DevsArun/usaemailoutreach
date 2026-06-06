"""Generic / configurable directory scraper for custom industry sites."""

from __future__ import annotations

from dataclasses import dataclass, field

from bs4 import BeautifulSoup
from playwright.async_api import TimeoutError as PlaywrightTimeout

from utils.helpers import random_delay, safe_float, safe_int, sanitize_text

from .base import BaseScraper, BusinessData


@dataclass
class DirectoryConfig:
    """Configuration for a custom directory's CSS selectors."""

    base_url: str = ""
    search_path: str = "/search?q={query}"
    card_selector: str = "div.listing"
    name_selector: str = "h2 a"
    address_selector: str = "span.address"
    phone_selector: str = "span.phone"
    website_selector: str = "a.website"
    rating_selector: str = "span.rating"
    category_selector: str = "span.category"
    reviews_count_selector: str = "span.reviews"
    next_page_selector: str = "a.next"
    max_pages: int = 10


DEFAULT_CONFIGS: dict[str, DirectoryConfig] = {
    "angi": DirectoryConfig(
        base_url="https://www.angi.com",
        search_path="/companylist/{query}.htm",
        card_selector='div[class*="result-card"]',
        name_selector="h3 a",
        address_selector='span[class*="address"]',
        phone_selector='span[class*="phone"]',
        rating_selector='span[class*="rating"]',
    ),
    "thumbtack": DirectoryConfig(
        base_url="https://www.thumbtack.com",
        search_path="/search/{query}",
        card_selector='div[class*="result"]',
        name_selector='a[class*="name"]',
        rating_selector='span[class*="star"]',
    ),
}


class GenericDirectoryScraper(BaseScraper):
    source_name = "generic"

    def __init__(self, browser_manager, config: DirectoryConfig | None = None) -> None:
        super().__init__(browser_manager)
        self.config = config or DirectoryConfig()

    def configure(self, config: DirectoryConfig) -> None:
        self.config = config

    async def scrape_businesses(
        self, query: str, *, max_results: int = 50
    ) -> list[BusinessData]:
        if not self.config.base_url:
            # Try using the first known config (Angi) as fallback
            if DEFAULT_CONFIGS:
                fallback_key = next(iter(DEFAULT_CONFIGS))
                self.config = DEFAULT_CONFIGS[fallback_key]
                self.source_name = fallback_key
                self.logger.info("Using fallback config: %s", fallback_key)
            else:
                self.logger.warning("GenericDirectoryScraper requires a base_url in config")
                return []

        results: list[BusinessData] = []
        context = await self.browser.acquire()
        try:
            page = await self.browser.new_stealth_page(context)
            try:
                pages_scraped = 0
                next_url: str | None = (
                    self.config.base_url
                    + self.config.search_path.format(query=query.replace(" ", "+"))
                )

                while next_url and pages_scraped < self.config.max_pages and len(results) < max_results:
                    await page.goto(next_url, wait_until="domcontentloaded")
                    await random_delay(2, 4)
                    pages_scraped += 1

                    html = await page.content()
                    page_results, next_url = self._parse_page(html)

                    if not page_results:
                        break

                    results.extend(page_results)
                    await random_delay(1.5, 3)

            except PlaywrightTimeout:
                self.logger.warning("Timeout on generic directory scrape")
            except Exception as exc:
                self.logger.error("Generic scrape error: %s", exc, exc_info=True)
            finally:
                await page.close()
        finally:
            await self.browser.release(context)

        return results[:max_results]

    def _parse_page(self, html: str) -> tuple[list[BusinessData], str | None]:
        soup = BeautifulSoup(html, "lxml")
        results: list[BusinessData] = []
        cfg = self.config

        cards = soup.select(cfg.card_selector)
        for card in cards:
            biz = BusinessData(source=self.source_name)

            tag = card.select_one(cfg.name_selector)
            if tag:
                biz.name = sanitize_text(tag.get_text())

            tag = card.select_one(cfg.address_selector)
            if tag:
                biz.address = sanitize_text(tag.get_text())

            tag = card.select_one(cfg.phone_selector)
            if tag:
                biz.phone = sanitize_text(tag.get_text())

            tag = card.select_one(cfg.website_selector)
            if tag:
                biz.website = tag.get("href", "")

            tag = card.select_one(cfg.rating_selector)
            if tag:
                biz.rating = safe_float(tag.get_text())

            tag = card.select_one(cfg.category_selector)
            if tag:
                biz.category = sanitize_text(tag.get_text())

            tag = card.select_one(cfg.reviews_count_selector)
            if tag:
                biz.reviews_count = safe_int(tag.get_text())

            if biz.name:
                results.append(biz)

        # Next-page link
        next_link = soup.select_one(cfg.next_page_selector)
        next_url = None
        if next_link:
            href = next_link.get("href", "")
            if href:
                if href.startswith("http"):
                    next_url = href
                else:
                    next_url = cfg.base_url + href

        return results, next_url
