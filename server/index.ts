import { createApp } from "./app.ts";
import { seed } from "./seed.ts";
import { openStore } from "./store.ts";

const port = Number(process.env.PORT) || 8080;
const store = await openStore(() => seed());
const server = createApp(store).listen(port, () => console.log(`FairShift on http://localhost:${port}`));

// Cloud Run sends SIGTERM before stopping an instance: save the latest state first.
process.on("SIGTERM", async () => {
  await store.flush();
  server.close(() => process.exit(0));
});
