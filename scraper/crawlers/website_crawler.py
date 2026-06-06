"""Full website crawler – visits multiple pages on a single domain."""

from __future__ import annotations

import asyncio
import logging
import re
from collections import deque
from typing import Any
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from playwright.async_api import Page, TimeoutError as PlaywrightTimeout

from utils.browser_manager import BrowserManager
from utils.helpers import extract_domain, is_same_domain, normalise_url, random_delay, sanitize_text

logger = logging.getLogger("leadforge.crawler")

PRIORITY_PATHS: list[str] = [
    "/", "/about", "/about-us", "/services", "/our-services",
    "/contact", "/contact-us", "/booking", "/book", "/schedule",
    "/blog", "/reviews", "/testimonials", "/pricing", "/team",
    "/faq", "/gallery", "/portfolio",
]


class WebsiteCrawler:
    """Crawl a website, extracting content, forms, contact info, and links."""

    def __init__(self, browser_manager: BrowserManager) -> None:
        self.browser = browser_manager
        self.logger = logger

    async def crawl(self, url: str, *, max_pages: int = 10) -> dict[str, Any]:
        """Crawl up to *max_pages* pages starting from *url*.

        Returns a comprehensive dict with extracted content and metadata.
        """
        base_domain = extract_domain(url)
        if not url.startswith(("http://", "https://")):
            url = f"https://{url}"

        visited: set[str] = set()
        queue: deque[str] = deque()
        pages_data: list[dict[str, Any]] = []

        # Seed the queue with priority paths first, then the root
        canonical_root = normalise_url(url, base_domain)
        for path in PRIORITY_PATHS:
            candidate = normalise_url(urljoin(url, path), base_domain)
            if candidate not in queue:
                queue.append(candidate)
        if canonical_root not in queue:
            queue.appendleft(canonical_root)

        result: dict[str, Any] = {
            "pages_crawled": 0,
            "title": "",
            "meta_description": "",
            "services": [],
            "contact_info": {"emails": [], "phones": [], "addresses": []},
            "technical": {
                "mobile_friendly": False,
                "ssl": url.startswith("https"),
                "page_speed_score": 0,
                "broken_links": [],
            },
            "features": {
                "has_chatbot": False,
                "has_whatsapp": False,
                "has_crm": False,
                "has_booking": False,
                "has_reviews_widget": False,
                "has_automation": False,
                "has_lead_capture": False,
                "has_live_chat": False,
            },
            "tech_stack": [],
            "forms": [],
        }

        context = await self.browser.acquire()
        try:
            page = await self.browser.new_stealth_page(context)
            try:
                while queue and len(visited) < max_pages:
                    current_url = queue.popleft()
                    normalised = normalise_url(current_url, base_domain)
                    if normalised in visited:
                        continue
                    if not is_same_domain(normalised, base_domain):
                        continue

                    visited.add(normalised)
                    page_data = await self._visit_page(page, normalised)

                    if page_data is None:
                        result["technical"]["broken_links"].append(normalised)
                        continue

                    pages_data.append(page_data)

                    # Discover new links
                    for link in page_data.get("links", []):
                        norm_link = normalise_url(link, base_domain)
                        if norm_link not in visited and is_same_domain(norm_link, base_domain):
                            queue.append(norm_link)

                    await random_delay(1, 2)

            except Exception as exc:
                self.logger.error("Crawl error: %s", exc, exc_info=True)
            finally:
                await page.close()
        finally:
            await self.browser.release(context)

        # Aggregate results
        self._aggregate(result, pages_data, url)
        result["pages_crawled"] = len(pages_data)
        return result

    async def _visit_page(self, page: Page, url: str) -> dict[str, Any] | None:
        """Visit a single page and extract data."""
        try:
            response = await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
            if not response or response.status >= 400:
                return None
            await random_delay(0.5, 1.5)
        except PlaywrightTimeout:
            self.logger.debug("Timeout visiting %s", url)
            return None
        except Exception as exc:
            self.logger.debug("Error visiting %s: %s", url, exc)
            return None

        html = await page.content()
        soup = BeautifulSoup(html, "lxml")

        data: dict[str, Any] = {"url": url}

        # Title
        title_tag = soup.find("title")
        data["title"] = sanitize_text(title_tag.string) if title_tag and title_tag.string else ""

        # Meta description
        meta = soup.find("meta", attrs={"name": "description"})
        data["meta_description"] = sanitize_text(meta.get("content", "")) if meta else ""

        # Viewport meta (mobile-friendly indicator)
        viewport = soup.find("meta", attrs={"name": "viewport"})
        data["has_viewport"] = viewport is not None

        # Body text
        body = soup.find("body")
        data["text"] = sanitize_text(body.get_text(separator=" ")) if body else ""

        # Internal links
        links: list[str] = []
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.startswith(("mailto:", "tel:", "javascript:", "#")):
                continue
            full = urljoin(url, href)
            links.append(full)
        data["links"] = links

        # Emails from page
        from utils.helpers import extract_emails
        data["emails"] = extract_emails(html)

        # Phones
        from utils.helpers import extract_phones
        data["phones"] = extract_phones(data["text"])

        # Forms
        data["forms"] = self._extract_forms(soup)

        # Scripts & external resources (for tech detection)
        data["scripts"] = [
            s.get("src", "") for s in soup.find_all("script", src=True)
        ]
        data["meta_tags"] = {
            m.get("name", m.get("property", "")): m.get("content", "")
            for m in soup.find_all("meta")
            if m.get("name") or m.get("property")
        }
        data["raw_html"] = html

        return data

    def _extract_forms(self, soup: BeautifulSoup) -> list[dict[str, Any]]:
        forms: list[dict[str, Any]] = []
        for form in soup.find_all("form"):
            form_data: dict[str, Any] = {
                "action": form.get("action", ""),
                "method": (form.get("method") or "get").upper(),
                "inputs": [],
            }
            for inp in form.find_all(["input", "textarea", "select"]):
                form_data["inputs"].append({
                    "type": inp.get("type", "text"),
                    "name": inp.get("name", ""),
                    "placeholder": inp.get("placeholder", ""),
                })
            forms.append(form_data)
        return forms

    def _aggregate(
        self, result: dict[str, Any], pages: list[dict[str, Any]], root_url: str
    ) -> None:
        """Merge data from all crawled pages into the final result dict."""
        all_emails: set[str] = set()
        all_phones: set[str] = set()
        all_services: set[str] = set()
        all_scripts: list[str] = []
        all_forms: list[dict] = []

        for pd in pages:
            all_emails.update(pd.get("emails", []))
            all_phones.update(pd.get("phones", []))
            all_scripts.extend(pd.get("scripts", []))
            all_forms.extend(pd.get("forms", []))

            # Use the homepage title/description
            if pd.get("url", "").rstrip("/") == root_url.rstrip("/"):
                result["title"] = pd.get("title", result["title"])
                result["meta_description"] = pd.get("meta_description", result["meta_description"])

            # Viewport check
            if pd.get("has_viewport"):
                result["technical"]["mobile_friendly"] = True

            # Extract service-like headings
            text = pd.get("text", "")
            service_keywords = [
                "plumbing", "electrical", "hvac", "roofing", "landscaping",
                "cleaning", "painting", "remodeling", "repair", "installation",
                "maintenance", "consultation", "design", "construction",
            ]
            for kw in service_keywords:
                if kw.lower() in text.lower():
                    all_services.add(kw.title())

        result["contact_info"]["emails"] = sorted(all_emails)
        result["contact_info"]["phones"] = sorted(all_phones)
        result["services"] = sorted(all_services)
        result["forms"] = all_forms

        # Tech detection is handled by TechDetector but we do a lightweight pass here
        from analyzers.tech_detector import TechDetector
        detector = TechDetector()
        for pd in pages:
            html = pd.get("raw_html", "")
            scripts = pd.get("scripts", [])
            features = detector.detect_from_html(html, scripts)
            for key, value in features.items():
                if value and key in result["features"]:
                    result["features"][key] = True
            tech = detector.detect_tech_stack(html, scripts)
            for t in tech:
                if t not in result["tech_stack"]:
                    result["tech_stack"].append(t)
