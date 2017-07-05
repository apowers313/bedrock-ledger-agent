/*
 * Copyright (c) 2017 Digital Bazaar, Inc. All rights reserved.
 */
/* globals should */
'use strict';

const _ = require('lodash');
const async = require('async');
const bedrock = require('bedrock');
const brLedger = require('bedrock-ledger');
const brLedgerAgent = require('bedrock-ledger-agent');
const config = bedrock.config;
const helpers = require('./helpers');
const mockData = require('./mock.data');
let request = require('request');
request = request.defaults({json: true, strictSSL: false});
// require('request-debug')(request);
const url = require('url');
const uuid = require('uuid/v4');
const querystring = require('querystring');

const urlObj = {
  protocol: 'https',
  host: config.server.host,
  pathname: config['ledger-agent'].routes.agents
};

describe.skip('Integration - 1 Node - Unilateral - Multi-Signature', () => {
  const regularActor = mockData.identities.regularUser;
  const configEvent = mockData.events.config;
  let ledgerAgent;

  before(done => helpers.prepareDatabase(mockData, done));
  before(done => {
    async.auto({
      add: callback => {
        request.post(helpers.createHttpSignatureRequest({
          url: url.format(urlObj),
          body: mockData.events.config,
          identity: regularActor
        }), (err, res) => {
          should.not.exist(err);
          res.statusCode.should.equal(201);
          callback(null, res.headers.location);
        });
      },
      get: ['add', (results, callback) => {
        request.get(helpers.createHttpSignatureRequest({
          url: results.add,
          identity: regularActor
        }), (err, res) => {
          should.not.exist(err);
          res.statusCode.should.equal(200);
          ledgerAgent = res.body;
          callback();
        });
      }]
    }, err => done(err));
  });
  beforeEach(done => {
    helpers.removeCollection('ledger_testLedger', done);
  });
  it('should add 10 events and blocks', done => {
    async.times(10, (n, callback) => {
      const concertEvent = _.cloneDeep(mockData.events.concert);
      concertEvent.input[0].id = 'https://example.com/events/' + uuid(),
      request.post(helpers.createHttpSignatureRequest({
        url: ledgerAgent.service.ledgerEventService,
        body: concertEvent,
        identity: regularActor
      }), (err, res) => {
        should.not.exist(err);
        res.statusCode.should.equal(201);
        callback(null, res.headers.location);
      });
    }, err => done(err));
  });
  it('should crawl to genesis block from latest block', done => {
    const maxAttempts = 20;
    let attempts = 0;
    let currentBlock;

    async.auto({
      getLatestBlock: callback => {
        request.get(helpers.createHttpSignatureRequest({
          url: ledgerAgent.service.ledgerBlockService,
          identity: regularActor
        }), (err, res) => {
          should.not.exist(err);
          res.statusCode.should.equal(200);
          currentBlock = res.body.latest.block.id;
          callback(null, res.body);
        });
      },
      crawlToGenesis: ['getLatestBlock', (results, callback) => {
        let done = false;
        async.until(() => done, callback => {
          const blockUrl = ledgerAgent.service.ledgerBlockService + '?' +
            querystring.stringify({id: currentBlock});

          request.get(helpers.createHttpSignatureRequest({
            url: blockUrl,
            identity: regularActor
          }), (err, res) => {
            should.not.exist(err);
            res.statusCode.should.equal(200);
            if(!res.body.block.previousBlock || attempts > maxAttempts) {
              done = true;
              return callback(null, res.body);
            }
            currentBlock = res.body.block.previousBlock;
            attempts++;
            callback(null, currentBlock);
          });
        }, (err, finalBlock) => {
          if(err) {
            return callback(err);
          }
          should.exist(finalBlock);
          should.exist(finalBlock.block);
          should.not.exist(finalBlock.block.previousBlock);
          should.not.exist(finalBlock.block.previousBlockHash);
          callback();
        });
      }]
    }, err => done(err));
  });
});