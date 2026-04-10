# ST-GroupTriggerQueue

A SillyTavern extension that lets you queue up multiple character responses in group chats. Click the speak buttons for the characters you want to hear from, and the extension will trigger them one at a time, waiting for each to finish before starting the next.

## The Problem

In SillyTavern group chats, clicking a character's speak button (the chat bubble icon) while another character is already generating does nothing — you have to wait for each response to finish before triggering the next. This means babysitting the chat and clicking one at a time.

## The Solution

With this extension, you can click multiple characters' speak buttons while generation is active. Each click adds that character to a queue, and the extension automatically triggers them in order as each generation completes.

## Features

- **Queue during generation** — Click speak buttons while a response is generating to queue characters up
- **Immediate when idle** — If nothing is generating, the first click works normally with no delay
- **Visual queue position** — Queued characters show their position number and a highlight outline (requires the "Show group chat queue" setting to be enabled)
- **Toggle to dequeue** — Click a queued character's speak button again to remove them from the queue
- **Auto-advance** — When a generation finishes, the next character in the queue is triggered automatically
- **Smart clearing** — The queue clears automatically when you:
  - Hit the Stop button
  - Send a new message
  - Switch to a different chat

## Install

1. Open SillyTavern and go to **Extensions** > **Install Extension**
2. Paste the repository URL:
   ```
   https://github.com/tvalladon/ST-GroupTriggerQueue
   ```
3. Click **Install**
4. Enable the extension in **Extensions** > **Manage Extensions** if not auto-enabled

## Usage

1. Open a group chat with multiple characters
2. Send a message or trigger a character as you normally would
3. While that character is responding, click the speak button (chat bubble icon) on other characters you want to respond next
4. Each click adds them to the queue — you'll see numbered badges and outlines if "Show group chat queue" is enabled in your User Settings
5. Sit back and watch as each character responds in the order you queued them

### Tips

- **Reorder by dequeuing** — Click a queued character to remove them, then re-click to add them at the end
- **Cancel everything** — Hit Stop or send a new message to clear the queue instantly
- **Works with muted characters** — Muted characters can still be queued and triggered, matching ST's default speak button behavior

## Settings

This extension uses SillyTavern's built-in **Show group chat queue** setting for visual indicators. To enable it:

1. Go to **User Settings** (the gear icon)
2. Check **Show group chat queue**

This controls whether queued characters show numbered badges and highlight outlines. The queue itself works regardless of this setting — it only affects the visual display.

## License

MIT
