import { Hono } from "hono";
import type { AppEnv } from "../env";

export const rewardsRouter = new Hono<AppEnv>();
