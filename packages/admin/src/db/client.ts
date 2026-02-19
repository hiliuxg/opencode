import { drizzle } from "drizzle-orm/mysql2"
import mysql from "mysql2/promise"

import { Config } from "../config"
import * as schema from "./schema"

let _db: any | undefined

export function getDb() {
    if (_db) return _db

    const poolConnection = mysql.createPool({
        ...Config.db,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
    })

    _db = drizzle(poolConnection, { schema, mode: "default" })
    return _db
}

export { schema }
