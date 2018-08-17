/*!
 * Copyright (c) 2017-2018 Digital Bazaar, Inc. All rights reserved.
 */
'use strict';

const {config} = require('bedrock');
const brLedgerNode = require('bedrock-ledger-node');
const paramCase = require('param-case');
const routes = config['ledger-agent'].routes;

/**
 * Implements the creation and management of
 * [Web Ledger Agents]{@link https://w3c.github.io/web-ledger/}
 * @memberOf module:bedrock-ledger-agent
 */
class LedgerAgent {
  /**
   * Constructor for LedgerAgent
   * @param  {Object} options The options for the LedgerAgent
   * @param  {String} [options.id] Id starting with `urn:uuid:`
   * @param  {any} [options.node] Node
   * @param  {any} [options.owner] Owner
   * @param  {any} [options.name] Name
   * @param  {any} [options.description] Description
   * @param  {Boolean} [options.public=false] Public
   * @return {LedgerAgent}         The created LedgerAgent
   */
  constructor(options) {
    options = options || {};
    this.id = options.id;
    this.node = options.node;
    this.owner = options.owner;
    this.name = options.name;
    this.description = options.description;
    this.public = options.public || false;
    // remove the `urn:uuid:` prefix
    const laUuid = this.id.substring(9);

    // define core services
    const ledgerAgentStatusService = config.server.baseUri +
      routes.agents + '/' + laUuid;
    this.service = {
      ledgerAgentStatusService,
      ledgerConfigService: config.server.baseUri +
        routes.config.replace(':agentId', laUuid),
      ledgerOperationService: config.server.baseUri +
        routes.operations.replace(':agentId', laUuid),
      ledgerEventService: config.server.baseUri +
        routes.events.replace(':agentId', laUuid),
      ledgerBlockService: config.server.baseUri +
        routes.blocks.replace(':agentId', laUuid),
      ledgerQueryService: config.server.baseUri +
        routes.query.replace(':agentId', laUuid)
    };

    // ledger agent plugins define additional services
    this.plugins = options.plugins;
    for(const pluginName of this.plugins) {
      const p = brLedgerNode.use(pluginName);
      const pName = paramCase(pluginName);
      // the plugin's `serviceType` is associated with the plugin's root route
      this.service[p.api.serviceType] = {
        id: `${ledgerAgentStatusService}/plugins/${pName}`
      };
    }
  }
}

module.exports = LedgerAgent;