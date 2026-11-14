# Hire Juniors

A public job board for people starting their careers: internships,
apprenticeships, graduate schemes and junior roles, collected weekly from
company job boards (Greenhouse, Lever, Ashby, Amazon Jobs) into one
crawlable list at hirejuniors.dev.

- **Site (apex)** — public, no accounts: job listings, level/country hubs,
  company pages, sitemap, RSS, llms.txt.
- **App (`app.` subdomain)** — owner-only admin dashboard: jobs, companies,
  ingest sources and runs.
- **Ingest worker** — weekly workflow that fetches boards, classifies junior
  roles, retires closed ones.

The board stores only public listing data; the dashboard is a separate
surface with a single admin user.
