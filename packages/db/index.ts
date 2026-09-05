import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export * from "./schema";

type D1DatabaseBinding = Parameters<typeof drizzle>[0];

function isD1DatabaseBinding(value: unknown): value is D1DatabaseBinding {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return "prepare" in value && typeof value.prepare === "function";
}

export function createDb(d1: unknown) {
  if (!isD1DatabaseBinding(d1)) {
    throw new Error("createDb requires a D1Database binding");
  }
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
