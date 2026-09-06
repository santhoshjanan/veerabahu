declare global {
  namespace App {
    interface Locals {
      adminSession: import('$lib/server/db/types').SessionRow | null;
    }

    interface PageState {
      sheet?: { domain: string };
    }
  }
}

export {};
