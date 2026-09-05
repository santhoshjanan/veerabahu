import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { startBackground } from "$lib/server/bootstrap";

describe("startBackground", () => {
  const origEnv = process.env.VB_DISABLE_SCHEDULERS;

  beforeEach(() => {
    process.env.VB_DISABLE_SCHEDULERS = "true";
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.VB_DISABLE_SCHEDULERS = origEnv;
    } else {
      delete process.env.VB_DISABLE_SCHEDULERS;
    }
  });

  it("is a no-op when disabled and returns a stop() that does not throw", async () => {
    const h = await startBackground({ disabled: true });
    expect(typeof h.stop).toBe("function");
    expect(() => h.stop()).not.toThrow();
  });

  it("is a no-op when VB_DISABLE_SCHEDULERS=true in process.env", async () => {
    process.env.VB_DISABLE_SCHEDULERS = "true";
    const h = await startBackground();
    expect(typeof h.stop).toBe("function");
    expect(() => h.stop()).not.toThrow();
  });

  it("is safe to call twice (second call does not start a second set of loops)", async () => {
    const a = await startBackground({ disabled: true });
    const b = await startBackground({ disabled: true });
    expect(typeof a.stop).toBe("function");
    expect(typeof b.stop).toBe("function");
    a.stop();
    b.stop();
  });

  it("stop() is idempotent", async () => {
    const h = await startBackground({ disabled: true });
    expect(() => {
      h.stop();
      h.stop();
    }).not.toThrow();
  });
});
