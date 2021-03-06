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
var pronto = require('pronto');
var HTTPUtil = require('./util');
var URL = require('url');
/**
 * Handle HTTP COPYrequests.
 *
 * COPY is defined in RFC 4918, 9.8.
 *
 * Params:
 * - resourceBridge: The resource bridge (REQUIRED)
 * - destination: A string naming the destination. (REQUIRED)
 * - resource: The resource to be copied. If it is NOT present, a 404
 *   will be issued.(OPTIONAL)
 * - targetResource: The destination resource. (OPTIONAL)
 *
 */
function HandleCopy() {
}
pronto.inheritsCommand(HandleCopy);
module.exports = HandleCopy;

HandleCopy.prototype.execute = function (cxt, params) {
  this.required(params, ['resourceBridge', 'destination']);
  var cmd = this;

  var request = cxt.getDatasource('request');
  var resource = params.resource;
  var destination = params.destination;
  this.bridge = params.resourceBridge;
  var targetResource = params.targetResource;
  var overwrite = true;
  this.retval = 201;

  this.cxt = cxt;

  if (request.headers.overwrite && request.headers.overwrite.toLowerCase() == 'f') {
    cxt.log("Overwrite mode is set to FALSE.", "debug");
    overwrite = false;
  }

  if (!resource) {
    this.cxt.log("Source resource not found.", "debug");
    this.reroute('@404', cxt);
    return;
  }

  if (destination.indexOf(resource.name() + '/') == 0) {
    cxt.log("Destination %s is inside of (or the same as) source %s!", destination, resource.name(), "warning");
    this.reroute('@409', cxt);
    return;
  }

  if (targetResource && !overwrite) {
    // Precondition failed.
    cxt.log('Destination exists already and overwrite is off.', 'debug');
    this.reroute('@412', cxt);
    return;
  }
  else if (targetResource) {
    // RFC 4918 9.8.4 says that we need to destroy the target resource if
    // it exists.
    this.bridge.delete(targetResource, function (e, status) {
      if (e || status.push && status.length > 0) {
        cmd.reroute('@412', cxt);
        return;
      }
      cxt.log('Removed the old file.' , 'debug');
      cmd.doAction(resource, destination, overwrite);
    });
    this.retval = 204;
  }

  // Otherwise, we just copy.
  else {
    this.doAction(resource, destination, overwrite);
  }
}

/**
 * Make it convenient to piggyback MOVE on COPY.
 */
HandleCopy.prototype.doAction = function (resource, destination, overwrite) {
  // this.reroute('@403', this.cxt);
  // return;
  var cmd = this;
  this.bridge.copy(resource, destination, overwrite, function (e, multistatus) {
    if (e) {
      if (e.status) {
        cmd.cxt.log('Failed Copy: %s %s', e.status, e.message, 'warning');
        cmd.reroute('@' + e.status, cmd.cxt);
      }
      else {
        cmd.cxt.log('Failed Copy: %s', e.message, 'warning');
        cmd.reroute('@403', cmd.cxt);
      }
      return;
    }

    if (multistatus && multistatus.length > 0) {
      cmd.toMultistatus(multistatus);
    }
    cmd.done(cmd.retval);
  });
}

HandleCopy.prototype.toMultistatus = function (list) {
  var MultiStatus = require('./multistatus');
  var msObj = new MultiStatus();
  for (var i = 0; i < list.length; ++i) {
    var item = list[i];
    msObj.addStatus(item.path, item.status)
  }
  this.cxt.add('multistatus', msObj.toXML());
  this.done(207)
  return;

}
