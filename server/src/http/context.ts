import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { Session } from "../auth/tokens";
import type * as schema from "../db/schema";

/**
 * What a group of routes needs from the request handler, passed in rather than imported, so
 * route files stay small and the helpers keep living in one place.
 */
export interface RouteContext {
  req: Request;
  url: URL;
  env: {
    APP_ORIGIN: string;
    SESSIONS: KVNamespace;
    DB: D1Database;
  } & Record<string, unknown>;
  db: DrizzleD1Database<typeof schema>;
  waitUntil: (p: Promise<unknown>) => void;
  reply: (res: Response) => Response;
  session: () => Promise<{ token: string; session: Session } | null>;
  membership: (userId: string, orgId: string) => Promise<{ role: string; orgId: string; userId: string } | undefined>;
  audit: (entry: { orgId: string; userId?: string; action: string; recordKind?: string; recordId?: string; summary?: string }) => Promise<void>;
  uid: (prefix: string) => string;
  send: (message: { to: string; subject: string; text: string }) => Promise<boolean>;
  planOf: (orgId: string) => Promise<{ plan: { id: string; name: string }; trialing: boolean } | null>;
}
