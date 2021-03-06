/**
 * (c) Copyright 2015 Hewlett-Packard Development Company, L.P.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
var IfParser = require('./ifparser');
var URL = require('url');
var Resource = require('../resource');
/**
 * Describe a list of rules from a WebDAV If header.
 *
 * The WebDAV spec defines a complicated DSL for the If header. The
 * IfParser parses that DSL. This is an event handler for the parser
 * that also evaluates a set of resources to determine if the lock
 * conditions are satisfied.
 *
 * Clients may supply rather wacky constraints in an If header. For
 * example, the spec allows that a URI to a resource not affected by an
 * operation can be supplied in an If header. Supporting this
 * functionality is possible, but has perfomance implications. So we
 * artificially constrain the resources that can be tested to only the
 * resources that are explicitly passed into the evaluation function.
 *
 * One special case not covered by the spec is the case where an If
 * header is supplied, but there are no rules in the header. We treat
 * this as an impossible match, and treat it as a precondition failure.
 *
 * The public API has three methods:
 *
 * - the constructor
 * - evaluate
 * - parseRules
 *
 * parseRules can be used to parse a rule but skip evaluation. Normally,
 * it is not used.
 */
function IfRules(header) {
  this.header = header;
}
module.exports = IfRules;

/**
 * The main evaluator.
 *
 * @param {array} resources
 *   An array of Resource objects.
 * @param {Function} fn
 *   The callback to execute when evaluation is finished. This is
 *   executed as fn(Error e, boolean passed, String token)
 * @return {boolean}
 *   true if this can be modified, false if the rule check fails.
 */
IfRules.prototype.evaluate = function (resources, fn) {
  var self = this;
  this.resources = resources;

  /*
  if (!resources || resources.length == 0) {
    var err = new Error("No resources to evaluate.");
    fn(err);
    return;
  }*/

  this.parseRules(function (e, data) {
    if (e) {
      fn(e);
      return;
    }
    //console.log("Evaluate(): Data: %j", data);

    // If no rules, we THINK that means deny access.
    if (data.length == 0) {
      // No rules.
      var err = new Error('No rules present in If header.');
      err.status = 412;
      fn (e);
      return;
    }

    self._evaluate(fn);
  });
}

/**
 * Call fn(Error e, Array data).
 *
 * Build an object representing the rules.
 */
IfRules.prototype.parseRules = function (fn) {
  //console.log("Parsing rules");
  var parser = this.setupParser();
  var self = this;
  parser.on('error', fn);
  parser.on('end', function () {fn(false, self.rules);});
  parser.parse();
}

IfRules.prototype.setupParser = function () {
  var parser = new IfParser(this.header);
  var rule = this.rules =  [];
  var currentResource = {name: '*', conditions: []};
  var rindex = -1;
  var cindex = 0;
  var negate = false;

  // This may be empty. Can we optimize it out?

  parser.on('resourceTag', function (resourceTag) {
    ++rindex;
    cindex = 0;
    var parts = URL.parse(resourceTag);
    rule.push({name: Resource.normalizeName(parts.pathname), conditions: []});
  });
  parser.on('startList', function () {
    if (rule.length == 0) {
      rule.push(currentResource);
      ++rindex;
    }
    rule[rindex].conditions[cindex] = {
      'notEtag': [],
      'notToken': [],
      'etag': [],
      'token': []
    };
  });
  parser.on('endList', function () {
    ++cindex;
  });

  parser.on('eTag', function (etag) {
    var c = rule[rindex].conditions[cindex];
    if (negate) {
      c.notEtag.push(etag);
      negate = false;
    }
    else {
      c.etag.push(etag);
    }
  });

  parser.on('stateToken', function (tok) {
    var c = rule[rindex].conditions[cindex];
    if (negate) {
      c.notToken.push(tok);
      negate = false;
    }
    else {
      c.token.push(tok);
    }
  });

  parser.on('not', function () {
    negate = true;
  });

  return parser;
}

// Unused
IfRules.prototype.parseHeader = function () {

  // This is a temporary stub for an event handler and a full recdesc
  // parser.

  // This is from SabreDAV. It doesn't handle full IF logic, but it does
  // enough to pass Litmus.
  //var regex = /(?:\<(?P<uri>.*?)\>\s)?\((?P<not>Not\s)?(?:\<(?P<token>[^\>]*)\>)?(?:\s?)(?:\[(?P<etag>[^\]]*)\])?\)/im;

  // [
  // 0: total match
  // 1: Resource
  // 2: Not
  // 3: Lock ID
  // 4: Etag
  // ] 
  var regex = /^(?:<([^\>]+)?>\s*)?\(\s*(Not)?(?:\s*<([^>]+)>)?\s*(?:\[([^\]]+)\])?\s*\)/im;

  var res = this.header.match(regex);
  console.log('===%s===', this.header);
  //console.log(res);

  if (res == null) return;

  return {
    resource: res[1],
    negated: res[2] != undefined,
    lockId: res[3],
    etag: res[4]
  };


}

/**
 * Top-level internal rule evaluator.
 */
IfRules.prototype._evaluate = function (callback) {
  //console.log("_evaluate");
  if (this.rules[0].name == '*') {
    this._evaluateUntaggedResources(callback);
  }
  else {
    this._evaluateTaggedResources(callback);
  }
}

IfRules.prototype._evaluateUntaggedResources = function (callback) {
  //console.log("_evaluateUntaggedResources");

  for (var i = 0; i < this.resources.length; ++i) {
    var resource = this.resources[i];

    // A resource passes the test. We can move on.
    if(this._evaluateResource(resource)) {
      callback(false, this.token);
      return;
    }

  }
  // Only if every disjunct fails do we return an error.
  var e = new Error("No rules were satisfied.");
  e.status = 412;
  callback(e);
}

IfRules.prototype._evaluateTaggedResources = function (callback) {
  //console.log("_evaluateTaggedResources");

  // Resources are to be ANDed together in this case.
  for (var i = 0; i < this.resources.length; ++i) {
    var resource = this.resources[i];
    //console.log("Evaluating %s", resource.name());

    // Does this resource pass the test?
    if(!this._evaluateResource(resource)) {
      e = new Error('Resource did not pass If rules.');
      e.status = 412;
      callback(e);
      return;
    }

  }
  callback(false, this.token);
}
/**
 * For each resource, apply each condition.
 */
IfRules.prototype._evaluateResource = function (res) {
  //console.log("_evaluateResource");
  // Loop through the rules.
  for (var i = 0; i < this.rules.length; ++i) {
    var rule = this.rules[i];

    //console.log("Checking if %s applies to %s", rule.name, res.name());

    // If the rule applies to the present resource..
    if (rule.name == '*' || rule.name == res.name()) {
      //console.log("Evaluating rule %s against %s", rule.name, res.name());
      // Evaluate the rule.
      for (var j = 0; j < rule.conditions.length; ++j) {
        // We OR the conditions together. If any one passes, the rule is
        // matched.
        if (this._evaluateCondition(res, rule.conditions[j])) {
          return true;
        }
      }
      // If the rule fails to apply to the resource, fail.
      return false;
    }
  }
  // XXX:
  // If we get here, then none of the supplied rules match the current
  // resource. If this is the case, we simply give this resource a pass.
  // This does lead to the result that if the rules don't address any of
  // the present resources, we automatically pass the If.
  return true;
}

IfRules.prototype._evaluateCondition = function (res, condition) {
  //console.log("_evaluateCondition");
  // console.log("Evaluate condition %j on %s", condition, res.name())
  var etag = res.etag ? res.etag() : '';
  var lock = res.lock(0);
  var lockToken = lock ? lock.token : null;

  var passesCondition =
    condition.notEtag.indexOf(etag) == -1
    &&
    condition.notToken.indexOf(lockToken) == -1
    &&
    (condition.token.length == 0 || condition.token.indexOf(lockToken) > -1)
    &&
    (condition.etag.length == 0 || condition.etag.indexOf(etag) > -1)
  ;

  // According to the spec, if an entire ruleset passes, then "the
  // token" should be sent along, too. This is an idiotic requirement,
  // since it requires that we sniff out what might be the token. But we
  // only want to pass along the correct token if we can.
  if ((passesCondition || !this.token) && condition.token.length > 0) {
    var index = condition.token.indexOf(lockToken);
    this.token = index == -1 ? condition.token[0] : condition.token[index];
  }

  return passesCondition;
}

