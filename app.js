require('./controllers/controller');
import {run} from './src/lib/app';
const {analyzeFolder} = require('./src/lib/static-analysis');

analyzeFolder(`${__dirname}/controllers`).then(() => {
  run();
});