CREATE TABLE `terminal_preset_catalog` (
	`id` integer PRIMARY KEY NOT NULL,
	`presets_json` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL
);
