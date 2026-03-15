/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from './js-genai.js';
import { initGeminiLive, MODEL } from './gemini-live.js';

const TEXT_MODEL = 'gemini-3.1-flash-lite-preview';

if (!localStorage.model || localStorage.model.includes('gemini-2.5') || localStorage.model.includes('gemini-2.0')) {
  localStorage.model = TEXT_MODEL;
}

const statusDiv = document.getElementById('status');
const tbody = document.getElementById('tableBody');
const thead = document.getElementById('tableHeaderRow');
const copyToClipboard = document.getElementById('copyToClipboard');
const copyAsScriptToolConfig = document.getElementById('copyAsScriptToolConfig');
const copyAsJSON = document.getElementById('copyAsJSON');
const toolNames = document.getElementById('toolNames');
const inputArgsText = document.getElementById('inputArgsText');
const executeBtn = document.getElementById('executeBtn');
const toolResults = document.getElementById('toolResults');
const userPromptText = document.getElementById('userPromptText');
const promptBtn = document.getElementById('promptBtn');
const traceBtn = document.getElementById('traceBtn');
const resetBtn = document.getElementById('resetBtn');
const apiKeyBtn = document.getElementById('apiKeyBtn');
const promptResults = document.getElementById('promptResults');
const micBtn = document.getElementById('micBtn');
const enableScriptTool = document.getElementById('enableScriptTool');

if (!micBtn) console.error('Could not find micBtn in DOM');
if (!enableScriptTool) console.error('Could not find enableScriptTool in DOM');

// Inject content script first.
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && (tab.url.startsWith('http') || tab.url.startsWith('file'))) {
      let attempts = 0;
      const send = async () => {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'LIST_TOOLS' });
        } catch (e) {
          if (attempts++ < 5) setTimeout(send, 200 * attempts);
        }
      };
      send();
    } else {
      const statusDiv = document.getElementById('status');
      statusDiv.textContent = 'WebMCP tools are only available on web pages.';
      statusDiv.hidden = false;
      copyToClipboard.hidden = true;
    }
  } catch (error) {
    // Ignore initial connection errors
  }
})();

let currentTools;
let userPromptPendingId = 0;
let lastSuggestedUserPrompt = '';

// Listen for the results coming back from content.js
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.tools || msg.message) {
    handleToolMessage(msg, sender);
  }
});

async function handleToolMessage({ message, tools, url }, sender) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!sender.tab || sender.tab.id !== tab?.id) return;

  if (message !== undefined) {
    statusDiv.textContent = message || '';
    statusDiv.hidden = !message;
  }

  if (tools) {
    tbody.innerHTML = '';
    thead.innerHTML = '';
    toolNames.innerHTML = '';

    const haveNewTools = JSON.stringify(currentTools) !== JSON.stringify(tools);
    currentTools = tools;

    if (!tools || tools.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = `<td colspan="100%"><i>No tools registered yet in ${url || tab?.url || 'this tab'}</i></td>`;
      tbody.appendChild(row);
      inputArgsText.value = '';
      inputArgsText.disabled = true;
      toolNames.disabled = true;
      executeBtn.disabled = true;
      copyToClipboard.hidden = true;
      return;
    }

    inputArgsText.disabled = false;
    toolNames.disabled = false;
    executeBtn.disabled = false;
    copyToClipboard.hidden = false;

    const keys = Object.keys(tools[0]);
    keys.forEach((key) => {
      const th = document.createElement('th');
      th.textContent = key;
      thead.appendChild(th);
    });

    tools.forEach((item) => {
      const row = document.createElement('tr');
      keys.forEach((key) => {
        const td = document.createElement('td');
        try {
          td.innerHTML = `<pre>${JSON.stringify(JSON.parse(item[key]), '', '  ')}</pre>`;
        } catch (error) {
          td.textContent = item[key];
        }
        row.appendChild(td);
      });
      tbody.appendChild(row);

      const option = document.createElement('option');
      option.textContent = `"${item.name}"`;
      option.value = item.name;
      option.dataset.inputSchema = item.inputSchema;
      toolNames.appendChild(option);
    });
    updateDefaultValueForInputArgs();

    if (haveNewTools) suggestUserPrompt();
  }
}

tbody.ondblclick = () => {
  tbody.classList.toggle('prettify');
};

copyAsScriptToolConfig.onclick = async () => {
  const text = currentTools
    .map((tool) => {
      return `\
script_tools {
  name: "${tool.name}"
  description: "${tool.description}"
  input_schema: ${JSON.stringify(tool.inputSchema || { type: 'object', properties: {} })}
}`;
    })
    .join('\r\n');
  await navigator.clipboard.writeText(text);
};

copyAsJSON.onclick = async () => {
  const tools = currentTools.map((tool) => {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
        ? JSON.parse(tool.inputSchema)
        : { type: 'object', properties: {} },
    };
  });
  await navigator.clipboard.writeText(JSON.stringify(tools, '', '  '));
};

// Interact with the page

let genAI, chat;

const envModulePromise = import('./.env.json', { with: { type: 'json' } }).catch(() => ({ default: {} }));

async function initGenAI() {
  let env;
  try {
    const result = await envModulePromise;
    env = result.default || {};
  } catch {
    env = {};
  }
  if (env?.apiKey) localStorage.apiKey ??= env.apiKey;
  
  if (!localStorage.model || localStorage.model.includes('gemini-2.5')) {
    localStorage.model = TEXT_MODEL;
  }
  
  if (localStorage.apiKey) {
    genAI = new GoogleGenAI({ apiKey: localStorage.apiKey, httpOptions: { apiVersion: 'v1alpha' } });
  }
  
  enableScriptTool.checked = localStorage.enableScriptTool === 'true';
  promptBtn.disabled = !localStorage.apiKey;
  resetBtn.disabled = !localStorage.apiKey;
}
initGenAI();

enableScriptTool.onchange = () => {
  localStorage.enableScriptTool = enableScriptTool.checked;
  chat = undefined;
  suggestUserPrompt();
};

async function suggestUserPrompt() {
  if (!currentTools || currentTools.length == 0 || !genAI || userPromptText.value !== lastSuggestedUserPrompt)
    return;
  const userPromptId = ++userPromptPendingId;
  
  const response = await genAI.models.generateContent({
    model: localStorage.model,
    contents: [
      '**Context:**',
      `Today's date is: ${getFormattedDate()}`,
      '**Tool Rules:**',
      '1. **Bank Transaction Filter:** Use **PAST** dates only (e.g., "last month," "December 15th," "yesterday").',
      '2. **Flight Search:** Use **FUTURE** dates only (e.g., "next week," "February 15th").',
      '3. **Accommodation Search:** Use **FUTURE** dates only (e.g., "next weekend," "March 15th").',
      '**Task:**',
      'Generate one natural user query for a range of tools below, ideally chaining them together.',
      'Ensure the date makes sense relative to today.',
      'Output the query text only.',
      '**Tools:**',
      JSON.stringify(currentTools),
    ],
  });
  
  if (userPromptId !== userPromptPendingId || userPromptText.value !== lastSuggestedUserPrompt)
    return;
  lastSuggestedUserPrompt = response.text;
  userPromptText.value = '';
  for (const chunk of response.text) {
    await new Promise((r) => requestAnimationFrame(r));
    userPromptText.value += chunk;
  }
}

userPromptText.onkeydown = (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    promptBtn.click();
  }
};

promptBtn.onclick = async () => {
  try {
    await promptAI();
  } catch (error) {
    trace.push({ error });
    logPrompt(`⚠️ Error: "${error}"`);
  }
};

let trace = [];

async function promptAI() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chat ??= genAI.chats.create({ 
    model: localStorage.model,
    toolConfig: { functionCallingConfig: { mode: 'ANY' } }
  });
  const message = userPromptText.value;
  userPromptText.value = '';
  lastSuggestedUserPrompt = '';
  logPrompt(`User prompt: "${message}"`);
  
  const sendMessageParams = { message, config: getConfig() };
  trace.push({ userPrompt: sendMessageParams });
  let currentResult = await chat.sendMessage(sendMessageParams);
  let finalResponseGiven = false;

  while (!finalResponseGiven) {
    const response = currentResult;
    trace.push({ response });
    
    const functionCalls = response.functionCalls || [];

    if (functionCalls.length === 0) {
      if (response.text) {
        logPrompt(`AI result: ${response.text.trim()}`);
      } else {
        logPrompt(`⚠️ AI response has no text: ${JSON.stringify(response.candidates)}`);
      }
      finalResponseGiven = true;
    } else {
      // Prioritize tool calls over text logging
      const toolResponses = [];
      const promises = functionCalls.map(async ({ name, args }) => {
        const inputArgs = JSON.stringify(args);
        const toolPromise = executeTool(tab.id, name, inputArgs);
        logPrompt(`AI calling tool "${name}" with ${inputArgs}`);
        try {
          const result = await toolPromise;
          logPrompt(`Tool "${name}" result: ${result}`);
          return { functionResponse: { name, response: { result } } };
        } catch (e) {
          logPrompt(`⚠️ Error executing tool "${name}": ${e.message}`);
          return { functionResponse: { name, response: { error: e.message } } };
        }
      });

      if (response.text) {
        logPrompt(`AI result: ${response.text.trim()}`);
      }

      const results = await Promise.all(promises);
      toolResponses.push(...results);
      
      // FIXME: New WebMCP tools may not be discovered if there's a navigation.
      // We check if the tab is loading, but the artificial 500ms timeout is not robust enough.
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentTab.status === 'loading') {
        await new Promise((r) => setTimeout(r, 500));
      }

      const sendMessageParams = { message: toolResponses, config: getConfig() };
      trace.push({ userPrompt: sendMessageParams });
      currentResult = await chat.sendMessage(sendMessageParams);
    }
  }
}

resetBtn.onclick = () => {
  chat = undefined;
  trace = [];
  userPromptText.value = '';
  lastSuggestedUserPrompt = '';
  promptResults.textContent = '';
  suggestUserPrompt();
};

apiKeyBtn.onclick = async () => {
  const apiKey = prompt('Enter Gemini API key');
  if (apiKey == null) return;
  localStorage.apiKey = apiKey;
  await initGenAI();
  suggestUserPrompt();
};

traceBtn.onclick = async () => {
  const text = JSON.stringify(trace, '', ' ');
  await navigator.clipboard.writeText(text);
};

executeBtn.onclick = async () => {
  toolResults.textContent = '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const name = toolNames.selectedOptions[0].value;
  const inputArgs = inputArgsText.value;
  toolResults.textContent = await executeTool(tab.id, name, inputArgs).catch(
    (error) => `⚠️ Error: "${error}"`,
  );
};

async function executeTool(tabId, name, inputArgs) {
  if (name === 'write_script') {
    const { task } = JSON.parse(inputArgs);
    return await handleWriteScript(task);
  }
  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      action: 'EXECUTE_TOOL',
      name,
      inputArgs,
    });
    if (result !== null) return result;
  } catch (error) {
    if (!error.message.includes('message channel is closed')) throw error;
  }
  // A navigation was triggered. The result will be on the next document.
  // TODO: Handle case where a new tab is opened.
  await waitForPageLoad(tabId);
  return await chrome.tabs.sendMessage(tabId, {
    action: 'GET_CROSS_DOCUMENT_SCRIPT_TOOL_RESULT',
  });
}

async function handleWriteScript(task) {
  const thinkingModelName = 'gemini-3-flash-preview';
  const toolsDescription = (currentTools || []).map(t => `- ${t.name}: ${t.description}. Input schema: ${t.inputSchema}`).join('\n');
  
  const prompt = `
You are an expert JavaScript developer tasked with writing a robust automation script for the current page.
Goal: "${task}"

AVAILABLE TOOLS:
You have access to a global asynchronous function \`executeTool(name, args)\` which:
- Takes the tool name and an OBJECT of arguments.
- Automatically handles JSON stringification of inputs.
- Automatically handles JSON parsing of outputs (returns a plain JS object).

Tools List:
${toolsDescription}

GUIDELINES:
1.  **Algorithmic Approach**: Write an intelligent algorithm or loop to achieve the goal. Do NOT just execute steps one-by-one if the task requires state-based logic (e.g., "scan all items", "retry until ready", "find the target").
2.  **Safety**: Include safety limits on loops (e.g., a maximum of 50 iterations) to prevent the script from hanging the browser tab.
3.  **Async/Await**: The script runs as an asynchronous function body. Use \`await executeTool(...)\`.
4.  **Explicit Return**: Always end with an explicit \`return\` statement providing a final result string, object, or summary of actions taken.

CODE FORMAT:
Output ONLY the JavaScript code for the function body. No preamble, explanation, or IIFE wrapper. Just the code to be executed. Wrap in \`\`\`javascript block.

Example:
\`\`\`javascript
let found = false;
for (let i = 0; i < 20; i++) {
  const state = await executeTool('getState', {});
  if (state.isFinished) {
    found = true;
    break;
  }
  await executeTool('processStep', { step: i });
}
return found ? "Success" : "Failed after 20 attempts";
\`\`\`
`;

  logPrompt(`🚀 Starting Script Tool for task: "${task}"`);
  logPrompt(`🧠 Calling ${thinkingModelName} in Thinking Mode (this may take a minute)...`);

  try {
    const response = await genAI.models.generateContent({
      model: thinkingModelName,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingLevel: "high"
        }
      }
    });

    let script = response.text;
    
    // Extract script from markdown
    const match = script.match(/```javascript\n([\s\S]*?)\n```/) || script.match(/```\n([\s\S]*?)\n```/);
    if (match) {
      script = match[1];
    }
    
    logPrompt(`📝 ${thinkingModelName} generated a script (${script.length} chars).`);
    logPrompt(`⚙️ Executing script in page context...`);
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    const executionResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async (scriptSource) => {
        const executeTool = async (name, args) => {
          const res = await navigator.modelContextTesting.executeTool(name, JSON.stringify(args));
          try {
            return typeof res === 'string' ? JSON.parse(res) : res;
          } catch (e) {
            return res;
          }
        };
        // Use AsyncFunction to support top-level await in the provided scriptSource
        const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
        const fn = new AsyncFunction('executeTool', scriptSource);
        return await fn(executeTool);
      },
      args: [script],
      world: 'MAIN',
    });

    const finalResult = executionResults[0]?.result;
    logPrompt(`✅ Script execution complete.`);
    logPrompt(`🏁 Result: ${JSON.stringify(finalResult, null, 2)}`);
    return finalResult;

  } catch (error) {
    logPrompt(`❌ Script Tool Error: ${error.message}`);
    throw error;
  }
}

toolNames.onchange = updateDefaultValueForInputArgs;

function updateDefaultValueForInputArgs() {
  const inputSchema = toolNames.selectedOptions[0].dataset.inputSchema || '{}';
  const template = generateTemplateFromSchema(JSON.parse(inputSchema));
  inputArgsText.value = JSON.stringify(template, '', ' ');
}

// Initialize Gemini Live
initGeminiLive({
  micBtn,
  apiKeyBtn,
  getGenAI: () => genAI,
  getTools: () => currentTools,
  isScriptToolEnabled: () => enableScriptTool.checked,
  executeTool,
  logPrompt,
  getFormattedDate
});

// Utils

let logBuffer = [];
let logPending = false;

function logPrompt(text) {
  // Defer logging and batch updates to avoid blocking main thread logic.
  logBuffer.push(text);
  
  if (!logPending) {
    logPending = true;
    setTimeout(() => {
      requestAnimationFrame(() => {
        const fragment = document.createDocumentFragment();
        while (logBuffer.length > 0) {
          fragment.appendChild(document.createTextNode(`${logBuffer.shift()}\n`));
        }
        promptResults.appendChild(fragment);
        promptResults.scrollTop = promptResults.scrollHeight;
        logPending = false;
      });
    }, 0);
  }
}

function getFormattedDate() {
  const today = new Date();
  return today.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function getConfig() {
  const systemInstruction = [
    'You are an assistant embedded in a browser tab.',
    'User prompts typically refer to the current tab unless stated otherwise.',
    'Use your tools to query page content when you need it.',
    `Today's date is: ${getFormattedDate()}`,
    'CRITICAL RULE: Whenever the user provides a relative date (e.g., "next Monday", "tomorrow", "in 3 days"),  you must calculate the exact calendar date based on today\'s date.',
  ];

  const functionDeclarations = (currentTools || []).map((tool) => {
    return {
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: tool.inputSchema
        ? JSON.parse(tool.inputSchema)
        : { type: 'object', properties: {} },
    };
  });

  if (enableScriptTool.checked) {
    functionDeclarations.push({
      name: 'write_script',
      description:
        'Write a robust JavaScript automation script to solve complex tasks on the current page. ' +
        'This is the BEST tool for multi-step goals, state-based logic, or when you need to ' +
        '\'solve\', \'automate\', \'scan\', \'loop\', or \'retry until\' a condition is met. ' +
        'Use it to sequence multiple tool calls into an intelligent algorithm instead of ' +
        'calling tools one-by-one.',
      parametersJsonSchema: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description:
              'A detailed description of the automation task to perform, including the ' +
              'end goal and any specific conditions to check.',
          },
        },
        required: ['task'],
      },
    });
  }

  return { systemInstruction, tools: [{ functionDeclarations }] };
}

function generateTemplateFromSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return null;
  }

  if (schema.hasOwnProperty('const')) {
    return schema.const;
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return generateTemplateFromSchema(schema.oneOf[0]);
  }

  if (schema.hasOwnProperty('default')) {
    return schema.default;
  }

  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0];
  }

  switch (schema.type) {
    case 'object':
      const obj = {};
      if (schema.properties) {
        Object.keys(schema.properties).forEach((key) => {
          obj[key] = generateTemplateFromSchema(schema.properties[key]);
        });
      }
      return obj;

    case 'array':
      if (schema.items) {
        return [generateTemplateFromSchema(schema.items)];
      }
      return [];

    case 'string':
      if (schema.enum && schema.enum.length > 0) {
        return schema.enum[0];
      }
      if (schema.format === 'date') {
        return new Date().toISOString().substring(0, 10);
      }
      // yyyy-MM-ddThh:mm:ss.SSS
      if (
        schema.format ===
        '^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\\.[0-9]{1,3})?)?$'
      ) {
        return new Date().toISOString().substring(0, 23);
      }
      // yyyy-MM-ddThh:mm:ss
      if (
        schema.format ===
        '^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
      ) {
        return new Date().toISOString().substring(0, 19);
      }
      // yyyy-MM-ddThh:mm
      if (schema.format === '^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]$') {
        return new Date().toISOString().substring(0, 16);
      }
      // yyyy-MM
      if (schema.format === '^[0-9]{4}-(0[1-9]|1[0-2])$') {
        return new Date().toISOString().substring(0, 7);
      }
      // yyyy-Www
      if (schema.format === '^[0-9]{4}-W(0[1-9]|[1-4][0-9]|5[0-3])$') {
        return `${new Date().toISOString().substring(0, 4)}-W01`;
      }
      // HH:mm:ss.SSS
      if (schema.format === '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\\.[0-9]{1,3})?)?$') {
        return new Date().toISOString().substring(11, 23);
      }
      // HH:mm:ss
      if (schema.format === '^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$') {
        return new Date().toISOString().substring(11, 19);
      }
      // HH:mm
      if (schema.format === '^([01][0-9]|2[0-3]):[0-5][0-9]$') {
        return new Date().toISOString().substring(11, 16);
      }
      if (schema.format === '^#[0-9a-zA-Z]{6}$') {
        return '#ff00ff';
      }
      if (schema.format === 'tel') {
        return '123-456-7890';
      }
      if (schema.format === 'email') {
        return 'user@example.com';
      }
      return 'example_string';

    case 'number':
    case 'integer':
      if (schema.minimum !== undefined) return schema.minimum;
      return 0;

    case 'boolean':
      return false;

    case 'null':
      return null;

    default:
      return {};
  }
}

function waitForPageLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

document.querySelectorAll('.collapsible-header').forEach((header) => {
  header.addEventListener('click', () => {
    header.classList.toggle('collapsed');
    const content = header.nextElementSibling;
    if (content?.classList.contains('section-content')) {
      content.classList.toggle('is-hidden');
    }
  });
});
