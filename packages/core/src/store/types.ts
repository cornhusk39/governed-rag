// Local alias for the better-sqlite3 database type. Importing it in one place
// keeps the rest of the store readable and makes it obvious where the dependency
// enters the code.

import type DatabaseConstructor from "better-sqlite3";

export type DatabaseHandle = DatabaseConstructor.Database;
