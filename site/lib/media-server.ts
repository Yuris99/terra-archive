import "server-only";
import path from "node:path";
import { createMediaStore } from "../../scripts/lib/local-media.mjs";
export const media = createMediaStore(path.resolve(process.cwd(), ".."));
