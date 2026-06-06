"""Shared utility functions for the LeadForge AI scraping microservice."""

from __future__ import annotations

import asyncio
import logging
import random
import re
from urllib.parse import urlparse

logger = logging.getLogger("leadforge.helpers")

USER_AGENTS: list[str] = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.7; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 OPR/116.0.0.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
]

FILTERED_EMAIL_PREFIXES: set[str] = {
    "noreply",
    "no-reply",
    "mailer-daemon",
    "postmaster",
    "donotreply",
    "do-not-reply",
    "bounce",
    "unsubscribe",
    "notifications",
    "notification",
    "daemon",
    "root",
    "nobody",
    "webmaster",
    "hostmaster",
    "abuse",
}

EMAIL_REGEX = re.compile(
    r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}",
    re.IGNORECASE,
)

PHONE_REGEX = re.compile(
    r"""
    (?:
        \+?1[\s.-]?                              # optional country code
    )?
    (?:
        \(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}   # (xxx) xxx-xxxx or xxx-xxx-xxxx
    )
    """,
    re.VERBOSE,
)


def random_user_agent() -> str:
    """Return a random user-agent string from the rotating pool."""
    return random.choice(USER_AGENTS)


async def random_delay(min_seconds: float = 1.0, max_seconds: float = 3.0) -> None:
    """Sleep for a random duration to mimic human behaviour."""
    delay = random.uniform(min_seconds, max_seconds)
    await asyncio.sleep(delay)


def sanitize_text(text: str | None) -> str:
    """Strip excessive whitespace and normalise a text string."""
    if not text:
        return ""
    text = re.sub(r"\s+", " ", text).strip()
    return text


def extract_domain(url: str) -> str:
    """Extract the root domain from a URL."""
    try:
        parsed = urlparse(url if "://" in url else f"https://{url}")
        domain = parsed.netloc or parsed.path.split("/")[0]
        domain = domain.lower().removeprefix("www.")
        return domain
    except Exception:
        return ""


def normalise_url(url: str, base_domain: str = "") -> str:
    """Normalise a URL to a canonical form."""
    url = url.strip()
    if url.startswith("//"):
        url = f"https:{url}"
    elif url.startswith("/"):
        if base_domain:
            scheme = "https"
            url = f"{scheme}://{base_domain}{url}"
        else:
            return url
    elif not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    parsed = urlparse(url)
    path = parsed.path.rstrip("/") or "/"
    return f"{parsed.scheme}://{parsed.netloc}{path}"


def is_same_domain(url: str, base_domain: str) -> bool:
    """Check whether *url* belongs to the same domain as *base_domain*."""
    return extract_domain(url) == extract_domain(base_domain)


def extract_emails(text: str) -> list[str]:
    """Return de-duplicated emails found in *text*, filtering junk addresses."""
    matches = EMAIL_REGEX.findall(text)
    seen: set[str] = set()
    results: list[str] = []
    for email in matches:
        email_lower = email.lower()
        prefix = email_lower.split("@")[0]
        if prefix in FILTERED_EMAIL_PREFIXES:
            continue
        if email_lower.endswith((".png", ".jpg", ".gif", ".svg", ".css", ".js")):
            continue
        if email_lower not in seen:
            seen.add(email_lower)
            results.append(email)
    return results


def extract_phones(text: str) -> list[str]:
    """Return de-duplicated phone numbers found in *text*."""
    matches = PHONE_REGEX.findall(text)
    seen: set[str] = set()
    results: list[str] = []
    for phone in matches:
        normalized = re.sub(r"[\s.\-()]+", "", phone)
        if normalized not in seen:
            seen.add(normalized)
            results.append(phone.strip())
    return results


def classify_email(email: str, page_url: str = "") -> str:
    """Classify an email address into a category."""
    prefix = email.lower().split("@")[0]
    general = {"info", "contact", "hello", "enquiry", "enquiries", "office", "admin", "mail", "email"}
    support = {"support", "help", "helpdesk", "service", "customerservice", "customer-service", "cs"}
    marketing = {"marketing", "sales", "ads", "advertising", "press", "media", "pr", "partnerships"}
    if prefix in general:
        return "general"
    if prefix in support:
        return "support"
    if prefix in marketing:
        return "marketing"
    if re.match(r"^[a-z]+\.[a-z]+$", prefix):
        return "owner"
    if re.match(r"^[a-z]{2,15}$", prefix) and prefix not in general | support | marketing:
        return "owner"
    return "contact"


def safe_float(value: str | None, default: float = 0.0) -> float:
    """Parse a float from a string, returning *default* on failure."""
    if value is None:
        return default
    try:
        cleaned = re.sub(r"[^\d.]", "", str(value))
        return float(cleaned) if cleaned else default
    except (ValueError, TypeError):
        return default


def safe_int(value: str | None, default: int = 0) -> int:
    """Parse an int from a string, returning *default* on failure."""
    if value is None:
        return default
    try:
        cleaned = re.sub(r"[^\d]", "", str(value))
        return int(cleaned) if cleaned else default
    except (ValueError, TypeError):
        return default
