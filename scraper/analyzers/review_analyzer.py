"""Review collection from Google Maps (and extensible to other sources)."""

from __future__ import annotations

import logging
from typing import Any

from scrapers.base import ReviewData
from scrapers.google_maps import GoogleMapsScraper
from scrapers.yelp import YelpScraper
from utils.browser_manager import BrowserManager

logger = logging.getLogger("leadforge.review_analyzer")


class ReviewAnalyzer:
    """Collect and structure reviews for a specific business."""

    def __init__(self, browser_manager: BrowserManager) -> None:
        self.browser = browser_manager
        self._scrapers: dict[str, Any] = {
            "google_maps": GoogleMapsScraper(browser_manager),
            "yelp": YelpScraper(browser_manager),
        }

    async def collect_reviews(
        self,
        business_name: str,
        location: str,
        *,
        source: str = "google_maps",
        max_reviews: int = 20,
    ) -> list[ReviewData]:
        """Collect reviews from the given *source*.

        Falls back to Google Maps if the requested source is not supported.
        """
        scraper = self._scrapers.get(source)
        if scraper is None:
            logger.warning(
                "Review source '%s' not supported – falling back to google_maps",
                source,
            )
            scraper = self._scrapers["google_maps"]

        try:
            reviews = await scraper.scrape_reviews(
                business_name, location, max_reviews=max_reviews
            )
            logger.info(
                "Collected %d reviews for '%s' in '%s'",
                len(reviews),
                business_name,
                location,
            )
            return reviews
        except Exception as exc:
            logger.error(
                "Review collection error for '%s': %s",
                business_name,
                exc,
                exc_info=True,
            )
            return []

    def compute_summary(self, reviews: list[ReviewData]) -> dict[str, Any]:
        """Compute aggregate statistics for a batch of reviews."""
        if not reviews:
            return {
                "total": 0,
                "average_rating": 0.0,
                "rating_distribution": {1: 0, 2: 0, 3: 0, 4: 0, 5: 0},
            }

        distribution = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        total_rating = 0
        for review in reviews:
            rating = review.rating
            if rating < 1 or rating > 5:
                continue  # Skip invalid ratings
            distribution[rating] = distribution.get(rating, 0) + 1
            total_rating += rating

        valid_count = sum(distribution.values())

        return {
            "total": len(reviews),
            "average_rating": round(total_rating / valid_count, 2) if valid_count > 0 else 0.0,
            "rating_distribution": distribution,
        }
