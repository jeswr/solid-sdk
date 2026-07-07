# coeliac-app

A privacy-first food-and-symptom diary for coeliac disease and other food intolerances. Log meals, exposures, and symptoms; the app helps surface likely trigger patterns, run structured elimination protocols, and shape a personalised diet plan — while keeping all of your health data in your own [Solid](https://solidproject.org/) pod rather than on someone else's server. The diary is written with the reusable [`@jeswr/solid-health-diary`](https://github.com/jeswr/solid-health-diary) model (the shared `diet:` sector of the @jeswr federation vocabulary), so it stays portable and readable by other pod-native apps.

> **Status: under active development.** This is an experimental, AI-assisted build — not a finished or production-ready product, and **not medical advice**. Consult a qualified healthcare professional about diagnosis, testing, and any dietary change.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
