const babel  = require('babel-core');
const {handleFile} = require('../static-analysis');
const fs = require('fs');

describe('API plugin', () => {
  it('Extractors', (done) => {
    const fn = `${__dirname}/../controller.js`;
    handleFile(fn);
    setTimeout(done, 1900);
  });
});