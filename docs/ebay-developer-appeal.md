# eBay Developer Program — Registration Appeal

Drop this into a Submit-a-Ticket at https://developer.ebay.com/support
(the Submit a Ticket / Contact Support form). Pick category
**"Account Registration Issues"** if it's offered, otherwise
**"Other"**.

---

## Subject

Registration auto-rejected — requesting human review for legitimate sports-card aggregator use case

## Body

Hi eBay Developer team,

I registered for the Developer Program on [INSERT DATE] and received an
automatic rejection email shortly after with no reason given. I also
tried registering with a separate email and received the same outcome,
which suggests an automated risk-score rejection rather than a specific
disqualification.

I'm requesting a manual review for the following reasons:

**1. My eBay buyer/seller account is in excellent standing.**
- Account: [INSERT YOUR EBAY USERNAME]
- [Optionally: feedback score / years as a member / seller rating]
- Zero disputes, holds, or returns; no policy violations on record.

**2. Concrete, narrow use case — not a scraper or reseller tool.**

I run https://breakboys.app, a sports-card "break tracking" web app
where users upload product checklists (Topps Chrome, Bowman, Panini,
etc.) and view per-team / per-player breakdowns of what cards exist in
that product. The app helps card breakers and buyers evaluate the
content of a product before buying into a team-pick break.

We currently use **PriceCharting Pro** ($50/month subscription) as our
market-data source, but their coverage of modern sports-card auto and
parallel variants is very limited. We'd like to use the **eBay Browse
API** (sold-listing-driven, where available) to display the median
recent sale price next to each card on a checklist — read-only,
display-only, no scraping, no relisting, no commercial reselling.

**3. Specific endpoints I'd use.**

- `GET /buy/browse/v1/item_summary/search` — query by card-specific
  search terms, retrieve up to 50 results, compute a trimmed median.
- That's the entire surface area. No private endpoints, no buying or
  bidding APIs, no order/transaction flows.

**4. Compliance commitments I can make up front.**

- Implement **Marketplace Account Deletion notification** endpoint as
  required for production apps.
- Clearly attribute eBay as the data source on the price display
  ("Median recent sold listings on eBay").
- Cache results — the cron runs once weekly per product, not real-time
  per user request, so the call volume will be a few thousand requests
  per week at most.
- Not redistribute the underlying listing data to third parties.

**5. The integration is already built.**

I built the eBay Browse client in anticipation of approval months ago
(`src/lib/sources/pricing/ebayCards.ts` in our codebase). The day a
production keyset arrives, I drop in `EBAY_APP_ID` and
`EBAY_CERT_ID` as environment variables and the existing automated
weekly cron starts pulling real data. No additional engineering
required on my end.

Could a human review the registration and either approve it or tell
me what specifically tripped the automated decision so I can address
it? I'm happy to provide additional verification (LLC docs if I form
one, alternate ID, additional details on the use case) if that would
help.

Thanks for your time,

[YOUR NAME]
[YOUR EMAIL]
breakboys.app

---

## After submitting

- Reply window is usually **3-7 business days**
- If you hear nothing in 10 days, **bump the ticket** with a polite
  "checking in" reply on the same thread
- If denied again with a reason, **come back with the specific reason**
  and we can address it head-on

## Backup angle if the ticket route stalls

The eBay Developer Forum has staff that occasionally help with
registration issues:
https://community.ebay.com/t5/Developer-API-Forum/bd-p/devApi

A polite post titled "Auto-rejected on Developer registration —
seeking guidance" with the same content (sanitized) sometimes catches
a moderator's attention faster than the ticket queue.
