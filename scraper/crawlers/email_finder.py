"""Email extraction and classification from crawled web pages."""

from __future__ import annotations

import logging
import re
from typing import Any
from urllib.parse import urljoin

from bs4 import BeautifulSoup
from playwright.async_api import TimeoutError as PlaywrightTimeout

from utils.browser_manager import BrowserManager
from utils.helpers import (
    classify_email,
    extract_domain,
    extract_emails,
    is_same_domain,
    normalise_url,
    random_delay,
    sanitize_text,
)

logger = logging.getLogger("leadforge.email_finder")

CONTACT_PATHS: list[str] = [
    "/", "/contact", "/contact-us", "/about", "/about-us",
    "/team", "/support", "/help", "/privacy",
]


class EmailFinder:
    """Discover and categorise email addresses from a website."""

    def __init__(self, browser_manager: BrowserManager) -> None:
        self.browser = browser_manager

    async def find_emails(
        self, url: str, *, max_pages: int = 5
    ) -> list[dict[str, str]]:
        """Scan *url* for email addresses across up to *max_pages* pages.

        Returns a list of dicts with keys: ``email``, ``type``, ``source_page``.
        """
        if not url.startswith(("http://", "https://")):
            url = f"https://{url}"

        base_domain = extract_domain(url)
        visited: set[str] = set()
        found_emails: dict[str, dict[str, str]] = {}  # email -> info dict

        # Build ordered list of pages to visit
        pages_to_visit: list[str] = []
        for path in CONTACT_PATHS:
            candidate = normalise_url(urljoin(url, path), base_domain)
            if candidate not in pages_to_visit:
                pages_to_visit.append(candidate)

        context = await self.browser.acquire()
        try:
            page = await self.browser.new_stealth_page(context)
            try:
                for target_url in pages_to_visit:
                    if len(visited) >= max_pages:
                        break
                    normalised = normalise_url(target_url, base_domain)
                    if normalised in visited:
                        continue
                    if not is_same_domain(normalised, base_domain):
                        continue

                    visited.add(normalised)

                    try:
                        response = await page.goto(
                            normalised, wait_until="domcontentloaded", timeout=30_000
                        )
                        if not response or response.status >= 400:
                            continue
                        await random_delay(1, 2)
                    except PlaywrightTimeout:
                        continue
                    except Exception:
                        continue

                    html = await page.content()
                    page_emails = self._extract_from_page(html, normalised)

                    for info in page_emails:
                        email_lower = info["email"].lower()
                        if email_lower not in found_emails:
                            found_emails[email_lower] = info

                    # Discover additional pages from links
                    if len(visited) < max_pages:
                        soup = BeautifulSoup(html, "lxml")
                        for a_tag in soup.find_all("a", href=True):
                            href = a_tag["href"]
                            if href.startswith(("mailto:", "tel:", "javascript:", "#")):
                                continue
                            full_url = normalise_url(urljoin(normalised, href), base_domain)
                            if (
                                full_url not in visited
                                and full_url not in pages_to_visit
                                and is_same_domain(full_url, base_domain)
                            ):
                                pages_to_visit.append(full_url)

            except Exception as exc:
                logger.error("Email finder error: %s", exc, exc_info=True)
            finally:
                await page.close()
        finally:
            await self.browser.release(context)

        return list(found_emails.values())

    def _extract_from_page(
        self, html: str, source_url: str
    ) -> list[dict[str, str]]:
        """Extract emails from a page's HTML content."""
        results: list[dict[str, str]] = []
        seen: set[str] = set()

        # 1. Regex scan of the entire HTML
        raw_emails = extract_emails(html)
        for email in raw_emails:
            lower = email.lower()
            if lower not in seen:
                seen.add(lower)
                results.append({
                    "email": email,
                    "type": classify_email(email, source_url),
                    "source_page": source_url,
                })

        # 2. Parse mailto: links
        soup = BeautifulSoup(html, "lxml")
        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"]
            if href.startswith("mailto:"):
                email = href.replace("mailto:", "").split("?")[0].strip()
                lower = email.lower()
                if lower and lower not in seen:
                    seen.add(lower)
                    results.append({
                        "email": email,
                        "type": classify_email(email, source_url),
                        "source_page": source_url,
                    })

        # 3. Structured data (JSON-LD)
        for script in soup.find_all("script", type="application/ld+json"):
            text = script.string or ""
            found = extract_emails(text)
            for email in found:
                lower = email.lower()
                if lower not in seen:
                    seen.add(lower)
                    results.append({
                        "email": email,
                        "type": classify_email(email, source_url),
                        "source_page": source_url,
                    })

        # 4. Meta tags
        for meta in soup.find_all("meta"):
            content = meta.get("content", "")
            found = extract_emails(content)
            for email in found:
                lower = email.lower()
                if lower not in seen:
                    seen.add(lower)
                    results.append({
                        "email": email,
                        "type": classify_email(email, source_url),
                        "source_page": source_url,
                    })

        return results
