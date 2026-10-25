# Loading-state verification

Install dependencies and Chromium once, then run the loading regression suite:

```sh
npm install
npx playwright install chromium
npm run test:loading
```

The browser checks use synthetic API responses and block external requests. They
cover all 10 portal pages at 320, 390, 768, and 1440 pixels, loading-state cleanup,
full-width schedule placeholder rows, reduced motion, failed requests, and button
recovery. Screenshots are written to
`qcu-loading-checks` inside the operating system's temporary directory.

Admin detail checks hold the request open to verify the View button keeps its
width, shows a spinner, and prevents repeat actions. A failed request restores
the button and displays an error; a successful retry opens the account dialog.

Run `npm run test:cor` and `npm run test:admin` for the COR and admin regressions.

Verified on 2026-09-13: all three suites passed, including all 40 page/viewport
combinations. The mobile schedule screenshot was reviewed after fixing collapsed
placeholder rows. JavaScript syntax checks and `git diff --check` also passed.
