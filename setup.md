# LeadForge AI — Complete Setup & Automation Guide

> **Version:** 1.0.0  
> **Platform:** Windows / Linux / macOS / Docker  
> **Stack:** Node.js 20 + Python 3.11 + PostgreSQL 16 + Redis 7

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Installation (Local)](#2-installation-local)
3. [Installation (Docker — Recommended)](#3-installation-docker--recommended)
4. [Environment Configuration](#4-environment-configuration)
5. [Getting API Keys](#5-getting-api-keys)
6. [First-Time Setup (In-App)](#6-first-time-setup-in-app)
7. [Running the Automation](#7-running-the-automation)
8. [How Each Level Works](#8-how-each-level-works)
9. [SMTP Email Setup (Gmail / Outlook)](#9-smtp-email-setup-gmail--outlook)
10. [Deployment to HuggingFace Spaces](#10-deployment-to-huggingface-spaces)
11. [Troubleshooting](#11-troubleshooting)
12. [Project Structure](#12-project-structure)

---

## 1. Prerequisites

### For Docker Installation (Recommended)
- **Docker Desktop** — [Download here](https://www.docker.com/products/docker-desktop/)
- **Git** (optional) — to clone the repository

### For Local Installation
- **Node.js 20+** — [Download here](https://nodejs.org/)
- **Python 3.11+** — [Download here](https://www.python.org/downloads/)
- **PostgreSQL 16** — [Download here](https://www.postgresql.org/download/)
- **Redis 7** — [Download here](https://redis.io/download/)
  - Windows: Use [Memurai](https://www.memurai.com/) or WSL
- **Git** (optional)

---

## 2. Installation (Local)

### Step 1: Clone or Download the Project

```bash
# If using git:
git clone <your-repo-url>
cd "Client Acquitision for Leads for us"

# Or extract the ZIP to a folder
```

### Step 2: Configure Environment Variables

```bash
# Copy the example .env file
cp .env.example .env
```

Edit the `.env` file (see [Section 4](#4-environment-configuration) for details).

### Step 3: Start PostgreSQL & Redis

Make sure PostgreSQL and Redis are running:

```bash
# PostgreSQL - create database
psql -U postgres -c "CREATE USER leadforge WITH PASSWORD 'leadforge_secret';"
psql -U postgres -c "CREATE DATABASE leadforge_db OWNER leadforge;"

# Redis - start service (Linux/Mac)
redis-server
# Windows - start Memurai or use WSL
```

### Step 4: Install & Start Backend

```bash
cd backend
npm install
node server.js
```

You should see:
```
LeadForge AI server running on http://0.0.0.0:7860
Database connection established successfully.
Database models synchronized.
BullMQ queues initialized.
BullMQ workers started.
```

### Step 5: Install & Start Python Scraper

Open a **second terminal**:

```bash
cd scraper

# Create virtual environment
python -m venv venv

# Activate it:
# Windows:
venv\Scripts\activate
# Linux/Mac:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Install browser for scraping
playwright install chromium

# Start scraper
python main.py
```

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Step 6: Access the App

Open **http://localhost:7860** in your browser.

---

## 3. Installation (Docker — Recommended)

### Step 1: Configure Environment

```bash
cp .env.example .env
```

Edit `.env` — at minimum set:
- `JWT_SECRET` — a strong random string (e.g., `openssl rand -hex 32`)
- `GROQ_API_KEY_1` — your Groq API key (see [Section 5](#5-getting-api-keys))

### Step 2: Build & Start

```bash
docker compose up -d
```

This starts 3 containers:
- **db** — PostgreSQL 16
- **redis** — Redis 7
- **app** — Node.js backend + Python scraper (managed by supervisord)

### Step 3: Verify Everything Started

```bash
docker compose logs -f app
```

Wait for:
```
LeadForge AI server running on http://0.0.0.0:7860
```

### Step 4: Access

Open **http://localhost:7860** in your browser.

### Useful Docker Commands

```bash
# View logs
docker compose logs -f

# Restart
docker compose restart

# Stop
docker compose down

# Rebuild after code changes
docker compose up -d --build

# Remove everything (including data)
docker compose down -v
```

---

## 4. Environment Configuration

Edit the `.env` file in the project root:

```env
# ============ REQUIRED ============

# Database
DATABASE_URL=postgres://leadforge:leadforge_secret@localhost:5432/leadforge_db

# Redis
REDIS_URL=redis://localhost:6379

# Authentication (CHANGE THIS!)
JWT_SECRET=your-super-secret-random-string-here
JWT_EXPIRES_IN=7d

# AI (at least one key required)
GROQ_API_KEY_1=gsk_your_actual_key_here

# ============ OPTIONAL ============

# Additional Groq keys for rotation (handles rate limits)
GROQ_API_KEY_2=gsk_second_key
GROQ_API_KEY_3=gsk_third_key
GROQ_API_KEY_4=gsk_fourth_key
GROQ_API_KEY_5=gsk_fifth_key

# AI Model (default is great, change if you prefer)
GROQ_MODEL=llama-3.3-70b-versatile

# Server
PORT=7860
NODE_ENV=production

# Campaign defaults
DEFAULT_DAILY_EMAIL_LIMIT=50
MAX_FOLLOWUPS=3

# Logging
LOG_LEVEL=info
```

> **⚠️ IMPORTANT:** Never commit your `.env` file to Git. It contains secrets!

---

## 5. Getting API Keys

### Groq API Key (Required — FREE)

1. Go to **https://console.groq.com**
2. Sign up / Log in
3. Click **API Keys** → **Create API Key**
4. Copy the key (starts with `gsk_`)
5. Add to `.env` as `GROQ_API_KEY_1`

> **TIP:** Create multiple keys (up to 5) for automatic rotation when one hits rate limits. Each free account gets generous usage.

### Gmail App Password (For Email Sending)

1. Go to **https://myaccount.google.com/security**
2. Enable **2-Step Verification** (if not already)
3. Go to **https://myaccount.google.com/apppasswords**
4. Select **"Mail"** and **"Other (Custom name)"** → enter "LeadForge"
5. Click **Generate** → copy the 16-character password
6. Use this as the SMTP password in the app (NOT your Gmail login password)

### Outlook App Password (Alternative)

1. Go to **https://account.microsoft.com/security**
2. Under **Security** → **Advanced security options**
3. **App passwords** → **Create a new app password**
4. Copy the generated password

---

## 6. First-Time Setup (In-App)

### Step 1: Register Your Account

1. Open **http://localhost:7860**
2. Click the **Register** tab
3. Enter your name, email, and password (min 8 characters)
4. Click **Create Account**

### Step 2: Add Groq API Key

1. Go to **Settings** (sidebar) → **AI Keys** tab
2. Click **+ Add Key**
3. Enter a label (e.g., "Main Key")
4. Paste your Groq API key
5. Click **Add Key**

> You can add up to 5 keys. The system rotates them automatically when one gets rate-limited.

### Step 3: Add SMTP Account

1. Go to **Settings** → **SMTP Accounts** tab
2. Click **+ Add Account**
3. Select **Gmail** or **Outlook** as provider
4. Enter your email address
5. Enter your **App Password** (NOT your normal login password — see Section 5)
6. Set daily send limit (default: 500)
7. Click **Save Account**
8. Click **Test** on the newly added account to verify it works

> **⚠️ IMPORTANT:** Always use an App Password. Regular passwords won't work with Gmail/Outlook SMTP.

---

## 7. Running the Automation

### Step 1: Create a Campaign

1. Go to **Dashboard** (sidebar)
2. In the **Quick Start** section, enter your search query:
   - `Plumber in New York`
   - `Dentist in California`
   - `Restaurant in Texas`
   - `Web Developer in London`
3. Click **Start Campaign**

### Step 2: What Happens Automatically

When you start a campaign, the system runs this pipeline **automatically in the background**:

```
1. 🔍 BUSINESS DISCOVERY
   └─ Scrapes Google Maps, Yelp, YellowPages, BBB, Bing, Facebook
   └─ Collects: Name, Address, Phone, Website, Rating, Reviews Count
   
2. 📝 REVIEW COLLECTION
   └─ Scrapes latest 20 reviews for each business
   └─ Extracts: Reviewer, Rating, Text, Date
   
3. 🌐 WEBSITE CRAWLING
   └─ Crawls business websites (up to 10 pages each)
   └─ Detects: Chatbot, WhatsApp, CRM, Booking, Lead Forms, SSL, Speed
   
4. 📧 EMAIL DISCOVERY
   └─ Finds email addresses from websites
   └─ Classifies: Owner, Marketing, Support, General
   
5. 🤖 AI ANALYSIS (Groq LLM)
   └─ Analyzes business data + reviews + website issues
   └─ Generates: Lead Score (0-100), Pain Points, Recommended Services
   
6. ✅ EMAIL VERIFICATION
   └─ MX Record lookup + SMTP handshake
   └─ Marks: Valid, Invalid, Risky, Catch-All
   
7. ✉️ OUTREACH EMAIL GENERATION
   └─ AI writes personalized email for each business
   └─ References their specific review complaints + website issues
   └─ Creates draft emails (NOT sent automatically)
```

### Step 3: Review & Approve Emails

1. Go to **Outreach** (sidebar)
2. Review each generated email
3. **Approve** ✅ — marks for sending
4. **Reject** ❌ — discard
5. **Edit** ✏️ — modify before approving
6. Use **Approve All** for bulk approval
7. Click **Send All** to queue approved emails for delivery

### Step 4: Monitor Replies

1. Go to **Reply Center** (sidebar)
2. View incoming replies, classified by AI:
   - 🟢 **Interested** — wants to know more
   - 💰 **Send Pricing** — asked about costs
   - 📞 **Call Me** — wants a phone call
   - 🔴 **Not Interested** — declined
   - ❌ **Unsubscribe** — wants removal
3. Respond directly from the reply center
4. Generate AI follow-ups for non-responders

### Step 5: Track Pipeline

1. Go to **Pipeline** (sidebar)
2. Drag-and-drop leads between stages:
   ```
   Discovered → Analyzed → Email Sent → Opened →
   Replied → Interested → Meeting Scheduled →
   Proposal Sent → Won / Lost
   ```

### Step 6: View Analytics

1. Go to **Analytics** (sidebar)
2. View charts:
   - Emails sent over time
   - Open/Reply rates
   - Lead source distribution
   - Conversion funnel
   - Top performing campaigns

---

## 8. How Each Level Works

| Level | Feature | How It Works |
|-------|---------|-------------|
| 1 | **User Dashboard** | Login → Dashboard with campaign input box |
| 2 | **Business Discovery** | 7 scraper sources run in parallel via Playwright |
| 3 | **Review Intelligence** | Scrapes top 20 reviews, feeds to AI for analysis |
| 4 | **Website Intelligence** | Playwright crawls websites, detects 30+ technologies |
| 5 | **AI Consultant** | Groq LLM analyzes data, scores lead, suggests services |
| 6 | **Lead Prioritization** | Score 0-100 based on missing features, bad reviews, no website |
| 7 | **Email Discovery** | Regex + mailto + JSON-LD extraction from websites |
| 8 | **Email Verification** | DNS MX lookup + SMTP RCPT TO handshake + catch-all detection |
| 9 | **AI Email Writer** | Groq generates personalized email referencing specific pain points |
| 10 | **Manual Approval** | Review each email before sending — edit, approve, or reject |
| 11 | **Email Delivery** | Nodemailer SMTP with rate limiting, domain rotation, daily caps |
| 12 | **Reply Center** | AI classifies responses into 7 categories for prioritization |
| 13 | **Follow-Up System** | 3-sequence AI-generated follow-ups with escalating tone |
| 14 | **Sales Pipeline** | 10-stage Kanban board with drag-and-drop |
| 15 | **Analytics** | Chart.js dashboards with conversion funnels and insights |

---

## 9. SMTP Email Setup (Gmail / Outlook)

### Gmail Setup

1. **Enable 2-Factor Authentication:**
   - https://myaccount.google.com/security
   
2. **Create App Password:**
   - https://myaccount.google.com/apppasswords
   - Select Mail → Other → "LeadForge"
   - Copy the 16-character password

3. **In LeadForge Settings:**
   - Provider: **Gmail**
   - Email: your-email@gmail.com
   - Password: paste the 16-char App Password
   - Daily Limit: 500 (Gmail allows up to 500/day)

### Outlook Setup

1. **Enable App Password:**
   - https://account.microsoft.com/security → Advanced security → App passwords
   
2. **In LeadForge Settings:**
   - Provider: **Outlook**
   - Email: your-email@outlook.com
   - Password: paste the App Password
   - Daily Limit: 300 (Outlook limit)

### Custom SMTP

For other providers (SendGrid, Mailgun, etc.):
- Provider: **Custom**
- Enter the SMTP host, port, email, and password
- The system supports both SSL (port 465) and TLS (port 587)

### Email Best Practices

- ✅ Start with **20-30 emails/day** and gradually increase
- ✅ Use multiple SMTP accounts for domain rotation
- ✅ Space emails at least 30 seconds apart (configured in settings)
- ✅ Always include unsubscribe option (added automatically)
- ❌ Don't send more than 500 emails/day from a single account
- ❌ Don't skip the manual approval step

---

## 10. Deployment to HuggingFace Spaces

### Step 1: Create External Services

You need external PostgreSQL and Redis for HuggingFace deployment:

**Free PostgreSQL:**
- [Neon](https://neon.tech/) — free tier, 0.5 GB storage
- [Supabase](https://supabase.com/) — free tier, 500 MB storage

**Free Redis:**
- [Upstash](https://upstash.com/) — free tier, 256 MB

### Step 2: Create HuggingFace Space

1. Go to [huggingface.co/new-space](https://huggingface.co/new-space)
2. Name it (e.g., `leadforge-ai`)
3. Select **Docker** as SDK
4. Set visibility (private recommended)

### Step 3: Push Code

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://huggingface.co/spaces/YOUR_USERNAME/leadforge-ai
git push origin main
```

### Step 4: Set Environment Variables

In Space Settings → Variables & Secrets:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `postgres://user:pass@host:5432/dbname?sslmode=require` |
| `REDIS_URL` | `redis://default:password@host:port` |
| `JWT_SECRET` | (generate with `openssl rand -hex 32`) |
| `GROQ_API_KEY_1` | `gsk_your_key_here` |

### Step 5: Wait for Build

The Space will auto-build and deploy. Access at:
```
https://YOUR_USERNAME-leadforge-ai.hf.space
```

---

## 11. Troubleshooting

### "Cannot connect to database"
```bash
# Check PostgreSQL is running
psql -U leadforge -d leadforge_db -c "SELECT 1;"

# Check DATABASE_URL in .env
# For Docker: use "db" as hostname, not "localhost"
```

### "Redis connection refused"
```bash
# Check Redis is running
redis-cli ping  # Should return "PONG"

# For Docker: use "redis" as hostname
```

### "No Groq API keys available"
- Add at least one key in **Settings → AI Keys**
- Or set `GROQ_API_KEY_1=gsk_...` in `.env`
- Check the key starts with `gsk_`

### "SMTP test failed"
- Make sure you're using an **App Password**, not your regular password
- Gmail requires 2FA enabled before generating App Passwords
- Check your email provider hasn't blocked the login

### "Scraper returning 0 results"
- Google Maps may block if no proxy is configured
- Playwright browser may not be installed: run `playwright install chromium`
- Check scraper logs: `docker compose logs scraper` or check `logs/scraper.log`

### "Playwright not found"
```bash
cd scraper
# Activate virtual environment first
playwright install chromium
```

### Port 7860 already in use
```bash
# Change PORT in .env to another port
PORT=3000
```

---

## 12. Project Structure

```
LeadForge AI/
├── .env.example              # Environment template
├── .env                      # Your config (gitignored)
├── docker-compose.yml        # Docker orchestration
├── Dockerfile                # All-in-one container
├── supervisord.conf          # Process manager
├── README.md                 # HuggingFace Spaces metadata
│
├── backend/                  # Node.js Express API
│   ├── server.js             # Entry point (port 7860)
│   ├── package.json          # Dependencies
│   ├── config/               # DB, Redis, Groq configuration
│   ├── models/               # 13 Sequelize database models
│   ├── routes/               # 9 REST API route files
│   ├── services/             # Business logic (AI, SMTP, Verification)
│   ├── queues/               # BullMQ queues & workers
│   ├── middleware/            # Auth, error handling, rate limiting
│   └── utils/                # Logger, helpers, validators
│
├── scraper/                  # Python FastAPI microservice
│   ├── main.py               # Entry point (port 8000)
│   ├── requirements.txt      # Python dependencies
│   ├── scrapers/             # 7 business source scrapers
│   ├── crawlers/             # Website crawler + email finder
│   ├── analyzers/            # Tech detector + review analyzer
│   └── utils/                # Browser pool, proxy rotation
│
└── frontend/                 # Static HTML/CSS/JS
    ├── index.html            # Login / Register
    ├── dashboard.html        # Main dashboard
    ├── campaigns.html        # Campaign management
    ├── leads.html            # Lead explorer (AG Grid)
    ├── outreach.html         # Email approval workflow
    ├── replies.html          # Reply center
    ├── pipeline.html         # Sales pipeline (Kanban)
    ├── analytics.html        # Charts & metrics
    ├── settings.html         # Configuration
    ├── css/custom.css        # Full design system (37KB)
    └── js/                   # 11 JavaScript modules
```

---

## Quick Reference

| Action | URL / Command |
|--------|--------------|
| Access app | http://localhost:7860 |
| Health check | http://localhost:7860/api/health |
| Scraper health | http://localhost:8000/health |
| Start (Docker) | `docker compose up -d` |
| Stop (Docker) | `docker compose down` |
| View logs | `docker compose logs -f` |
| Start backend (local) | `cd backend && node server.js` |
| Start scraper (local) | `cd scraper && python main.py` |

---

**Built with ❤️ — LeadForge AI v1.0.0**
