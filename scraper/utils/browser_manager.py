"""Playwright browser-context pool for reuse across scraping jobs."""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field

from playwright.async_api import Browser, BrowserContext, Playwright, async_playwright
from playwright_stealth import stealth_async  # type: ignore[import-untyped]

from .helpers import random_user_agent
from .proxy_manager import ProxyManager

logger = logging.getLogger("leadforge.browser")

IDLE_TIMEOUT_SECONDS = 120  # close contexts idle > 2 minutes


@dataclass
class _ContextSlot:
    context: BrowserContext
    in_use: bool = False
    last_used: float = field(default_factory=time.monotonic)
    proxy_url: str | None = None


class BrowserManager:
    """Maintains a pool of stealth Playwright browser contexts.

    Parameters
    ----------
    max_pool_size : int
        Maximum number of concurrent browser contexts.
    proxy_manager : ProxyManager | None
        Optional proxy rotation manager.
    headless : bool
        Whether to launch the browser in headless mode.
    """

    def __init__(
        self,
        max_pool_size: int = 3,
        proxy_manager: ProxyManager | None = None,
        headless: bool = True,
    ) -> None:
        self.max_pool_size = max_pool_size
        self.proxy_manager = proxy_manager
        self.headless = headless

        self._playwright: Playwright | None = None
        self._browser: Browser | None = None
        self._slots: list[_ContextSlot] = []
        self._lock = asyncio.Lock()
        self._started = False
        self._cleanup_task: asyncio.Task | None = None

    async def start(self) -> None:
        """Launch the underlying browser and start the idle-cleanup loop."""
        if self._started:
            return
        self._playwright = await async_playwright().start()
        # Retry browser launch — Chromium may still be installing in background
        for attempt in range(60):  # retry for up to 30 minutes
            try:
                self._browser = await self._playwright.chromium.launch(headless=self.headless)
                self._started = True
                self._cleanup_task = asyncio.create_task(self._cleanup_loop())
                logger.info("BrowserManager started (pool_size=%d)", self.max_pool_size)
                return
            except Exception as exc:
                logger.warning(
                    "Browser launch attempt %d failed (%s). Retrying in 30s...",
                    attempt + 1, exc,
                )
                await asyncio.sleep(30)
        logger.error("BrowserManager failed to start after all retries.")

    async def stop(self) -> None:
        """Gracefully shut down all contexts and the browser."""
        self._started = False
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        async with self._lock:
            for slot in self._slots:
                try:
                    await slot.context.close()
                except Exception:
                    pass
            self._slots.clear()
        if self._browser:
            await self._browser.close()
            self._browser = None
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None
        logger.info("BrowserManager stopped")

    async def acquire(self) -> BrowserContext:
        """Acquire a stealth browser context from the pool.

        If a free context is available it is reused; otherwise a new one is
        created (up to *max_pool_size*).  If the pool is full the call blocks
        until a slot is released.
        """
        deadline = time.monotonic() + 60  # 60 second timeout
        while True:
            async with self._lock:
                for slot in self._slots:
                    if not slot.in_use:
                        slot.in_use = True
                        slot.last_used = time.monotonic()
                        return slot.context

                if len(self._slots) < self.max_pool_size:
                    ctx = await self._create_context()
                    slot = _ContextSlot(context=ctx, in_use=True)
                    self._slots.append(slot)
                    return ctx

            if time.monotonic() > deadline:
                raise RuntimeError("Timeout waiting for available browser context")
            await asyncio.sleep(0.25)

    async def release(self, context: BrowserContext) -> None:
        """Return a context back to the pool."""
        async with self._lock:
            for slot in self._slots:
                if slot.context is context:
                    slot.in_use = False
                    slot.last_used = time.monotonic()
                    return
        logger.warning("Attempted to release unknown browser context")

    async def _create_context(self) -> BrowserContext:
        if not self._browser:
            raise RuntimeError("BrowserManager has not been started")

        proxy_url = None
        playwright_proxy = None
        if self.proxy_manager:
            proxy_url = await self.proxy_manager.get_proxy()
            playwright_proxy = self.proxy_manager.get_playwright_proxy(proxy_url)

        context = await self._browser.new_context(
            user_agent=random_user_agent(),
            viewport={"width": 1366, "height": 768},
            locale="en-US",
            timezone_id="America/New_York",
            proxy=playwright_proxy,
            java_script_enabled=True,
            bypass_csp=True,
            ignore_https_errors=True,
        )
        context.set_default_timeout(30_000)
        context.set_default_navigation_timeout(30_000)
        return context

    async def new_stealth_page(self, context: BrowserContext):
        """Create a new page in *context* with stealth patches applied."""
        page = await context.new_page()
        await stealth_async(page)
        return page

    async def _cleanup_loop(self) -> None:
        """Periodically close idle contexts to free resources."""
        while self._started:
            try:
                await asyncio.sleep(30)
                async with self._lock:
                    now = time.monotonic()
                    kept: list[_ContextSlot] = []
                    for slot in self._slots:
                        if not slot.in_use and (now - slot.last_used) > IDLE_TIMEOUT_SECONDS:
                            try:
                                await slot.context.close()
                                logger.debug("Closed idle browser context")
                            except Exception:
                                pass
                        else:
                            kept.append(slot)
                    self._slots = kept
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.error("Error in browser cleanup loop: %s", exc)

    @property
    def stats(self) -> dict:
        active = sum(1 for s in self._slots if s.in_use)
        return {
            "active": active,
            "available": len(self._slots) - active,
            "total": len(self._slots),
            "max_pool_size": self.max_pool_size,
        }
