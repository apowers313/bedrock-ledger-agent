/*!
 * Ledger agent blocks management class.
 *
 * Copyright (c) 2017 Digital Bazaar, Inc. All rights reserved.
 */
const _ = require('lodash');
const async = require('async');
const bedrock = require('bedrock');
const brPermission = require('bedrock-permission');
const config = require('bedrock').config;
const database = require('bedrock-mongodb');
const BedrockError = bedrock.util.BedrockError;

// module permissions
const PERMISSIONS = bedrock.config.permission.permissions;

// module API
const api = {};
module.exports = api;

/**
 * The LedgerAgentBlocks class exposes the block management API.
 */
class LedgerAgentBlocks {
  constructor(ledgerAgent) {
    this.ledgerAgent = ledgerAgent;
  }

  /**
   * Gets a block from the ledger given a blockID and a set of options.
   *
   * actor - the actor performing the action.
   * blockId - the URI of the block to fetch.
   * options - a set of options used when retrieving the block.
   * callback(err) - the callback to call when finished.
   *   err - An Error if an error occurred, null otherwise.
   */
  get(actor, blockId, options, callback) {

  }
}

api.LedgerAgentBlocks = LedgerAgentBlocks;
