/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fan Tool Engine: A Manifest V3 compliant automation runner.
 * It executes a sequence of data-driven actions in the browser tab.
 */

/**
 * Core Primitives - These run inside the tab's context via executeScript.
 * They MUST be self-contained or use standard browser APIs.
 */
const primitives = {
  /** Reads text from the first matching selector or coordinate point. */
  smartRead: ({ selectors = [], points = [], fallbackToBody = true }) => {
    const textFrom = (el) => {
      if (!el) return '';
      const inner = (el.innerText || '').trim();
      const content = (el.textContent || '').trim();
      return inner.length > 0 ? inner : content;
    };

    const isVisible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };

    // 1. Try Selectors
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) {
          const t = textFrom(el);
          if (t) return t;
        }
      } catch (e) {}
    }

    // 2. Try Points
    for (const [px, py] of points) {
      const x = Math.floor(px * window.innerWidth);
      const y = Math.floor(py * window.innerHeight);
      let el = document.elementFromPoint(x, y);
      if (el && el !== document.body) {
        const t = textFrom(el);
        if (t) return t;
      }
    }

    // 3. Fallback
    return fallbackToBody ? textFrom(document.body).slice(0, 5000) : '';
  },

  /** Handles complex key presses with focus management. */
  safePress: async ({ key, focusPoint = [1, 1], delay = 100 }) => {
    // 1. Manage Focus
    if (document.activeElement) document.activeElement.blur();
    
    const [fx, fy] = focusPoint;
    const clickTarget = document.elementFromPoint(fx, fy) || document.body;
    
    const events = ['pointerdown', 'pointerup', 'click'];
    events.forEach(type => {
      clickTarget.dispatchEvent(new MouseEvent(type, { 
        bubbles: true, cancelable: true, view: window, clientX: fx, clientY: fy 
      }));
    });

    await new Promise(r => setTimeout(r, delay));
    
    if (!document.body.hasAttribute('tabindex')) {
      document.body.setAttribute('tabindex', '-1');
    }
    document.body.focus();

    // 2. Dispatch Key
    const code = key === ' ' ? 'Space' : key;
    const keyCode = key === ' ' ? 32 : (key === 'ArrowRight' ? 39 : 37);
    
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, keyCode, bubbles: true }));
    return true;
  },

  /** Clicks an element, optionally traversing parents to find specific text or icons. */
  clickElement: async ({ selector, parentWithText, delay = 200 }) => {
    let el = document.querySelector(selector);
    if (!el) return { error: `Selector not found: ${selector}` };

    if (parentWithText) {
      while (el && !el.textContent.includes(parentWithText)) {
        el = el.parentElement;
      }
    }

    if (!el) return { error: `Parent with text "${parentWithText}" not found for ${selector}` };
    
    el.click();
    if (delay) await new Promise(r => setTimeout(r, delay));
    return true;
  },

  /** Simple navigation */
  navigate: ({ url }) => {
    window.location.href = url;
    return true;
  }
};

/**
 * Runner - Executes a sequence of steps defined in a Fan Spec.
 * This runs in the Extension context (sidebar).
 */
export async function executeFanSequence(tabId, sequence, toolArgs = {}) {
  let lastResult = null;

  for (const step of sequence) {
    const { action, args = {} } = step;
    
    // 1. Resolve arguments (allow template strings like {{query}})
    const resolvedArgs = {};
    for (const [key, val] of Object.entries(args)) {
      if (typeof val === 'string') {
        resolvedArgs[key] = val.replace(/\{\{(\w+)\}\}/g, (_, match) => toolArgs[val] || val);
      } else {
        resolvedArgs[key] = val;
      }
    }

    // 2. Special case for 'wait' which is local to the runner
    if (action === 'wait') {
      await new Promise(r => setTimeout(r, typeof args === 'number' ? args : args.ms || 500));
      continue;
    }

    // 3. Execute primitive in the tab
    if (!primitives[action]) {
      throw new Error(`Unknown Fan Engine action: ${action}`);
    }

    const injectionResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: primitives[action],
      args: [resolvedArgs],
      world: 'MAIN' // Primitives interact with the DOM
    });

    lastResult = injectionResults[0]?.result;
    if (lastResult && lastResult.error) {
      throw new Error(`Fan Engine Error [${action}]: ${lastResult.error}`);
    }
  }

  return lastResult;
}
