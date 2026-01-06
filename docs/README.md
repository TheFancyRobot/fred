# Documentation

This directory contains the source files for Fred's documentation.

## Setup

Install MkDocs and dependencies:

```bash
pip install -r requirements.txt
```

Or install directly:

```bash
pip install mkdocs-material mkdocs-git-revision-date-localized-plugin
```

## Development

Serve documentation locally:

```bash
bun run docs:dev
# or
mkdocs serve
```

Documentation will be available at `http://127.0.0.1:8000`

## Build

Build static site:

```bash
bun run docs:build
# or
mkdocs build
```

Output will be in the `site/` directory.

## Deployment

Documentation is automatically deployed to GitHub Pages via GitHub Actions when changes are pushed to the `main` branch.

To deploy manually:

```bash
bun run docs:deploy
# or
mkdocs gh-deploy
```

## Configuration

Before deploying, update the `site_url` in `mkdocs.yml` to match your GitHub Pages URL:

```yaml
site_url: https://yourusername.github.io/fred
```

Also update the repository URLs:

```yaml
repo_name: fred
repo_url: https://github.com/yourusername/fred
```

