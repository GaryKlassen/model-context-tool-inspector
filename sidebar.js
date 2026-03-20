/**
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI } from './js-genai.js';
import { initGeminiLive, MODEL } from './gemini-live.js';
import { executeFanSequence } from './fan-engine.js';

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
const loadFanSpecBtn = document.getElementById('loadFanSpecBtn');
const addFanSpecGitHubBtn = document.getElementById('addFanSpecGitHubBtn');
const browseFanSpecsBtn = document.getElementById('browseFanSpecsBtn');
const fanSpecInput = document.getElementById('fanSpecInput');
const fanSpecRegistryList = document.getElementById('fanSpecRegistryList');
const communitySpecsList = document.getElementById('communitySpecsList');
const communitySpecsHeader = document.getElementById('communitySpecsHeader');

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

let currentTools = [];
let userPromptPendingId = 0;
let lastSuggestedUserPrompt = '';

let toolsUpdateResolver;

loadFanSpecBtn.onclick = () => fanSpecInput.click();

addFanSpecGitHubBtn.onclick = async () => {
  const url = prompt('Enter GitHub Repo URL (e.g. https://github.com/user/repo) or Spec URL');
  if (!url) return;
  await addFanSpecFromGitHub(url);
};

async function addFanSpecFromGitHub(url, nameFromRegistry = null) {
  logPrompt(`🌐 Fetching Fan Spec from GitHub: ${url}...`);

  try {
    let baseUrl = url.replace('github.com', 'raw.githubusercontent.com').replace('/tree/', '/');
    if (!baseUrl.endsWith('/')) baseUrl += '/';

    const mcpResponse = await fetch(baseUrl + 'mcp.json');
    if (!mcpResponse.ok) throw new Error(`Could not find mcp.json at ${baseUrl}`);
    const spec = await mcpResponse.json();

    const adapterResponse = await fetch(baseUrl + 'adapter.js');
    if (!adapterResponse.ok) throw new Error(`Could not find adapter.js at ${baseUrl}`);
    const adapterCode = await adapterResponse.text();

    spec.adapterCode = adapterCode;
    spec.sourceUrl = url;

    const stored = await chrome.storage.local.get('fanSpecs');
    const specs = stored.fanSpecs || {};
    specs[spec.name] = spec;
    await chrome.storage.local.set({ fanSpecs: specs });

    logPrompt(`✅ Successfully Added Fan Spec: "${spec.name}" from GitHub.`);
    
    renderFanSpecList();
    
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'LIST_TOOLS' });

  } catch (error) {
    logPrompt(`❌ GitHub Load Error: ${error.message}`);
  }
}

browseFanSpecsBtn.onclick = async () => {
  logPrompt('🔍 Searching GitHub for community Fan Specs...');
  communitySpecsHeader.classList.remove('collapsed');
  communitySpecsHeader.nextElementSibling.classList.remove('is-hidden');
  communitySpecsList.innerHTML = '<div style="font-size: 11px; color: #6b7280; text-align: center; padding: 20px;">Searching GitHub repositories...</div>';

  try {
    // Search for repos with topic:webmcp-fan-spec
    const searchUrl = 'https://api.github.com/search/repositories?q=topic:webmcp-fan-spec';
    const response = await fetch(searchUrl);
    if (!response.ok) throw new Error('Failed to search GitHub.');
    const data = await response.json();

    if (data.items.length === 0) {
      communitySpecsList.innerHTML = '<div style="font-size: 11px; color: #6b7280; text-align: center; padding: 20px;">No community repositories found.</div>';
      return;
    }

    communitySpecsList.innerHTML = '';
    
    for (const repo of data.items) {
      // Fetch registry.json from repo
      const rawBase = repo.html_url.replace('github.com', 'raw.githubusercontent.com') + '/' + repo.default_branch + '/';
      try {
        const regRes = await fetch(rawBase + 'registry.json');
        if (!regRes.ok) continue;
        const registry = await regRes.json();

        registry.specs.forEach(spec => {
          const item = document.createElement('div');
          item.className = 'registry-item';
          item.innerHTML = `
            <div class="registry-item-header">
              <span class="registry-item-name">${spec.name}</span>
              <span class="registry-item-meta">Repo: ${repo.full_name}</span>
            </div>
            <div class="registry-item-meta">${spec.description || 'No description provided.'}</div>
            <div class="registry-item-actions">
              <span class="add-community-btn" data-url="${repo.html_url}/tree/${repo.default_branch}/${spec.path}">➕ Add to My Tools</span>
              <a href="${repo.html_url}" target="_blank">⭐ View Repo</a>
            </div>
          `;
          
          item.querySelector('.add-community-btn').onclick = (e) => {
            addFanSpecFromGitHub(e.target.dataset.url);
          };
          
          communitySpecsList.appendChild(item);
        });
      } catch (e) {
        console.error(`Failed to load registry for ${repo.full_name}`, e);
      }
    }

    if (communitySpecsList.innerHTML === '') {
       communitySpecsList.innerHTML = '<div style="font-size: 11px; color: #6b7280; text-align: center; padding: 20px;">Found repos, but no registry.json manifests found.</div>';
    }

  } catch (error) {
    logPrompt(`❌ Discovery Error: ${error.message}`);
    communitySpecsList.innerHTML = `<div style="font-size: 11px; color: #ef4444; text-align: center; padding: 20px;">Error: ${error.message}</div>`;
  }
};

fanSpecInput.onchange = async (event) => {
  const files = Array.from(event.target.files);
  if (files.length === 0) return;

  try {
    for (const file of files) {
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const spec = JSON.parse(text);

        if (!spec.name || !spec.matches || !spec.tools) {
          throw new Error('Invalid Fan Spec: Missing metadata (name, matches, tools).');
        }

        spec.sourceUrl = file.name === 'mcp.json' ? 'Local File' : file.name;

        const stored = await chrome.storage.local.get('fanSpecs');
        const specs = stored.fanSpecs || {};
        specs[spec.name] = spec;
        await chrome.storage.local.set({ fanSpecs: specs });

        logPrompt(`✅ Added Fan Spec: "${spec.name}" (${spec.tools.length} tools)`);
      }
    }
    
    renderFanSpecList();

    // Refresh tools for the current page
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.tabs.sendMessage(tab.id, { action: 'LIST_TOOLS' });

  } catch (error) {
    logPrompt(`❌ Error adding Fan Spec: ${error.message}`);
  } finally {
    fanSpecInput.value = '';
  }
};

async function renderFanSpecList() {
  const stored = await chrome.storage.local.get('fanSpecs');
  const fanSpecs = stored.fanSpecs || {};
  
  fanSpecRegistryList.innerHTML = '';
  
  const specNames = Object.keys(fanSpecs);
  if (specNames.length === 0) {
    fanSpecRegistryList.innerHTML = '<div style="font-size: 11px; color: #6b7280; text-align: center; padding: 20px;">No Fan Specs added yet.</div>';
    return;
  }

  specNames.forEach(name => {
    const spec = fanSpecs[name];
    const item = document.createElement('div');
    item.className = 'registry-item';
    
    const isGitHub = spec.sourceUrl?.includes('github.com');
    const repoUrl = isGitHub ? spec.sourceUrl.split('/tree/')[0] : null;

    item.innerHTML = `
      <div class="registry-item-header">
        <span class="registry-item-name">${spec.name}</span>
        <span class="registry-item-meta">${spec.tools.length} tools</span>
      </div>
      <div class="registry-item-meta">Matches: ${spec.matches.join(', ')}</div>
      <div class="registry-item-meta">Source: ${spec.sourceUrl}</div>
      <div class="registry-item-actions">
        ${isGitHub ? `<a href="${repoUrl}" target="_blank">⭐ GitHub Repo</a>` : ''}
        ${isGitHub ? `<a href="${repoUrl}/issues" target="_blank">🐛 Report Bug</a>` : ''}
        <span class="remove-btn" data-name="${spec.name}">❌ Remove</span>
      </div>
    `;
    
    item.querySelector('.remove-btn').onclick = async () => {
      if (confirm(`Remove Fan Spec "${spec.name}"?`)) {
        const current = await chrome.storage.local.get('fanSpecs');
        const specs = current.fanSpecs || {};
        delete specs[spec.name];
        await chrome.storage.local.set({ fanSpecs: specs });
        renderFanSpecList();
        
        // Refresh tools
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab) {
          await chrome.tabs.sendMessage(tab.id, { action: 'LIST_TOOLS' }).catch(() => {});
        }
      }
    };

    fanSpecRegistryList.appendChild(item);
  });
}

// Initial render
renderFanSpecList();

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

  // --- Fan Spec Logic: Virtual Mounting ---
  const stored = await chrome.storage.local.get('fanSpecs');
  const fanSpecs = stored.fanSpecs || {};
  const matchingFanTools = [];
  const tabUrl = url || tab?.url || '';

  if (tabUrl) {
    for (const specName in fanSpecs) {
      const spec = fanSpecs[specName];
      const isMatch = spec.matches.some((pattern) => {
        // Convert glob pattern to Regex more robustly
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp('^' + escaped.replace(/\\\*/g, '.*').replace(/\\\?/g, '.') + '$');
        return regex.test(tabUrl);
      });

      if (isMatch) {
        logPrompt(`ℹ️ Adding Fan Spec: "${spec.name}" tools to list for this page.`);
        spec.tools.forEach((tool) => {
          matchingFanTools.push({
            ...tool,
            isFanTool: true,
            specName: spec.name,
            // Convert inputSchema to string to match WebMCP tool structure
            inputSchema: typeof tool.inputSchema === 'string' ? tool.inputSchema : JSON.stringify(tool.inputSchema),
          });
        });
      }
    }
  }

  const allTools = [...(tools || []), ...matchingFanTools];
  // --- End Fan Spec Logic ---

  if (tools || matchingFanTools.length > 0) {
    tbody.innerHTML = '';
    thead.innerHTML = '';
    toolNames.innerHTML = '';

    const haveNewTools = JSON.stringify(currentTools) !== JSON.stringify(allTools);
    currentTools = allTools;

    if (toolsUpdateResolver) {
      toolsUpdateResolver();
      toolsUpdateResolver = null;
    }

    if (allTools.length === 0) {
      const row = document.createElement('tr');
      row.innerHTML = `<td colspan="100%"><i>No tools registered yet in ${tabUrl || 'this tab'}</i></td>`;
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

    // Use keys from the first tool that actually has them
    const representativeTool = allTools[0];
    const keys = Object.keys(representativeTool).filter(k => k !== 'isFanTool' && k !== 'specName');
    
    keys.forEach((key) => {
      const th = document.createElement('th');
      th.textContent = key;
      thead.appendChild(th);
    });

    allTools.forEach((item) => {
      const row = document.createElement('tr');
      if (item.isFanTool) row.classList.add('fan-tool-row'); // Use CSS for tinting
      
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
      option.textContent = (item.isFanTool ? '⭐ ' : '') + `"${item.name}"`;
      option.value = item.name;
      option.dataset.inputSchema = item.inputSchema;
      toolNames.appendChild(option);
    });
    updateDefaultValueForInputArgs();

    if (haveNewTools) suggestUserPrompt();
  } else if (tools === null || (Array.isArray(tools) && tools.length === 0)) {
     // Handle case where content script returns no tools but we might have fan tools
     // This is handled by the initial check for tabUrl and matchingFanTools.length
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

const envModulePromise = import('./.env.json', { with: { type: 'json' } });

async function initGenAI() {
  let env;
  try {
    // Try load .env.json if present.
    env = (await envModulePromise).default;
  } catch {}
  if (env?.apiKey) localStorage.apiKey ??= env.apiKey;
  
  if (!localStorage.model || localStorage.model.includes('gemini-2.5') || localStorage.model.includes('gemini-2.0') || localStorage.model === MODEL) {
    localStorage.model = TEXT_MODEL;
  }

  if (localStorage.apiKey) {
    // Default to v1beta for chat stability. Gemini Live will explicitly use v1alpha when connecting.
    genAI = new GoogleGenAI({ apiKey: localStorage.apiKey, httpOptions: { apiVersion: 'v1beta' } });
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
  if (currentTools.length == 0 || !genAI || userPromptText.value !== lastSuggestedUserPrompt)
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
  userPromptText.value = lastSuggestedUserPrompt;
}

userPromptText.onkeydown = (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
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

  chat ??= genAI.chats.create({ model: localStorage.model });

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
      // Execute tool calls sequentially to handle potential dependencies.
      if (response.text) {
        logPrompt(`AI result: ${response.text.trim()}`);
      }

      const toolResponses = [];
      for (const { name, args } of functionCalls) {
        const inputArgs = JSON.stringify(args);
        logPrompt(`AI calling tool "${name}" with ${inputArgs}`);
        try {
          const result = await executeTool(tab.id, name, inputArgs);
          logPrompt(`Tool "${name}" result: ${result}`);
          toolResponses.push({ functionResponse: { name, response: { result } } });
        } catch (e) {
          logPrompt(`⚠️ Error executing tool "${name}": ${e.message}`);
          toolResponses.push({ functionResponse: { name, response: { error: e.message } } });
        }
      }

      // If a navigation occurred, wait for the page to load and tools to be registered.
      const [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (currentTab.status === 'loading') {
        await Promise.race([
          new Promise(resolve => { toolsUpdateResolver = resolve; }),
          waitForPageLoad(currentTab.id),
          new Promise(resolve => setTimeout(resolve, 2000))
        ]);
        toolsUpdateResolver = null;
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

  // Check if this is a Fan Tool
  const toolDef = currentTools?.find(t => t.name === name);
  if (toolDef?.isFanTool) {
    return await handleFanToolExecution(tabId, toolDef, inputArgs);
  }

  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      action: 'EXECUTE_TOOL',
      name,
      inputArgs,
    });
    return result;
  } catch (error) {
    return Promise.reject(error.message);
  }
}

async function handleFanToolExecution(tabId, toolDef, inputArgs) {
  const { specName, name: toolName } = toolDef;
  const stored = await chrome.storage.local.get('fanSpecs');
  const spec = stored.fanSpecs?.[specName];
  const toolSpec = spec?.tools.find(t => t.name === toolName);

  if (!toolSpec || !toolSpec.sequence) {
    throw new Error(`Execution sequence not found for tool "${toolName}" in Spec "${specName}"`);
  }

  logPrompt(`⚙️ Executing Fan Tool "${toolName}" via sequence engine...`);
  return await executeFanSequence(tabId, toolSpec.sequence, JSON.parse(inputArgs));
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
  getFormattedDate,
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

  const functionDeclarations = currentTools.map((tool) => {
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

  if (schema.hasOwnProperty('default')) {
    return schema.default;
  }

  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

  switch (schema.type) {
    case 'object':
      const obj = {};
      if (schema.properties) {
        for (const key in schema.properties) {
          obj[key] = generateTemplateFromSchema(schema.properties[key]);
        }
      }
      return obj;

    case 'array':
      const arr = [];
      if (schema.items) {
        arr.push(generateTemplateFromSchema(schema.items));
      }
      return arr;

    case 'string':
      if (schema.format === 'date-time') {
        return new Date().toISOString();
      }
      if (schema.format === 'date') {
        return new Date().toISOString().split('T')[0];
      }
      if (schema.format === 'time') {
        return new Date().toISOString().split('T')[1].split('.')[0];
      }
      if (schema.format === 'uri') {
        return 'https://example.com';
      }
      if (schema.format === 'phone') {
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
