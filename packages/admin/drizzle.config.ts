import { defineConfig } from "drizzle-kit"

export default defineConfig({
    schema: "./src/db/schema.ts",
    out: "./drizzle",
    dialect: "mysql",
    dbCredentials: {
        host: "localhost",
        port: 3306,
        user: "root",
        password: "password",
        database: "admin_db", // Assuming a database name, user can change if needed
    },
})
