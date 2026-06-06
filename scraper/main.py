"""LeadForge AI — Scraping Microservice.

FastAPI application with endpoints for business scraping, review collection,
website crawling, and email discovery.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# ── Ensure the scraper package root is on sys.path ──────────────────────
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from analyzers.review_analyzer import ReviewAnalyzer
from crawlers.email_finder import EmailFinder
from crawlers.website_crawler import WebsiteCrawler
from scrapers import SCRAPER_REGISTRY
from utils.browser_manager import BrowserManager
from utils.proxy_manager import ProxyManager

# ── Logging ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(name)-30s  %(levelname)-7s  %(message)s",
)
logger = logging.getLogger("leadforge.main")

# ── Globals ─────────────────────────────────────────────────────────────
proxy_manager: ProxyManager
browser_manager: BrowserManager


# ── Lifespan ────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    global proxy_manager, browser_manager

    proxy_urls = [p.strip() for p in os.getenv("PROXY_URLS", "").split(",") if p.strip()]
    proxy_manager = ProxyManager(proxy_urls=proxy_urls)

    pool_size = int(os.getenv("BROWSER_POOL_SIZE", "3"))
    headless = os.getenv("BROWSER_HEADLESS", "true").lower() in ("true", "1", "yes")
    browser_manager = BrowserManager(
        max_pool_size=pool_size,
        proxy_manager=proxy_manager,
        headless=headless,
    )
    # Start browser in background — don't block FastAPI startup
    asyncio.create_task(browser_manager.start())
    logger.info("LeadForge scraping service started (browser launching in background)")

    yield

    await browser_manager.stop()
    logger.info("LeadForge scraping service shut down")


app = FastAPI(
    title="LeadForge AI — Scraping Microservice",
    version="1.0.0",
    lifespan=lifespan,
)


# ═══════════════════════════════════════════════════════════════════════
# Request / Response models
# ═══════════════════════════════════════════════════════════════════════

class ScrapeBusinessesRequest(BaseModel):
    query: str = Field(..., description="Search query, e.g. 'Plumber in New York'")
    sources: list[str] = Field(
        default=["google_maps"],
        description="Sources to scrape: google_maps, yelp, yellowpages, bbb, bing, facebook, generic",
    )
    max_results: int = Field(default=100, ge=1, le=500)


class ScrapeBusinessesResponse(BaseModel):
    businesses: list[dict[str, Any]]
    total: int
    sources_used: list[str]


class ScrapeReviewsRequest(BaseModel):
    business_name: str
    location: str
    source: str = "google_maps"
    max_reviews: int = Field(default=20, ge=1, le=100)


class ScrapeReviewsResponse(BaseModel):
    reviews: list[dict[str, Any]]
    total: int


class CrawlWebsiteRequest(BaseModel):
    url: str
    max_pages: int = Field(default=10, ge=1, le=50)


class DiscoverEmailsRequest(BaseModel):
    url: str
    max_pages: int = Field(default=5, ge=1, le=20)


class DiscoverEmailsResponse(BaseModel):
    emails: list[dict[str, str]]


# ═══════════════════════════════════════════════════════════════════════
# Endpoints
# ═══════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health_check():
    """Health-check endpoint."""
    return {
        "status": "healthy",
        "browser_pool": browser_manager.stats,
        "proxy_pool": proxy_manager.stats,
    }


@app.post("/scrape/businesses", response_model=ScrapeBusinessesResponse)
async def scrape_businesses(request: ScrapeBusinessesRequest):
    """Scrape business listings from one or more directory sources."""
    start = time.monotonic()
    all_businesses: list[dict[str, Any]] = []
    sources_used: list[str] = []

    tasks: list[asyncio.Task] = []
    valid_sources: list[str] = []
    for source_name in request.sources:
        scraper_cls = SCRAPER_REGISTRY.get(source_name)
        if scraper_cls is None:
            logger.warning("Unknown source '%s' – skipping", source_name)
            continue
        scraper = scraper_cls(browser_manager)
        valid_sources.append(source_name)
        tasks.append(
            asyncio.create_task(
                _safe_scrape(
                    scraper.scrape_businesses,
                    request.query,
                    max_results=request.max_results,
                ),
                name=f"scrape-{source_name}",
            )
        )

    if not tasks:
        raise HTTPException(status_code=400, detail="No valid sources specified")

    results = await asyncio.gather(*tasks)

    seen_names: set[str] = set()
    for source_name, source_results in zip(valid_sources, results):
        if source_results:
            sources_used.append(source_name)
            for biz in source_results:
                key = (biz.name.lower(), biz.phone) if biz.name else None
                if key and key not in seen_names:
                    seen_names.add(key)
                    all_businesses.append(biz.to_dict())

    elapsed = time.monotonic() - start
    logger.info(
        "Scraped %d businesses from %s in %.1fs",
        len(all_businesses),
        sources_used,
        elapsed,
    )

    return ScrapeBusinessesResponse(
        businesses=all_businesses[:request.max_results],
        total=len(all_businesses),
        sources_used=sources_used,
    )


@app.post("/scrape/reviews", response_model=ScrapeReviewsResponse)
async def scrape_reviews(request: ScrapeReviewsRequest):
    """Scrape reviews for a specific business."""
    analyzer = ReviewAnalyzer(browser_manager)
    reviews = await analyzer.collect_reviews(
        business_name=request.business_name,
        location=request.location,
        source=request.source,
        max_reviews=request.max_reviews,
    )
    return ScrapeReviewsResponse(
        reviews=[r.to_dict() for r in reviews],
        total=len(reviews),
    )


@app.post("/crawl/website")
async def crawl_website(request: CrawlWebsiteRequest):
    """Crawl a website and extract comprehensive intelligence."""
    crawler = WebsiteCrawler(browser_manager)
    try:
        result = await asyncio.wait_for(
            crawler.crawl(request.url, max_pages=request.max_pages),
            timeout=300,  # 5-minute timeout
        )
        return result
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Website crawl timed out after 5 minutes")
    except Exception as exc:
        logger.error("Crawl endpoint error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/discover/emails", response_model=DiscoverEmailsResponse)
async def discover_emails(request: DiscoverEmailsRequest):
    """Discover and classify email addresses on a website."""
    finder = EmailFinder(browser_manager)
    try:
        emails = await asyncio.wait_for(
            finder.find_emails(request.url, max_pages=request.max_pages),
            timeout=120,
        )
        return DiscoverEmailsResponse(emails=emails)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=504, detail="Email discovery timed out")
    except Exception as exc:
        logger.error("Email discovery error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

async def _safe_scrape(scrape_fn, *args, **kwargs):
    """Wrapper that catches all exceptions so one failed source doesn't kill the batch."""
    try:
        # Generous timeout — per-place navigation + review extraction is slow.
        # The scraper itself respects an internal time budget and returns
        # partial results, so this is just a hard safety ceiling.
        return await asyncio.wait_for(scrape_fn(*args, **kwargs), timeout=900)
    except asyncio.TimeoutError:
        logger.warning("Scrape timed out for %s", scrape_fn)
        return []
    except Exception as exc:
        logger.error("Scrape error in %s: %s", scrape_fn, exc, exc_info=True)
        return []


# ═══════════════════════════════════════════════════════════════════════
# Entrypoint
# ═══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.getenv("HOST", "0.0.0.0"),
        port=int(os.getenv("SCRAPER_PORT", "8000")),
        reload=False,
        log_level="info",
    )
