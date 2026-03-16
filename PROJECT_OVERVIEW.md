# WebMCP Fan Specs: Community-Powered AI Browsing

## The Vision
WebMCP (Model Context Protocol for the Web) allows websites to natively expose tools to AI models. While powerful, the "native" adoption of such protocols takes time. **WebMCP Fan Specs** bridge this gap by providing a developer-friendly framework to build, test, and share site-specific tool adapters. 

The goal is to **accelerate the development and adoption of WebMCP** by enabling a community of developers to implement tools for any website, proving the value of the protocol and creating a more capable, AI-integrated web today.

## The Problem
1. **Slow Native Adoption:** Most sites (GitHub, Jira, AWS) don't yet expose MCP tools natively.
2. **"Niche" Needs:** Many users want highly specific automation tools tailored to their unique workflows or interests. Major platforms are unlikely to implement these natively because they don't apply to their entire user base.
3. **Complexity of Discovery:** Even when tools exist, finding and enabling them for the right site at the right time can be difficult.

## The Concept: "Decoupled Adapters"
A **Fan Spec** is a small package consisting of:
- **Metadata (`mcp.json`):** Tells the AI what tools are available and what URLs they work on.
- **Logic (`adapter.js`):** JavaScript that interacts with the site's DOM (clicking, reading, scanning).

These specs live in decentralized GitHub repositories, allowing developers to collaborate and iterate quickly.

## High-Level Architecture
The system uses a **Bridge Pattern** to maintain safety and velocity:

1. **Discovery:** The extension queries the GitHub Search API for repositories tagged with `#webmcp-fan-spec`.
2. **Registry:** It parses a `registry.json` manifest at the root of those repos to find specific site adapters.
3. **Activation:** When a user visits a matching URL, the extension "activates" the tools.
4. **Isolated Execution:** When the AI calls a tool, the logic is executed in a **Chrome Isolated World**.

### URL Matching & Dynamic Lifecycle
Activation is handled via a flexible matching engine:
- **Glob Patterns:** Specs use familiar wildcards (e.g., `https://github.com/*/pull/*`) to define their scope.
- **Automatic Context Switching:** The toolset in the AI's "brain" updates instantly as you navigate, ensuring only relevant tools are available.

## Status and Intent
**WebMCP Fan Specs is currently a developer and hobbyist project.** While the architecture includes technical mitigations to protect user data, it is not a "managed" platform. Users are encouraged to review the source code of any Fan Spec before adding it to their environment.

## Key Benefits

### 🌍 Browser & Runtime Agnostic
Because the specs are defined as standard JSON and vanilla JavaScript, they are not tied to a specific extension. They can be consumed by any modern browser extension or AI-native runtime.

### 👥 Built-in Community Signals
By leveraging GitHub as the distribution platform, we inherit a mature ecosystem for quality control:
- **Instant Sharing:** Developers can push a new spec and have it discoverable globally in seconds.
- **Direct Feedback:** Users can report bugs or suggest new tools directly via GitHub Issues.
- **Quality Signals:** GitHub Stars serve as a powerful decentralized signal to help users identify the most robust and trusted adapters.

### ⚡ Instant Velocity
Community members can fix a broken CSS selector in a Fan Spec and have it available to all users instantly, bypassing the days-long delay of Extension Store reviews.

### 🛡️ Technical Isolation (Chrome Isolated Worlds)
To mitigate risks, Fan Specs are executed within a **Chrome Isolated World**. 
- **What this means:** The community script can interact with the page DOM (to read content or click buttons) but it **cannot** access the extension's private state, your Gemini API keys, or the extension's local storage.
- **Note:** This is a technical sandbox, not a guarantee of absolute safety. Users should only add specs from sources they trust.

### 🏗️ Decentralized
No central server or gatekeeper is required. GitHub acts as the package registry via Topics and manifest files.


## Resources
- **Extension Source:** [Link to Model Context Tool Inspector Repo]
- **Implementation PR:** [Link to Pull Request]
- **Community Spec Registry:** [Link to webmcp-fan-specs Repo]

---
*Generated March 15, 2026*
