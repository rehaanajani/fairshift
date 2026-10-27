import { createApp } from "./app.ts";

const port = Number(process.env.PORT) || 8080;
createApp().listen(port, () => console.log(`FairShift on http://localhost:${port}`));
