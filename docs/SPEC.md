# Card Break Tracker App

## Concept

A web app (eventually mobile) for card break **buyers/collectors** to track what they own and what they're still looking for across different break products.

---

## Core Features

### 1. Product Selection
- User selects a break product (e.g. "2024 Topps Chrome Baseball")
- Supports all sports: MLB, NBA, NFL, NHL (and others)
- Products have an associated checklist (uploaded per product)

### 2. Price Guide by Team
- Each product has a price guide showing cost per team slot
- Prices entered manually or imported via CSV
- Helps buyer know what each team costs before buying in
- Tracks both **wholesale** (breaker's cost) and **retail** (buyer's slot cost)

### 3. Team Selection
- User selects which teams they bought into for a given product/break
- Works regardless of break format (PYT, random, etc.) — you just pick your teams

### 4. "What I Have / What I Need" View
- After selecting teams, app shows:
  - Cards/players on those teams from the checklist
  - Ability to mark cards as: **owned**, **want**, or **still looking for**
- Drill-down from team-level → individual card-level tracking

### 5. Release Calendar
- Products grouped by release month
- Future: populated automatically from a checklist API

---

## Data Model (rough)

```
Product
  - name (e.g. "2024 Topps Chrome Baseball")
  - sport
  - releaseDate
  - source (manual | api:<provider>)
  - checklist (uploaded, CSV or paste)
  - team_prices: { team_name: { wholesale, retail } }

UserBreak
  - product_id
  - teams_owned: [team_names]

Card (from checklist)
  - product_id
  - team
  - player_name
  - card_number
  - variation / parallel

UserCard
  - card_id
  - status: owned | want | looking_for
```

---

## Tech Stack

- **Frontend + backend:** Next.js 15 (App Router, TypeScript)
- **DB:** SQLite (dev) via Prisma — Postgres-portable for production
- **Styling:** Tailwind CSS
- **CSV import:** papaparse (file upload + paste)
- **Auth:** Stubbed single-user for MVP. Every user-scoped row carries a `userId` so multi-user can be turned on later without a migration.

---

## Phase 1 MVP

1. Create/select a product (with optional release date)
2. Upload a checklist (CSV)
3. Enter wholesale + retail team prices for that product
4. Select your teams (start a break)
5. See your cards and mark them as owned / want / looking-for
6. View a release calendar of products

## Future / Phase 2

- External checklist API ingestion (auto-populate products + cards)
- Wholesale price tracker pulled from market data (eBay sold listings, etc.)
- Mobile app (React Native, shared API)
- Shareable "have/want" lists
- Trade matching (you have what I need, I have what you need)
- Notifications when someone has a card you're looking for
- Multi-user accounts (NextAuth)
