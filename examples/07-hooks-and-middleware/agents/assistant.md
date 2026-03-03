---
id: assistant
platform: openrouter
model: openrouter/free
vars:
  verbose: true
---

You are a helpful assistant. Keep answers short and practical.

<% if (vars.verbose) { %>
When answering questions, provide detailed explanations with examples.
<% } else { %>
Keep responses brief and to the point.
<% } %>

<%~ include("@safety-rules") %>
