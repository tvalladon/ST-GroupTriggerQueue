/**
 * ST-GroupTriggerQueue — SillyTavern Extension
 *
 * Intercepts group member trigger ("speak") button clicks and queues them
 * when generation is already in progress. Auto-advances the queue when
 * each generation finishes. Click a queued character again to dequeue.
 *
 * Uses ST's native queue display system (.is_queued, .is_active, .queue_position)
 * so the "Show group chat queue" setting controls visibility as expected.
 */

import { eventSource, event_types, is_send_press, Generate } from '../../../../script.js';
import { is_group_generating } from '../../../group-chats.js';
import { power_user } from '../../../power-user.js';

const EXT_NAME = 'ST-GroupTriggerQueue';

/** @type {{ chid: number, name: string }[]} */
let queue = [];

/** True while the extension is actively processing the queue */
let isProcessingQueue = false;

/** True if user manually started generation while queue was active */
let userInitiatedGeneration = false;

/** Timeout ID for the pending queue advance, prevents double-firing */
let pendingAdvanceTimeout = null;

/** MutationObserver reference for cleanup */
let memberListObserver = null;

// ─── Helpers ──────────────────────────────────────────────────────────

function isGenerating() {
    return is_send_press || is_group_generating;
}

/**
 * Get character info from a .group_member DOM element.
 * @param {Element} memberEl
 * @returns {{ chid: number, name: string } | null}
 */
function getMemberInfo(memberEl) {
    const chid = Number(memberEl.getAttribute('data-chid'));
    const name = memberEl.querySelector('.ch_name')?.textContent?.trim();
    if (!Number.isInteger(chid) || !name) return null;
    return { chid, name };
}

// ─── Queue management ─────────────────────────────────────────────────

function clearQueue() {
    queue = [];
    updateQueueDisplay();
    console.debug(`[${EXT_NAME}] Queue cleared`);
}

function enqueue(chid, name) {
    if (isQueued(chid)) return;
    queue.push({ chid, name });
    console.debug(`[${EXT_NAME}] Enqueued: ${name} (position ${queue.length})`);
    updateQueueDisplay();
}

function dequeue(chid) {
    const idx = queue.findIndex(entry => entry.chid === chid);
    if (idx === -1) return false;
    const removed = queue.splice(idx, 1)[0];
    console.debug(`[${EXT_NAME}] Dequeued: ${removed.name}`);
    updateQueueDisplay();
    return true;
}

function isQueued(chid) {
    return queue.some(entry => entry.chid === chid);
}

function queuePosition(chid) {
    return queue.findIndex(entry => entry.chid === chid) + 1; // 1-based, 0 = not found
}

// ─── Queue display ────────────────────────────────────────────────────

/**
 * Apply queue state to all visible group members using ST's native
 * .is_queued class and .queue_position text. Respects the
 * "Show group chat queue" user setting — cleans up if disabled.
 */
function updateQueueDisplay() {
    const members = document.querySelectorAll('#rm_group_members .group_member');
    // Offset queue numbers by 1 when a character is actively generating,
    // since ST shows that character as #1 via is_active
    const offset = isProcessingQueue || isGenerating() ? 1 : 0;

    members.forEach(memberEl => {
        const chid = Number(memberEl.getAttribute('data-chid'));
        const pos = queuePosition(chid);
        const queuePosEl = memberEl.querySelector('.queue_position');

        if (pos > 0 && power_user.show_group_chat_queue) {
            memberEl.classList.add('is_queued');
            if (queuePosEl) queuePosEl.textContent = pos + offset;
        } else {
            memberEl.classList.remove('is_queued');
            // Preserve queue_position text if ST set is_active on this member
            if (queuePosEl && !memberEl.classList.contains('is_active')) {
                queuePosEl.textContent = '';
            }
        }
    });
}

// ─── Click interception ───────────────────────────────────────────────

/**
 * Native capturing listener on the group members container.
 * Fires before jQuery's delegated click handler so we can intercept.
 */
function onSpeakClick(event) {
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
        return;
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

    container.removeEventListener('click', onSpeakClick, true);
    container.addEventListener('click', onSpeakClick, true);
    console.debug(`[${EXT_NAME}] Click interceptor attached`);
}

// ─── Queue processing (auto-advance) ─────────────────────────────────

/**
 * Fires the next character in the queue via Generate().
 * Uses the same call as ST's native speak button handler to avoid
 * slash command parsing and any injection risk from character names.
 */
async function processNextInQueue() {
    // Bail if queue was cleared (stop, user message, chat switch)
    if (queue.length === 0 || userInitiatedGeneration) {
        isProcessingQueue = false;
        updateQueueDisplay();
        return;
    }

    const next = queue.shift();
    isProcessingQueue = true;
    updateQueueDisplay();
    console.debug(`[${EXT_NAME}] Triggering: ${next.name} (chid: ${next.chid})`);

    try {
        await Generate('normal', { force_chid: next.chid });
    } catch (err) {
        console.error(`[${EXT_NAME}] Error triggering ${next.name}:`, err);
    }

    // Continue processing — don't rely on onGenerationEnded since
    // isProcessingQueue is true, which blocks the event handler.
    // Small delay to let ST finish post-generation cleanup.
    setTimeout(() => processNextInQueue(), 300);
}

// ─── Event hooks ──────────────────────────────────────────────────────

/**
 * GENERATION_ENDED: auto-advance the queue unless the user started a
 * manual generation (typed a message or clicked Generate themselves).
 * Uses a debounced timeout to prevent double-firing from rapid events.
 */
function onGenerationEnded() {
    if (userInitiatedGeneration) {
        console.debug(`[${EXT_NAME}] User-initiated generation detected, clearing queue`);
        clearTimeout(pendingAdvanceTimeout);
        pendingAdvanceTimeout = null;
        clearQueue();
        isProcessingQueue = false;
        userInitiatedGeneration = false;
        return;
    }

    // Only kick off processing if not already running — processNextInQueue
    // self-loops once started, so we just handle the initial trigger here.
    if (!isProcessingQueue && queue.length > 0) {
        clearTimeout(pendingAdvanceTimeout);
        pendingAdvanceTimeout = setTimeout(() => {
            pendingAdvanceTimeout = null;
            if (queue.length > 0 && !isProcessingQueue) {
                processNextInQueue();
            }
        }, 300);
    }
}

/** GENERATION_STOPPED: user hit Stop — clear the queue. */
function onGenerationStopped() {
    console.debug(`[${EXT_NAME}] Generation stopped, clearing queue`);
    clearTimeout(pendingAdvanceTimeout);
    pendingAdvanceTimeout = null;
    clearQueue();
    isProcessingQueue = false;
    userInitiatedGeneration = false;
}

/**
 * Detect user-initiated messages. When the user sends a new message,
 * flag it so the queue clears on the next GENERATION_ENDED.
 */
function onUserMessageRendered() {
    if (queue.length > 0 || isProcessingQueue) {
        // Flag so the queue clears when the current generation ends.
        // Note: if a queued Generate() is in flight, the user's new message
        // could overlap. ST's is_send_press guard should prevent this, but
        // we clear the queue regardless to avoid stale state.
        userInitiatedGeneration = true;
    }
}

/** GROUP_UPDATED: re-attach interceptor and re-apply queue display after ST re-renders. */
function onGroupUpdated() {
    attachInterceptor();
    observeMemberList();
    updateQueueDisplay();
}

/** Chat switch: reset all state. */
function onChatChanged() {
    clearTimeout(pendingAdvanceTimeout);
    pendingAdvanceTimeout = null;
    clearQueue();
    isProcessingQueue = false;
    userInitiatedGeneration = false;
    setTimeout(() => {
        attachInterceptor();
        observeMemberList();
    }, 100);
}

// ─── Initialization ───────────────────────────────────────────────────

/**
 * Observe #rm_group_members for child changes (ST re-renders member list).
 * Re-apply queue display synchronously before browser paint to avoid flash.
 */
function observeMemberList() {
    const container = document.getElementById('rm_group_members');
    if (!container) return;

    if (memberListObserver) {
        memberListObserver.disconnect();
    }

    memberListObserver = new MutationObserver(() => {
        if (queue.length > 0) {
            updateQueueDisplay();
        }
    });

    memberListObserver.observe(container, { childList: true });
    console.debug(`[${EXT_NAME}] MutationObserver attached to #rm_group_members`);
}

(function init() {
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.on(event_types.GENERATION_STOPPED, onGenerationStopped);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, onUserMessageRendered);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.GROUP_UPDATED, onGroupUpdated);

    attachInterceptor();
    observeMemberList();

    console.log(`[${EXT_NAME}] Extension loaded`);
})();
