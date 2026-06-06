"""Abstract base scraper and shared data models."""

from __future__ import annotations

import abc
import logging
from dataclasses import dataclass, field
from typing import Any

from utils.browser_manager import BrowserManager

logger = logging.getLogger("leadforge.scraper")


@dataclass
class BusinessData:
    """Canonical representation of a scraped business listing."""

    name: str = ""
    address: str = ""
    phone: str = ""
    website: str = ""
    rating: float = 0.0
    reviews_count: int = 0
    category: str = ""
    opening_hours: dict[str, str] = field(default_factory=dict)
    owner_name: str | None = None
    social_links: dict[str, str] = field(default_factory=dict)
    source: str = ""
    latitude: float | None = None
    longitude: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "address": self.address,
            "phone": self.phone,
            "website": self.website,
            "rating": self.rating,
            "reviews_count": self.reviews_count,
            "category": self.category,
            "opening_hours": self.opening_hours,
            "owner_name": self.owner_name,
            "social_links": self.social_links,
            "source": self.source,
            "latitude": self.latitude,
            "longitude": self.longitude,
        }


@dataclass
class ReviewData:
    """A single review scraped from a directory."""

    reviewer_name: str = ""
    rating: int = 0
    text: str = ""
    date: str = ""
    source: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "reviewer_name": self.reviewer_name,
            "rating": self.rating,
            "text": self.text,
            "date": self.date,
            "source": self.source,
        }


class BaseScraper(abc.ABC):
    """Base class that every directory scraper must extend.

    Subclasses implement :meth:`scrape_businesses` and optionally
    :meth:`scrape_reviews`.
    """

    source_name: str = "unknown"

    def __init__(self, browser_manager: BrowserManager) -> None:
        self.browser = browser_manager
        self.logger = logging.getLogger(f"leadforge.scraper.{self.source_name}")

    @abc.abstractmethod
    async def scrape_businesses(
        self, query: str, *, max_results: int = 50
    ) -> list[BusinessData]:
        """Scrape business listings for *query*.

        Must return a list of :class:`BusinessData` instances.  Should never
        raise – return partial results on error.
        """

    async def scrape_reviews(
        self,
        business_name: str,
        location: str,
        *,
        max_reviews: int = 20,
    ) -> list[ReviewData]:
        """Scrape reviews for a specific business.

        The default implementation returns an empty list; scrapers that support
        review collection should override this method.
        """
        return []
