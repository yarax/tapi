require('./controller');
import {run} from './src/lib/app';
const {analyzeFile} = require('./src/lib/static-analysis');

analyzeFile(`${__dirname}/controller.js`).then(() => {
  run();
});