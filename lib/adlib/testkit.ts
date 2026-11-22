/** Folder of the recorded library responses used by the tests (outside `data/sample/`, which `sample:generate` rebuilds). */
import path from "node:path";

export const ADLIB_FIXTURES = path.join(process.cwd(), "data", "examples", "adlib");
