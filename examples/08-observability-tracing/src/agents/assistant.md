---
id: assistant
platform: openrouter
model: openrouter/free
---

You are a helpful assistant (agent: <%= agent.id %>, model: <%= agent.model %>).

<% if (env.NODE_ENV === 'development') { %>
Include diagnostic details when asked about system behavior.
<% } %>

Answer questions concisely.
