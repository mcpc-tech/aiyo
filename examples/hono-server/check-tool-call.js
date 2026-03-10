const url = 'http://localhost:3000/v1/chat/completions';

async function post(payload) {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20000);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  return res.json();
}

(async () => {
  console.log('Start first request...');
  const firstPayload = {
    model: 'default',
    temperature: 0,
    max_tokens: 256,
    messages: [
      { role: 'system', content: 'You must call AgentOutput tool and return only tool call.' },
      { role: 'user', content: '点击增加 count' },
    ],
    tools: [
      {
        type: 'function',
        function: {
          name: 'AgentOutput',
          description: 'You MUST call this tool every step!',
          parameters: {
            type: 'object',
            properties: { action: { type: 'object' } },
            required: ['action'],
            additionalProperties: false,
          },
        },
      },
    ],
    tool_choice: { type: 'function', function: { name: 'AgentOutput' } },
  };

  const first = await post(firstPayload);
  const msg = first?.choices?.[0]?.message || {};
  const firstCall = msg?.tool_calls?.[0];
  const pass = !!(firstCall && firstCall.type === 'function' && firstCall.function?.name === 'AgentOutput');

  console.log('FIRST_CHECK=', pass ? 'PASS' : 'FAIL');
  console.log(
    JSON.stringify(
      {
        finish_reason: first?.choices?.[0]?.finish_reason,
        tool_calls: msg?.tool_calls,
        content: msg?.content,
      },
      null,
      2,
    ),
  );

  if (!pass) {
    console.log('Start why request...');
    const whyPayload = {
      model: 'default',
      temperature: 0,
      max_tokens: 256,
      messages: [
        { role: 'system', content: '你是排障助手。' },
        {
          role: 'user',
          content:
            '我调用 chat/completions 时已提供 tools 并强制 tool_choice=function(AgentOutput)，但返回不是预期 tool_calls。请给出最可能的3个原因，简短要点。',
        },
      ],
    };

    const why = await post(whyPayload);
    console.log('WHY_FROM_AI=');
    console.log(why?.choices?.[0]?.message?.content || JSON.stringify(why, null, 2));
  }
})().catch((e) => {
  console.error('REQUEST_ERROR', String(e));
  process.exit(1);
});
