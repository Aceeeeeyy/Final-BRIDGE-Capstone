-- Migration: add multi-provider tracking to interventions
-- Run this in your Supabase SQL Editor if your `interventions` table
-- already exists (i.e. you ran the original schema.sql before this change).
-- Safe to run multiple times.

ALTER TABLE interventions
  ADD COLUMN IF NOT EXISTS ai_provider TEXT,
  ADD COLUMN IF NOT EXISTS ai_model    TEXT;

COMMENT ON COLUMN interventions.ai_provider IS 'Which AI service generated this recommendation (Claude, ChatGPT, DeepSeek, Gemini)';
COMMENT ON COLUMN interventions.ai_model    IS 'Specific model id used (e.g. claude-sonnet-4-6, gpt-4o, deepseek-chat, gemini-2.5-flash)';
