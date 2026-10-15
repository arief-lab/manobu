import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

export const vocab = sqliteTable(
  "vocab",
  {
    audioPath: text("audio_path"),
    en: text("en").notNull(),
    id: integer("id").primaryKey({ autoIncrement: true }),
    jp: text("jp").notNull(),
    level: text("level").notNull(),
    pitch: text("pitch"),
    reading: text("reading").notNull(),
    romaji: text("romaji").notNull(),
  },
  (table) => [index("idx_vocab_level").on(table.level)]
);

export const kanji = sqliteTable(
  "kanji",
  {
    char: text("char").primaryKey(),
    freq: integer("freq"),
    grade: integer("grade"),
    kun: text("kun"),
    level: text("level").notNull(),
    meaning: text("meaning").notNull(),
    on: text("on"),
    strokes: integer("strokes").notNull(),
  },
  (table) => [index("idx_kanji_freq").on(table.freq)]
);

export const vocabKanji = sqliteTable(
  "vocab_kanji",
  {
    kanji: text("kanji")
      .notNull()
      .references(() => kanji.char),
    vocabId: integer("vocab_id")
      .notNull()
      .references(() => vocab.id),
  },
  (table) => [primaryKey({ columns: [table.vocabId, table.kanji] })]
);

export const themes = sqliteTable("themes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const vocabThemes = sqliteTable(
  "vocab_themes",
  {
    themeId: integer("theme_id")
      .notNull()
      .references(() => themes.id),
    vocabId: integer("vocab_id")
      .notNull()
      .references(() => vocab.id),
  },
  (table) => [primaryKey({ columns: [table.vocabId, table.themeId] })]
);

export const grammar = sqliteTable("grammar", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  level: text("level").notNull(),
  pattern: text("pattern").notNull(),
  point: text("point").notNull(),
  ref: text("ref").notNull(),
});

export const sentences = sqliteTable("sentences", {
  en: text("en").notNull(),
  id: integer("id").primaryKey({ autoIncrement: true }),
  jp: text("jp").notNull(),
  /** Character length of `jp` — cheap complexity filter for level picks. */
  jpLen: integer("jp_len").notNull().default(0),
  level: text("level").notNull(),
  /** Tanaka B-line word surfaces (JSON array string), from jpn_indices. */
  linkedWord: text("linked_word"),
});

/**
 * JMnedict proper nouns (TASK-23.6, doc-2 §5.5) — SEPARATE from `vocab` by
 * design: proper-noun hits must not pollute vocab ranking. Populated at
 * runtime from packages/japanese/data/names.jsonl (not the seed script);
 * FTS lives in `names_fts` (migration 0004, vaporetto tokenizer, no English
 * column — JMnedict carries no glosses).
 */
export const names = sqliteTable("names", {
  id: integer("id").primaryKey(),
  nameType: text("name_type").notNull().default("unclassified"),
  reading: text("reading").notNull().default(""),
  word: text("word").notNull(),
});
