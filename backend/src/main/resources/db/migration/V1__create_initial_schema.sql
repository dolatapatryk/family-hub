CREATE TABLE households (
    id TEXT NOT NULL PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE users (
    id TEXT NOT NULL PRIMARY KEY,
    household_id TEXT NOT NULL,
    name TEXT NOT NULL,
    FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE
);

CREATE TABLE tasks (
    id TEXT NOT NULL PRIMARY KEY,
    household_id TEXT NOT NULL,
    title TEXT NOT NULL,
    due_date DATE NULL,
    completed BOOLEAN NOT NULL DEFAULT 0,
    assigned_to TEXT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_to) REFERENCES users (id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE TABLE shopping_items (
    id TEXT NOT NULL PRIMARY KEY,
    household_id TEXT NOT NULL,
    name TEXT NOT NULL,
    quantity TEXT NULL,
    completed BOOLEAN NOT NULL DEFAULT 0,
    added_by TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE,
    FOREIGN KEY (added_by) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE INDEX idx_users_household_id ON users (household_id);
CREATE INDEX idx_tasks_household_id ON tasks (household_id);
CREATE INDEX idx_tasks_due_date ON tasks (due_date);
CREATE INDEX idx_shopping_items_household_id ON shopping_items (household_id);
