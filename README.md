# Hermes Web App

Built and deployed via Hermes Agent + GitHub Actions.

## Development

```bash
npm install
npm run dev
```

## CI/CD

- **CI** (`ci.yml`): Lint, type-check, test, build on every push/PR
- **Deploy** (`deploy.yml`): Auto-deploy on push to main (configure provider in workflow)

## Add Deployment Provider

Edit `.github/workflows/deploy.yml` and uncomment the section for your provider (Vercel/Netlify), then add the required secrets in GitHub repo settings.
