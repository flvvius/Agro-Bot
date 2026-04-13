import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const farmers = sqliteTable("farmers", {
  id: text("id").primaryKey(),
  phone: text("phone"),
  name: text("name"),
  location: text("location"),
  crops: text("crops"),
  onboardingStep: text("onboarding_step"),
  onboardingCompleted: integer("onboarding_completed"),
  createdAt: integer("created_at", { mode: "timestamp" }),
  lastActive: integer("last_active", { mode: "timestamp" }),
});

export const priceCache = sqliteTable("price_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  data: text("data"),
  fetchedAt: integer("fetched_at", { mode: "timestamp" }),
});

export const diagnoses = sqliteTable("diagnoses", {
  id: text("id").primaryKey(),
  farmerId: text("farmer_id"),
  imageKey: text("image_key"),
  diagnosis: text("diagnosis"),
  confidence: text("confidence"),
  geminiResponse: text("gemini_response"),
  feedbackCorrect: integer("feedback_correct"),
  createdAt: integer("created_at", { mode: "timestamp" }),
});
