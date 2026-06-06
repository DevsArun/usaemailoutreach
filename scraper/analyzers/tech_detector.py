"""Technology and feature detection on websites."""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class _Pattern:
    """A detection pattern: match against script sources or raw HTML."""
    label: str
    script_patterns: list[str] = field(default_factory=list)
    html_patterns: list[str] = field(default_factory=list)


# ---- Feature detection patterns ----

LIVE_CHAT_PATTERNS = _Pattern(
    label="live_chat",
    script_patterns=[
        "tawk.to", "tawkto",
        "livechat", "livechatinc.com",
        "crisp.chat", "crisp.im",
        "olark.com",
        "purechat.com",
        "chatra.io",
        "smartsupp.com",
        "tidio.co",
        "jivochat",
    ],
    html_patterns=[
        "tawk-messenger", "livechat-widget", "crisp-client",
        "olark", "purechat", "chatra", "smartsupp", "tidio",
        "jivo-widget",
    ],
)

CHATBOT_PATTERNS = _Pattern(
    label="chatbot",
    script_patterns=[
        "drift.com", "driftt.com",
        "intercom.io", "intercomcdn.com",
        "dialogflow", "botpress",
        "manychat.com", "chatfuel",
        "landbot.io", "ada.cx",
        "collect.chat", "botsify",
    ],
    html_patterns=[
        "drift-frame", "intercom-container", "intercom-frame",
        "dialogflow", "chatbot-widget", "bot-container",
        "manychat", "chatfuel",
    ],
)

WHATSAPP_PATTERNS = _Pattern(
    label="whatsapp",
    script_patterns=[
        "wa.me", "api.whatsapp.com", "whatsapp-widget",
        "elfsight.com/whatsapp",
    ],
    html_patterns=[
        "wa.me/", "whatsapp.com", "whatsapp-chat",
        "wa-chat-button", "whatsapp-widget", "click-to-chat",
    ],
)

CRM_PATTERNS = _Pattern(
    label="crm",
    script_patterns=[
        "salesforce.com", "force.com",
        "hubspot.com", "hs-scripts.com", "hsforms.com",
        "zoho.com", "zohocdn.com",
        "pipedrive.com", "freshsales",
        "activecampaign.com",
    ],
    html_patterns=[
        "salesforce", "hubspot", "hs-form", "zoho-form",
        "pipedrive", "freshsales", "activecampaign",
    ],
)

BOOKING_PATTERNS = _Pattern(
    label="booking",
    script_patterns=[
        "calendly.com",
        "acuityscheduling.com",
        "simplybook.me",
        "square.site/appointments",
        "setmore.com",
        "booksy.com",
        "vagaro.com",
        "fresha.com",
    ],
    html_patterns=[
        "calendly-inline-widget", "calendly-badge-widget",
        "acuity-embed", "simplybook", "booking-widget",
        "setmore", "booksy", "vagaro", "fresha",
        'type="booking"', "book-appointment", "schedule-now",
    ],
)

REVIEWS_WIDGET_PATTERNS = _Pattern(
    label="reviews_widget",
    script_patterns=[
        "trustpilot.com", "widget.trustpilot.com",
        "birdeye.com",
        "yotpo.com",
        "judge.me",
        "stamped.io",
        "reviews.io",
        "elfsight.com/google-reviews",
    ],
    html_patterns=[
        "trustpilot-widget", "tp-widget", "birdeye-widget",
        "yotpo-widget", "google-reviews-widget",
        "review-widget", "yelp-badge", "yelp-widget",
    ],
)

LEAD_CAPTURE_PATTERNS = _Pattern(
    label="lead_capture",
    script_patterns=[
        "optinmonster.com",
        "sumo.com", "sumome.com",
        "mailchimp.com", "chimpstatic.com",
        "convertkit.com",
        "leadpages.net",
        "popupsmart.com",
        "getresponse.com",
    ],
    html_patterns=[
        "optinmonster", "sumo-popup", "mailchimp-form",
        "newsletter-signup", "email-capture", "lead-form",
        "popup-overlay", "exit-intent", "subscribe-form",
        "mc-embedded-subscribe", "convertkit-form",
    ],
)

AUTOMATION_PATTERNS = _Pattern(
    label="automation",
    script_patterns=[
        "zapier.com",
        "make.com", "integromat.com",
        "automate.io",
        "n8n.io",
        "ifttt.com",
    ],
    html_patterns=[
        "zapier-embed", "integromat", "make-widget",
        "automation-embed",
    ],
)

FEATURE_GROUPS: dict[str, _Pattern] = {
    "has_live_chat": LIVE_CHAT_PATTERNS,
    "has_chatbot": CHATBOT_PATTERNS,
    "has_whatsapp": WHATSAPP_PATTERNS,
    "has_crm": CRM_PATTERNS,
    "has_booking": BOOKING_PATTERNS,
    "has_reviews_widget": REVIEWS_WIDGET_PATTERNS,
    "has_lead_capture": LEAD_CAPTURE_PATTERNS,
    "has_automation": AUTOMATION_PATTERNS,
}

# ---- Tech-stack detection ----

TECH_STACK_PATTERNS: list[tuple[str, list[str]]] = [
    # Analytics
    ("Google Analytics", ["google-analytics.com", "googletagmanager.com", "gtag/js", "analytics.js"]),
    ("Google Tag Manager", ["googletagmanager.com/gtm.js"]),
    ("Facebook Pixel", ["connect.facebook.net", "fbevents.js", "fbq("]),
    ("Hotjar", ["hotjar.com", "static.hotjar.com"]),
    ("Mixpanel", ["mixpanel.com", "cdn.mxpnl.com"]),
    ("Segment", ["cdn.segment.com", "analytics.segment"]),
    ("Clarity", ["clarity.ms"]),
    # CMS / Frameworks
    ("WordPress", ["wp-content", "wp-includes", "wp-json"]),
    ("Wix", ["static.wixstatic.com", "wix.com"]),
    ("Squarespace", ["squarespace.com", "static1.squarespace.com"]),
    ("Shopify", ["cdn.shopify.com", "myshopify.com"]),
    ("Webflow", ["webflow.com", "assets.website-files.com"]),
    ("React", ["react.production.min", "react-dom", "reactjs"]),
    ("Vue.js", ["vue.min.js", "vuejs.org", "vue.global"]),
    ("Angular", ["angular.min.js", "angular.io"]),
    ("jQuery", ["jquery.min.js", "jquery-", "code.jquery.com"]),
    ("Bootstrap", ["bootstrap.min.css", "bootstrap.min.js", "getbootstrap.com"]),
    ("Tailwind CSS", ["tailwindcss", "tailwind.min.css"]),
    # Hosting / CDN
    ("Cloudflare", ["cdnjs.cloudflare.com", "cloudflare.com", "__cf_bm"]),
    ("Vercel", ["vercel.app", "vercel-analytics"]),
    ("Netlify", ["netlify.app", "netlify-identity"]),
    # Marketing
    ("HubSpot", ["hubspot.com", "hs-scripts.com"]),
    ("Mailchimp", ["mailchimp.com", "chimpstatic.com"]),
    ("ActiveCampaign", ["activecampaign.com"]),
    # Payment
    ("Stripe", ["stripe.com", "js.stripe.com"]),
    ("PayPal", ["paypal.com", "paypalobjects.com"]),
    ("Square", ["squareup.com", "square.site"]),
    # Chat
    ("Tawk.to", ["tawk.to"]),
    ("Intercom", ["intercom.io", "intercomcdn.com"]),
    ("Drift", ["drift.com", "driftt.com"]),
    ("Zendesk", ["zendesk.com", "zdassets.com"]),
    ("LiveChat", ["livechatinc.com"]),
    ("Crisp", ["crisp.chat"]),
]


class TechDetector:
    """Detect technologies, features, and third-party integrations on a website."""

    def detect_from_html(
        self, html: str, scripts: list[str] | None = None
    ) -> dict[str, bool]:
        """Return a feature-flag dict keyed by ``has_*`` names."""
        scripts = scripts or []
        html_lower = html.lower()
        scripts_combined = " ".join(s.lower() for s in scripts)

        results: dict[str, bool] = {}
        for feature_key, pattern in FEATURE_GROUPS.items():
            detected = False
            for sp in pattern.script_patterns:
                if sp.lower() in scripts_combined or sp.lower() in html_lower:
                    detected = True
                    break
            if not detected:
                for hp in pattern.html_patterns:
                    if hp.lower() in html_lower:
                        detected = True
                        break
            # Extra heuristic: forms with email inputs ➜ lead capture
            if feature_key == "has_lead_capture" and not detected:
                if re.search(r'<input[^>]+type=["\']email["\']', html_lower):
                    detected = True
            results[feature_key] = detected

        return results

    def detect_tech_stack(
        self, html: str, scripts: list[str] | None = None
    ) -> list[str]:
        """Return a list of detected technology names."""
        scripts = scripts or []
        html_lower = html.lower()
        scripts_combined = " ".join(s.lower() for s in scripts)
        search_text = html_lower + " " + scripts_combined

        detected: list[str] = []
        for tech_name, patterns in TECH_STACK_PATTERNS:
            for pattern in patterns:
                if pattern.lower() in search_text:
                    if tech_name not in detected:
                        detected.append(tech_name)
                    break

        return detected

    def full_analysis(
        self, html: str, scripts: list[str] | None = None
    ) -> dict:
        """Run both feature detection and tech-stack detection."""
        return {
            "features": self.detect_from_html(html, scripts),
            "tech_stack": self.detect_tech_stack(html, scripts),
        }
