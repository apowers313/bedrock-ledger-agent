/*!
 * Copyright (c) 2017-2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const async = require('async');
const bedrock = require('bedrock');
const brLedgerAgent = require('bedrock-ledger-agent');
const brLedgerNode = require('bedrock-ledger-node');
const cache = require('bedrock-redis');
const config = bedrock.config;
const helpers = require('./helpers');
const jsigs = require('jsonld-signatures');
const mockData = require('./mock.data');
let request = require('request');
request = request.defaults({json: true, strictSSL: false});
const url = require('url');
const uuid = require('uuid/v4');
const querystring = require('querystring');

// use local JSON-LD processor for signatures
jsigs.use('jsonld', bedrock.jsonld);

const urlObj = {
  protocol: 'https',
  host: config.server.host,
  pathname: config['ledger-agent'].routes.agents
};

describe('Integration - 4 Nodes - Continuity - One Signature', () => {
  const regularActor = mockData.identities.regularUser;
  const nodes = 4;
  let ledgerAgent;
  let consensusApi;
  let genesisLedgerNode;
  const peers = [];

  before(done => async.series([
    callback => cache.client.flushall(callback),
    callback => helpers.prepareDatabase(mockData, callback)
  ], done));
  before(function(done) {
    this.timeout(60000);
    async.auto({
      consensusApi: callback =>
        helpers.use('Continuity2017', (err, result) => {
          consensusApi = result.api;
          callback(err);
        }),
      sign: callback => {
        jsigs.sign(mockData.ledgerConfigurations.continuity, {
          algorithm: 'RsaSignature2018',
          privateKeyPem: regularActor.keys.privateKey.privateKeyPem,
          creator: regularActor.keys.publicKey.id
        }, callback);
      },
      add: ['sign', (results, callback) => {
        request.post(helpers.createHttpSignatureRequest({
          url: url.format(urlObj),
          body: {ledgerConfiguration: results.sign},
          identity: regularActor
        }), (err, res) => {
          assertNoError(err);
          res.statusCode.should.equal(201);
          callback(null, res.headers.location);
        });
      }],
      get: ['add', (results, callback) => {
        request.get(helpers.createHttpSignatureRequest({
          url: results.add,
          identity: regularActor
        }), (err, res) => {
          assertNoError(err);
          res.statusCode.should.equal(200);
          ledgerAgent = res.body;
          callback();
        });
      }],
      ledgerNode: ['add', (results, callback) => {
        const agentId = 'urn:uuid:' +
          results.add.substring(results.add.lastIndexOf('/') + 1);
        brLedgerAgent.get(null, agentId, (err, result) => {
          genesisLedgerNode = result.node;
          peers.push(genesisLedgerNode);
          callback();
        });
      }],
      genesisRecord: ['get', (results, callback) => {
        const ledgerBlockService = ledgerAgent.service.ledgerBlockService;
        request.get(helpers.createHttpSignatureRequest({
          url: ledgerBlockService,
          identity: regularActor
        }), (err, res) => {
          assertNoError(err);
          res.statusCode.should.equal(200);
          callback(err, res.body.genesis);
        });
      }],
      addPeers: ['genesisRecord', (results, callback) => {
        // add N - 1 more private nodes
        async.times(nodes - 1, (i, callback) => {
          brLedgerNode.add(null, {
            genesisBlock: results.genesisRecord.block,
            owner: regularActor.identity.id
          }, (err, ledgerNode) => {
            peers.push(ledgerNode);
            callback();
          });
        }, callback);
      }]
    }, err => done(err));
  });

  beforeEach(done => {
    helpers.removeCollection('ledger_testLedger', done);
  });

  /* NOTE: in this test, operations are added to the ledger via a ledger agent
     associated with the genesis ledger node. Since operations are not being
     added on the additional nodes, the Continuity consensus algorithm will
     not expand the elector population beyond the genesis node. Under these
     conditions, all nodes will compute consensus based on a single elector.
     This test demonstrates that operations added on the genesis node are
     properly gossiped to all nodes and all nodes generate the same blocks.
  */
  it('should add 3 events and blocks', function(done) {
    this.timeout(120000);
    async.timesSeries(3, (n, callback) => {
      async.auto({
        sign: callback => {
          const createConcertRecordOp =
            bedrock.util.clone(mockData.ops.createConcertRecord);
          createConcertRecordOp.record.id =
            'https://example.com/events/' + uuid();
          jsigs.sign(createConcertRecordOp, {
            algorithm: 'RsaSignature2018',
            privateKeyPem: regularActor.keys.privateKey.privateKeyPem,
            creator: regularActor.keys.publicKey.id
          }, callback);
        },
        add: ['sign', (results, callback) => request.post({
          url: ledgerAgent.service.ledgerOperationService,
          body: results.sign,
          identity: regularActor
        }, (err, res) => {
          assertNoError(err);
          res.statusCode.should.equal(204);
          callback();
        })],
        // run two worker cycles per node to propagate events and find consensus
        runWorkers: ['add', (results, callback) => async.timesSeries(
          2, (n, callback) => async.eachSeries(peers, (ledgerNode, callback) =>
            consensusApi._worker._run(ledgerNode, callback), callback)
          , callback)],
        checkBlock: ['runWorkers', (results, callback) => {
          request.get(helpers.createHttpSignatureRequest({
            url: ledgerAgent.service.ledgerBlockService,
            identity: regularActor
          }), (err, res) => {
            assertNoError(err);
            res.statusCode.should.equal(200);
            const {blockHeight: latestBlockHeight} = res.body.latest.block;
            latestBlockHeight.should.equal(n + 1);
            callback();
          });
        }]
      }, callback);
    }, err => {
      if(err) {
        return done(err);
      }
      // check to ensure that all nodes have generated the same blocks
      async.map(peers, (ledgerNode, callback) =>
        ledgerNode.storage.blocks.getLatestSummary(callback),
      (err, results) => {
        if(err) {
          return done(err);
        }
        results.forEach(r => r.eventBlock.block.should.eql(
          results[0].eventBlock.block));
        done();
      });
    });
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
          assertNoError(err);
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
            assertNoError(err);
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
