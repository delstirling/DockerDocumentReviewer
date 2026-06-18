import express from "express";
import { LandingPage } from "./components/landing-page.js";
import pkg from "pg";

const { Pool } = pkg;

const app = express();

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: 5432
});

app.get("/", async (_req, res) => {
  const result = await pool.query("SELECT NOW() as current_time");
  res.json(result.rows);
});

app.listen(3000, () => {
  console.log("Server running on port 3000 ts");
});