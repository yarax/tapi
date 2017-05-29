const babel  = require('babel-core');
const {handleFile} = require('../static-analysis');
const fs = require('fs');

describe('API plugin', () => {
  it('Extractors', function(done) {
    this.timeout(0);
    const fn = `${__dirname}/../controller.js`;
    handleFile(fn).then((type) => {
      console.log('RESULT:', require('util').inspect(type, {depth: null}));
      done();
    }).catch(done);
  });
});