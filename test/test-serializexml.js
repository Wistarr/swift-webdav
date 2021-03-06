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
var fs = require('fs');
var webdav = require('../lib');
var assert = require('assert');

var xmlfile = 'test/test-parsexml.xml';
var register = new pronto.Registry();

register
  .route('test')
    .does(pronto.commands.Closure, 'file')
      .using('fn', function(cxt, params, cmd) {
        cmd.done(fs.createReadStream(xmlfile));
      })
    .does(webdav.xml.ParseXML, 'xml')
      .using('encoding', 'utf8')
      .using('input').from('cxt:file')
    .does(webdav.xml.SerializeXML, 'out')
      .using('xml').from('cxt:xml')
    .does(pronto.commands.Closure, 'file')
      .using('fn', function(cxt, params, cmd) {
        var out = cxt.get('out');

        console.log(out);

        assert.equal('string', typeof out);
        assert.ok(out.length > 100);

      })

;

var router = new pronto.Router(register);
router.handleRequest('test');
