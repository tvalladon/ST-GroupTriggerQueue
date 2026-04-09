# ST-GroupTriggerQueue

A SillyTavern extension that queues group member trigger button clicks during active generation, then auto-fires them in sequence when each generation completes.

## Features

- Click a character's speak button while generation is running to add them to the queue
- Queue position shown as a numbered badge on the speak button
- Click a queued character again to remove them from the queue
- Auto-advances through the queue as each generation finishes
- Skips muted/disabled characters automatically
- Queue clears when you hit Stop or send a new message
- Queue resets on chat switch

## Install

1. Open SillyTavern and go to **Extensions** > **Install Extension**
2. Paste the repository URL:
   ```
   https://github.com/tvalladon/ST-GroupTriggerQueue
   ```
3. Click **Install**
4. Enable the extension in **Extensions** > **Manage Extensions** if not auto-enabled

## How It Works

- If nothing is generating, clicking a character's speak button works normally (fires immediately)
- If generation is in progress, subsequent clicks queue instead of firing
- When generation finishes, the extension fires `/trigger <name>` for the next character in the queue
- The cycle continues until the queue is empty or interrupted
