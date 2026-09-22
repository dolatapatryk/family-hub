ALTER TABLE shopping_items ADD COLUMN store TEXT NULL;

CREATE INDEX idx_shopping_items_household_store ON shopping_items (household_id, store);
