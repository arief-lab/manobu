import { createClient } from "@libsql/client";
import { env } from "@manobu/env/server";
import { drizzle } from "drizzle-orm/libsql";

import {
  grammar,
  kanji,
  sentences,
  themes,
  vocab,
  vocabKanji,
  vocabThemes,
} from "./schema/content";
import {
  cards,
  conversations,
  drafts,
  drillAttempts,
  drillPoolItems,
  drillSessionLifecycle,
  drillSessions,
  examAnswers,
  examItems,
  examSections,
  exams,
  items,
  messages,
  revlog,
  settings,
  srsPause,
} from "./schema/user";

export interface ContentSchema {
  grammar: typeof grammar;
  kanji: typeof kanji;
  sentences: typeof sentences;
  themes: typeof themes;
  vocab: typeof vocab;
  vocabKanji: typeof vocabKanji;
  vocabThemes: typeof vocabThemes;
}
export interface UserSchema {
  cards: typeof cards;
  conversations: typeof conversations;
  drafts: typeof drafts;
  drillAttempts: typeof drillAttempts;
  drillPoolItems: typeof drillPoolItems;
  drillSessionLifecycle: typeof drillSessionLifecycle;
  drillSessions: typeof drillSessions;
  examAnswers: typeof examAnswers;
  examItems: typeof examItems;
  examSections: typeof examSections;
  exams: typeof exams;
  items: typeof items;
  messages: typeof messages;
  revlog: typeof revlog;
  settings: typeof settings;
  srsPause: typeof srsPause;
}

const applyPragmas = async (
  client: ReturnType<typeof createClient>
): Promise<void> => {
  // WAL + foreign_keys must be set on every connection; libSQL exposes exec via client.execute
  await client.execute("PRAGMA journal_mode = WAL;");
  await client.execute("PRAGMA foreign_keys = ON;");
  await client.execute("PRAGMA busy_timeout = 5000;");
};

const contentSchema = {
  grammar,
  kanji,
  sentences,
  themes,
  vocab,
  vocabKanji,
  vocabThemes,
};

const userSchema = {
  cards,
  conversations,
  drafts,
  drillAttempts,
  drillPoolItems,
  drillSessionLifecycle,
  drillSessions,
  examAnswers,
  examItems,
  examSections,
  exams,
  items,
  messages,
  revlog,
  settings,
  srsPause,
};

export const createContentDb = async (url?: string) => {
  const client = createClient({
    url: url ?? env.CONTENT_DATABASE_URL ?? "file:./content.db",
  });
  // content.db is read-only in production but writable during bundling/seeding
  await applyPragmas(client);
  return drizzle({ client, schema: contentSchema });
};

export const createUserDb = async (url?: string) => {
  const client = createClient({
    url: url ?? env.DATABASE_URL,
  });
  await applyPragmas(client);
  return drizzle({ client, schema: userSchema });
};

export const createDb = (url?: string) => {
  const client = createClient({
    url: url ?? env.DATABASE_URL,
  });
  return drizzle({
    client,
    schema: { ...contentSchema, ...userSchema },
  });
};

export const db = createDb();

export { contentSchema, userSchema };
