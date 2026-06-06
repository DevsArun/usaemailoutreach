"""Proxy rotation manager with health-checking and round-robin selection."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

import httpx

logger = logging.getLogger("leadforge.proxy")

HEALTH_CHECK_URL = "https://httpbin.org/ip"
HEALTH_CHECK_TIMEOUT = 10.0
COOLDOWN_SECONDS = 300  # 5 minutes before retrying a failed proxy


@dataclass
class _ProxyState:
    url: str
    alive: bool = True
    fail_count: int = 0
    last_fail_time: float = 0.0


@dataclass
class ProxyManager:
    """Round-robin proxy rotation with automatic health checking.

    Parameters
    ----------
    proxy_urls : list[str]
        Proxy connection strings, e.g.
        ``["http://user:pass@host:port", "socks5://host:port"]``.
    """

    proxy_urls: list[str] = field(default_factory=list)
    _proxies: list[_ProxyState] = field(default_factory=list, init=False, repr=False)
    _index: int = field(default=0, init=False, repr=False)
    _lock: asyncio.Lock = field(default_factory=asyncio.Lock, init=False, repr=False)

    def __post_init__(self) -> None:
        self._proxies = [_ProxyState(url=u) for u in self.proxy_urls]

    @property
    def has_proxies(self) -> bool:
        return len(self._proxies) > 0

    async def get_proxy(self) -> str | None:
        """Return the next healthy proxy URL, or ``None`` to use direct."""
        if not self._proxies:
            return None

        async with self._lock:
            now = time.monotonic()
            attempts = 0
            while attempts < len(self._proxies):
                proxy = self._proxies[self._index % len(self._proxies)]
                self._index += 1
                attempts += 1

                if proxy.alive:
                    return proxy.url

                if now - proxy.last_fail_time > COOLDOWN_SECONDS:
                    proxy.alive = True
                    proxy.fail_count = 0
                    return proxy.url

        logger.warning("All proxies are down – falling back to direct connection")
        return None

    async def mark_failed(self, proxy_url: str) -> None:
        """Mark a proxy as failed after an unsuccessful request."""
        async with self._lock:
            for proxy in self._proxies:
                if proxy.url == proxy_url:
                    proxy.fail_count += 1
                    proxy.last_fail_time = time.monotonic()
                    if proxy.fail_count >= 3:
                        proxy.alive = False
                        logger.warning("Proxy %s marked as dead after %d failures", proxy_url, proxy.fail_count)
                    break

    async def mark_success(self, proxy_url: str) -> None:
        """Reset failure counters after a successful request."""
        async with self._lock:
            for proxy in self._proxies:
                if proxy.url == proxy_url:
                    proxy.fail_count = 0
                    proxy.alive = True
                    break

    async def health_check_all(self) -> dict[str, bool]:
        """Run a health check against every configured proxy."""
        results: dict[str, bool] = {}
        for proxy in self._proxies:
            healthy = await self._check_one(proxy.url)
            proxy.alive = healthy
            if not healthy:
                proxy.last_fail_time = time.monotonic()
            else:
                proxy.fail_count = 0
            results[proxy.url] = healthy
        return results

    async def _check_one(self, proxy_url: str) -> bool:
        try:
            async with httpx.AsyncClient(proxy=proxy_url, timeout=HEALTH_CHECK_TIMEOUT) as client:
                resp = await client.get(HEALTH_CHECK_URL)
                return resp.status_code == 200
        except Exception as exc:
            logger.debug("Health-check failed for %s: %s", proxy_url, exc)
            return False

    def get_playwright_proxy(self, proxy_url: str | None) -> dict | None:
        """Convert a proxy URL into the dict format Playwright expects."""
        if not proxy_url:
            return None
        from urllib.parse import urlparse

        parsed = urlparse(proxy_url)
        result: dict[str, str] = {"server": f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"}
        if parsed.username:
            result["username"] = parsed.username
        if parsed.password:
            result["password"] = parsed.password
        return result

    @property
    def stats(self) -> dict:
        return {
            "total": len(self._proxies),
            "alive": sum(1 for p in self._proxies if p.alive),
            "dead": sum(1 for p in self._proxies if not p.alive),
        }
