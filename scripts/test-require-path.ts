try {
  const p = require('path');
  console.log('require("path") works:', typeof p.relative);
} catch (e) {
  console.log('require("path") failed:', (e as Error).message);
}

import { relative, isAbsolute } from 'path';
console.log('import works:', typeof relative);
