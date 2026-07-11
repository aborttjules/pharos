# Pharos Dashboard

Frontend analytics desk for the Pharos watchtower and trade observation infrastructure.

The dashboard is intentionally frontend-first:

- Landing page explaining Pharos's watcher-only safety model
- Centralized trade observation for agent-collected swap activity across supported platforms
- Natural language query support for asking whether a trade path is safe
- Critical loss warnings surfaced in the dashboard and via connected Telegram alerts
- Webpack dev/build mode to avoid Turbopack manifest instability in Next 16

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Verify

```bash
npm run lint
npm run build
```

## Notes

The manual scanner runs in the browser and mirrors backend scoring signals for demo reliability. It does not submit bundles, sign transactions, or require `localhost:3001`.
