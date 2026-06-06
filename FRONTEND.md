# Mainspring Frontend

The coworker-provided frontend handoff is copied into this repository at `mainspring-front/`.

The runnable static page is:

```text
mainspring-front/project/index.html
```

Local preview:

```bash
npm run front:dev
```

This serves the copied page at `http://127.0.0.1:4177/`.

Build only the copied frontend into `dist/`:

```bash
npm run front:build
```

Build the public landing page plus VitePress docs under `/docs`:

```bash
npm run build
```

Vercel uses the root `npm run build` command and deploys `dist/`.
