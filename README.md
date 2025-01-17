# Hire Juniors

Looking for the first job in tech is not easy. Although there are a lot of openings out there is no central place where these postings are listed, especially for junior roles and internships. [hirejuniors.dev](https://hirejuniors.dev) is a website that aims to list all these opportunities for someone who is going to start their journey in tech. [hirejuniors.dev](https://hirejuniors.dev) aims to be a community-driven project. If you come across any job posting for a junior role or for an internship please fill-out the Typeform to get it listed.

Let us take a step to help and welcome junior developers on this amazing journey.

## Contributing 🚀

We love when people contribute to the project. Refer to the [CONTRIBUTING.md](./CONTRIBUTING.md) to learn how you can get involved.

## Built With 💪

- React Router
- Cloudflare Workers
- Cloudflare D1
- Cloudflare Workflows
- Drizzle ORM

## Getting Started

### Installation

Install the dependencies:

```bash
npm install
```

### Development

Run an initial database migration:

```bash
npm run db:migrate
```

Start the development server with HMR:

```bash
npm run dev
```

Your application will be available at `http://localhost:5173`.

## Building for Production

Create a production build:

```bash
npm run build
```

## Deployment

Deployment is done using the Wrangler CLI.

To deploy directly to production:

```sh
npx wrangler deploy
```

To deploy a preview URL:

```sh
npx wrangler versions upload
```

You can then promote a version to production after verification or roll it out progressively.

```sh
npx wrangler versions deploy
```
