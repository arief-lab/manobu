-- TASK-40 AC7: snapshot the vocab word at card-insert time. cards.vocabId
-- is a position in a level file (next-cards.ts: vocabId = i + 1) with no
-- level column — ambiguous across levels and useless for display. The
-- POST /cards payload already carries jp/level/reading (NextCard); store
-- them so /cards/due can serve real words without a second data source.
ALTER TABLE `cards` ADD COLUMN `jp` TEXT;
ALTER TABLE `cards` ADD COLUMN `reading` TEXT;
ALTER TABLE `cards` ADD COLUMN `level` TEXT;
