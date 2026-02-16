# Contributing to Data Talks

Thanks for contributing. Please follow the guidelines below to keep the project consistent and easy to maintain.

## Project standard: English

**All documentation and code comments in this repository must be in English.**

- Use English for:
  - README and other markdown docs
  - Inline comments and docstrings
  - Commit messages and PR descriptions
- User-facing UI strings are handled by the app’s i18n (`LanguageContext`) and may exist in multiple languages for end users.

## Setup

### Backend

- Create a virtual environment and install dependencies:
  - `cd backend`
  - `python -m venv .venv`
  - `.\.venv\Scripts\activate` (Windows) or `source .venv/bin/activate` (macOS/Linux)
  - `pip install -e .`

### Frontend

- Install dependencies:
  - `npm install`

## Development

- Backend:
  - `cd backend`
  - `uv run data-talks run`
- Frontend:
  - `npm run dev`

## Tests and linting

- Frontend lint:
  - `npm run lint`
- Frontend build:
  - `npm run build`

If you add or change backend functionality, include a brief manual test note in your PR description.

## Code style

- Keep code changes focused and small.
- Prefer clear, explicit naming over cleverness.
- Avoid large refactors without prior discussion.

## Commits and pull requests

- Keep commits focused and descriptive.
- Include a short summary and a test plan in PRs.
- Link related issues when applicable.

## Reporting issues

When filing bugs, include:
- Steps to reproduce
- Expected vs. actual behavior
- Environment details (OS, Node/Python versions)

Thank you for contributing.
