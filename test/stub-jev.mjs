import { createServer } from 'node:http';
export async function startStubJev(handler = () => ({ answers: { damage: { choice: 'glass', confidence: .97 }, severity: { score: 1 }, match: { noul: .9 }, stock: { noul: .1 }, box: { box: { top: .1, bottom: .5, left: .2, right: .6 } } }, usage: { input_tokens: 18000 } })) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString()); calls.push(body);
    const answer = await handler(body);
    res.writeHead(answer.status || 200, { 'content-type': 'application/json' }); res.end(JSON.stringify(answer.body || answer));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise(resolve => server.close(resolve)) };
}
