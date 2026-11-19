# NEAR agents

A deploy deck for putting an agent on NEAR, powered by 0xRay. The page is a testnet rehearsal. It does not send a chain transaction, and it does not ask for a key.

## Run

Install dependencies, run the tests, and build the site:

```
npm install
npm test
npm run build
```

`npm run dev` starts the Vite dev server for local editing.

`npm start` serves the built files in `dist`. It listens on `PORT` when that variable is set, and on 4321 when it is not.

## Host

The live site is https://near-agents-production.up.railway.app. The Railway service builds with `npm run build` and starts with `npm start`. See `railway.toml`.
