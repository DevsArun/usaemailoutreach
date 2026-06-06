from .base import BaseScraper, BusinessData, ReviewData
from .google_maps import GoogleMapsScraper
from .yelp import YelpScraper
from .yellowpages import YellowPagesScraper
from .bbb import BBBScraper
from .bing import BingPlacesScraper
from .facebook import FacebookScraper
from .generic import GenericDirectoryScraper

SCRAPER_REGISTRY: dict[str, type[BaseScraper]] = {
    "google_maps": GoogleMapsScraper,
    "yelp": YelpScraper,
    "yellowpages": YellowPagesScraper,
    "bbb": BBBScraper,
    "bing": BingPlacesScraper,
    "facebook": FacebookScraper,
    "generic": GenericDirectoryScraper,
}

__all__ = [
    "BaseScraper",
    "BusinessData",
    "ReviewData",
    "GoogleMapsScraper",
    "YelpScraper",
    "YellowPagesScraper",
    "BBBScraper",
    "BingPlacesScraper",
    "FacebookScraper",
    "GenericDirectoryScraper",
    "SCRAPER_REGISTRY",
]
