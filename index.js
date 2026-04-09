/**
 * ST-GroupTriggerQueue — SillyTavern Extension
 *
 * Intercepts group member trigger ("speak") button clicks and queues them
 * when generation is already in progress. Auto-advances the queue when
 * each generation finishes. Click a queued character again to dequeue.
 */

// Imports relative to /scripts/extensions/third-party/ST-GroupTriggerQueue/
import { getContext, extension_settings } from '../../../extensions.js';
import { eventSource, event_types, is_send_press } from '../../../../script.js';
import { selected_group, is_group_generating } from '../../../group-chats.js';
import { executeSlashCommandsWithOptions } from '../../../slash-commands.js';

const EXT_NAME = 'ST-GroupTriggerQueue';

/** @type {{ chid: number, name: string }[]} */
let queue = [];

/** True while the extension is actively processing the queue (firing /trigger) */
let isProcessingQueue = false;

/** True if user manually started generation while queue was active */
let userInitiatedGeneration = false;

// ─── Helpers ──────────────────────────────────────────────────────────

function isGenerating() {
    return is_send_press || is_group_generating;
}

/**
 * Get character name from a .group_member DOM element.
 * @param {Element} memberEl
 * @returns {{ chid: number, name: string } | null}
 */
function getMemberInfo(memberEl) {
    const chid = Number(memberEl.getAttribute('data-chid'));
    const name = memberEl.querySelector('.ch_name')?.textContent?.trim();
    if (!Number.isInteger(chid) || !name) return null;
    return { chid, name };
}

/**
 * Check if a member element represents a muted/disabled character.
 * @param {Element} memberEl
 * @returns {boolean}
 */
function isMuted(memberEl) {
    return memberEl.classList.contains('disabled');
}

// ─── Queue management ─────────────────────────────────────────────────

function clearQueue() {
    queue = [];
    updateAllBadges();
    console.debug(`[${EXT_NAME}] Queue cleared`);
}

function enqueue(chid, name) {
    queue.push({ chid, name });
    console.debug(`[${EXT_NAME}] Enqueued: ${name} (position ${queue.length})`);
    updateAllBadges();
}

function dequeue(chid) {
    const idx = queue.findIndex(entry => entry.chid === chid);
    if (idx !== -1) {
        const removed = queue.splice(idx, 1)[0];
        console.debug(`[${EXT_NAME}] Dequeued: ${removed.name}`);
        updateAllBadges();
        return true;
    }
    return false;
}

function isQueued(chid) {
    return queue.some(entry => entry.chid === chid);
}

function queuePosition(chid) {
    return queue.findIndex(entry => entry.chid === chid) + 1; // 1-based, 0 = not found
}

// ─── Badge display ────────────────────────────────────────────────────

/** Update badge numbers on all visible group member speak buttons. */
function updateAllBadges() {
    const members = document.querySelectorAll('#rm_group_members .group_member');
    members.forEach(memberEl => {
        const chid = Number(memberEl.getAttribute('data-chid'));
        const speakBtn = memberEl.querySelector('[data-action="speak"]');
        if (!speakBtn) return;

        const pos = queuePosition(chid);
        // Use a data attribute + CSS ::after for the badge
        if (pos > 0) {
            speakBtn.setAttribute('data-queue-pos', pos);
            speakBtn.classList.add('gtq-queued');
        } else {
            speakBtn.removeAttribute('data-queue-pos');
            speakBtn.classList.remove('gtq-queued');
        }
    });
}

// ─── Click interception ───────────────────────────────────────────────

/**
 * Native capturing listener on the group members container.
 * Fires before jQuery's delegated click handler so we can intercept.
 */
function onSpeakClick(event) {
    // Only intercept clicks on the speak button
    const speakBtn = event.target.closest('[data-action="speak"]');
    if (!speakBtn) return;

    const memberEl = speakBtn.closest('.group_member');
    if (!memberEl) return;

    const info = getMemberInfo(memberEl);
    if (!info) return;

    // If already queued, toggle it off (dequeue)
    if (isQueued(info.chid)) {
        event.stopImmediatePropagation();
        event.preventDefault();
        dequeue(info.chid);
        return;
    }

    // If nothing is generating and queue is empty, let the click through normally
    if (!isGenerating() && queue.length === 0 && !isProcessingQueue) {
        return; // ST's default handler will fire the trigger
    }

    // Otherwise, intercept and enqueue
    event.stopImmediatePropagation();
    event.preventDefault();
    enqueue(info.chid, info.name);
}

/** Attach the capturing listener to the group members container. */
function attachInterceptor() {
    const container = document.getElementById('rm_group_members');
    if (!container) return;

    // Remove previous listener to avoid duplicates (same function reference)
    container.removeEventListener('click', onSpeakClick, true);
    container.addEventListener('click', onSpeakClick, true);
    console.debug(`[${EXT_NAME}] Click interceptor attached`);
}

// ─── Queue processing (auto-advance) ─────────────────────────────────

/**
 * Fires the next character in the queue via /trigger.
 * Called when generation ends and the queue is non-empty.
 */
async function processNextInQueue() {
    if (queue.length === 0) {
        isProcessingQueue = false;
        return;
    }

    // Skip muted characters
    while (queue.length > 0) {
        const next = queue[0];
        const memberEl = document.querySelector(
            `#rm_group_members .group_member[data-chid="${next.chid}"]`
        );

        if (memberEl && isMuted(memberEl)) {
            console.debug(`[${EXT_NAME}] Skipping muted character: ${next.name}`);
            queue.shift();
            updateAllBadges();
            continue;
        }
        break;
    }

    if (queue.length === 0) {
        isProcessingQueue = false;
        updateAllBadges();
        return;
    }

    const next = queue.shift();
    updateAllBadges();

    isProcessingQueue = true;
    console.debug(`[${EXT_NAME}] Triggering: ${next.name}`);

    try {
        await executeSlashCommandsWithOptions(`/trigger await=true ${next.name}`);
    } catch (err) {
        console.error(`[${EXT_NAME}] Error triggering ${next.name}:`, err);
        isProcessingQueue = false;
    }
    // processNextInQueue will be called again by the GENERATION_ENDED handler
}

// ─── Event hooks ──────────────────────────────────────────────────────

/**
 * GENERATION_ENDED: auto-advance the queue unless the user started a
 * manual generation (typed a message or clicked Generate themselves).
 */
function onGenerationEnded() {
    if (userInitiatedGeneration) {
        // User manually started something — clear the queue
        console.debug(`[${EXT_NAME}] User-initiated generation detected, clearing queue`);
        clearQueue();
        isProcessingQueue = false;
        userInitiatedGeneration = false;
        return;
    }

    // Small delay to let ST finish its post-generation cleanup
    setTimeout(() => {
        if (queue.length > 0) {
            processNextInQueue();
        } else {
            isProcessingQueue = false;
        }
    }, 300);
}

/** GENERATION_STOPPED: user hit Stop — clear the queue. */
function onGenerationStopped() {
    console.debug(`[${EXT_NAME}] Generation stopped, clearing queue`);
    clearQueue();
    isProcessingQueue = false;
    userInitiatedGeneration = false;
}

/**
 * Detect user-initiated messages. When the user sends a new message,
 * we flag it so the queue clears on the next GENERATION_ENDED.
 */
function onUserMessageRendered() {
    if (queue.length > 0 || isProcessingQueue) {
        userInitiatedGeneration = true;
    }
}

/** GROUP_UPDATED / chat load: re-attach interceptor since ST re-renders the member list. */
function onGroupUpdated() {
    attachInterceptor();
    updateAllBadges();
}

/** Chat switch: reset everything. */
function onChatChanged() {
    clearQueue();
    isProcessingQueue = false;
    userInitiatedGeneration = false;
    // Re-attach after a brief delay to let the DOM settle
    setTimeout(() => attachInterceptor(), 100);
}

// ─── Initialization ───────────────────────────────────────────────────

function injectStyles() {
    const style = document.createElement('style');
    style.id = `${EXT_NAME}-styles`;
    style.textContent = `
        /* Queue position badge on speak button */
        .gtq-queued {
            position: relative;
        }
        .gtq-queued::after {
            content: attr(data-queue-pos);
            position: absolute;
            top: -6px;
            right: -6px;
            background: var(--SmartThemeQuoteColor, #e67e22);
            color: var(--SmartThemeBodyColor, #fff);
            font-size: 10px;
            font-weight: bold;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            pointer-events: none;
            z-index: 1;
            line-height: 1;
        }
    `;
    document.head.appendChild(style);
}

(function init() {
    // Only activate in group chats, but register listeners globally —
    // the handlers themselves check for group context where needed.
    injectStyles();

    // Event hooks for queue advancement and clearing
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.on(event_types.GENERATION_STOPPED, onGenerationStopped);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onUserMessageRendered);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.GROUP_UPDATED, onGroupUpdated);

    // Initial attachment
    attachInterceptor();

    console.log(`[${EXT_NAME}] Extension loaded`);
})();
