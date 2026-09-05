import { startBackground } from "$lib/server/bootstrap";

// Fire and forget; never block request handling on scheduler startup.
void startBackground().catch((e) =>
  console.error("background startup failed", e),
);
