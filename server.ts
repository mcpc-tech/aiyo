const express = require('express');
const app = express();
const port = 3000;

let count = 0;

app.get('/increment', (req, res) => {
  count += 1;
  res.json({ count });
});

app.get('/count', (req, res) => {
  res.json({ count });
});

app.listen(port, () => {
  console.log(`Counter server listening at http://localhost:${port}`);
});