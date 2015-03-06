var Blast = __Protoblast,
    Fuery = require('fuery'),
    ResponseStream = require('./response_stream'),
    MultilineStream = require('./multiline_stream'),
    CompressedStream = require('./compressed_stream'),
    sids = 0,
    Fn = Blast.Bound.Function;

/**
 * The Nitpin Worker class.
 * Underscored methods have to be queued yourself,
 * but they always have a regular method that is queued already.
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.3
 */
NitpinWorker = Blast.Collection.Function.inherits('Informer', function NitpinWorker(parent) {

	var that = this,
	    socket;

	// Socket id (not related to the parent array)
	this.id = sids++;

	// Workers add themselves to the parent
	parent.sockets.push(this);

	// Emit an event to let the parent know a new worker has been made
	parent.emit('worker', this);

	// Create a reference to the parent
	this.parent = parent;

	// Initialize the socket
	this.socket = socket = require(this.secure ? 'tls' : 'net').connect(parent.port, parent.host);

	// Are we connected?
	this.connected = false;

	// Are we authenticated?
	this.authenticated = false;

	// New queue
	this.comboqueue = new Fuery();

	// Socket communication queue
	this.commqueue = new Fuery();

	// Allow maximum 1 running function at a time
	this.comboqueue.limit = 1;
	this.commqueue.limit = 1;

	// The communication queue can start now
	this.commqueue.start();

	// Current group
	this.currentGroup = null;

	// Current group info
	this.groupInfo = {};

	// Authenticate
	that.authenticate();

	// Has this been explicitly set as busy?
	this.explicitBusy = null;

	// When was the last activity?
	this.lastActivity = Date.now();

	// Server info
	this.server = {
		host: parent.host,
		secure: parent.secure,
		port: parent.port,
		user: parent.user,
		pass: parent.pass
	};

	// Listen to error messages
	this.socket.on('error', function onError(err) {
		that.emit('error', err);
		that.cleanup();
	});

	// Clean up when the server closes the connection
	this.socket.on('end', function onEnd(e) {
		that.cleanup();
	});

	// Listen to the initial message
	this.socket.once('data', function initialData(data) {

		// Initial message received, connection has been made
		that.connected = true;

		// Start the queue
		that.comboqueue.start();

		// Emit the connected event
		that.emit('connected');
	});

	// Remove this worker after 30 seconds of innactivity
	this.intervalId = setInterval(function() {

		// Only remove this if it isn't busy and if there are other connected sockets
		if (!that.busy && parent.sockets.length > 1 && (Date.now() - that.lastActivity) > 30000) {

			// Submit the QUIT command
			that.submit('QUIT', function(err, response) {
				// Destroy the actual socket
				that.socket.destroy();
			});

			that.cleanup();
		}
	}, 31000);
});

/**
 * Clean up this worker because the connection has been closed
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
NitpinWorker.setMethod(function cleanup() {

	var sockid;

	// Get the id of this socket in the parent's array
	sockid = this.parent.sockets.indexOf(this);

	if (sockid > -1) {
		// Remove it from that array
		this.parent.sockets.splice(sockid, 1);
	}

	// Clear the interval
	clearInterval(this.intervalId);
});

/**
 * Get server specific info
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}   key        The key name of the value to get
 * @param    {Mixed}    value      Optional value when setting
 */
NitpinWorker.setMethod(function info(key, value) {

	if (arguments.length == 1) {
		return this.parent.info(this.server.host, key);
	} else {
		return this.parent.info(this.server.host, key, value);
	}
});

/**
 * Busy property, how busy a worker is (lower is better)
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @type     {Number}
 */
NitpinWorker.setProperty(function busy() {

	var count;

	// Explicit busy should not be used
	if (this.explicitBusy) {
		return 10;
	}

	// Count combo's currently running and in the queue
	count = this.comboqueue.running + this.comboqueue._queue.length;

	if (count) {
		return count;
	}

	// Count communications currently running and in the queue
	count = this.commqueue.running + this.commqueue._queue.length;

	if (count) {
		return count;
	}

	return 0;
}, function setBusy(val) {
	this.explicitBusy = val;
});

/**
 * Hit the activity counter
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
NitpinWorker.setMethod(function poke() {
	this.lastActivity = Date.now();
});

/**
 * Announce this worker if it's free
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.2
 */
NitpinWorker.setMethod(function announce() {

	var that = this;

	Blast.setImmediate(function doAnnounce() {
		if (that.comboqueue._queue.length == 0 && that.comboqueue.running == 0) {
			// Emit an event this worker is no longer busy
			that.parent.emit('freeworker', that);
		}
	});
});

/**
 * Queue a combination of commands
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Function}  callback      The function to call when done
 * @param    {Function}  fnc           The function that needs to be run now
 */
NitpinWorker.setMethod(function queue(callback, fnc) {

	var that = this;

	if (typeof fnc !== 'function') {
		fnc = callback;
		callback = null;
	}

	if (typeof callback !== 'function') {
		callback = Blast.Bound.Function.thrower;
	}

	this.comboqueue.add(function(done) {

		// Execute the given function
		fnc.call(that, function whenDone(err, response) {

			// We got a response, call the user's callback
			callback.apply(that, arguments);

			// Indicate this queue entry is finished
			done();

			// Announce if it's free
			that.announce();
		});
	});
});

/**
 * Submit a command on the socket, even when not authenticated
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.1
 *
 * @param    {String}    command       Command without newlines
 * @param    {Boolean}   multiline     Will the response be multiple messages?
 * @param    {Boolean}   compressed    Will the response be compressed?
 * @param    {Function}  callback      Where to deliver final response
 */
NitpinWorker.setMethod(function _submit(command, multiline, compressed, callback) {

	var that = this,
	    socket = this.socket,
	    pipe = socket;

	if (typeof multiline == 'function') {
		callback = multiline;
		compressed = false;
		multiline = false;
	} else if (typeof compressed == 'function') {
		callback = compressed;
		compressed = false;
	}

	// Use the commqueue so only 1 message-response can happen at a time
	this.commqueue.add(function doCommand(done) {

		var response,
		    bomb,
		    len;

		// Create finish function that handles everything when done
		function finish(err) {

			var buf,
			    i;

			// Defuse the bomb (does nothing when called after explosion)
			bomb.defuse();

			// Remove connected pipes
			socket.unpipe();

			// Remove listeners
			socket.removeAllListeners('data');
			socket.removeAllListeners('error');

			// Make sure the newline is removed from the end of the buffer
			if (response && response.buffer) {
				buf = response.buffer;
				len = buf.length;

				if (buf[len-2] == 13 && buf[len-1] == 10) {
					buf = buf.slice(0, -2);
				}

				// Remove dot stuffing
				for (i = 2; i < buf.length; i++) {
					if (buf[i-2] == 13 && buf[i-1] == 10 && buf[i] == 46 && buf[i+1] == 46) {
						buf = Buffer.concat([buf.slice(0, i), buf.slice(i+1)]);
					}
				}

				// Convert all \r\n to \n if wanted
				if (that.parent.convertNewline) {
					for (i = 2; i < buf.length; i++) {
						if (buf[i-2] == 13 && buf[i-1] == 10) {
							buf = Buffer.concat([buf.slice(0, i-2), buf.slice(i-1)]);
						}
					}
				}

				response.buffer = buf;
			}

			// Call queue done
			done();

			// If there's an error, callback with that
			if (err) {
				callback(err);
				console.error('Nitpin worker', that.id, 'error: ' + err, response);
				if(response.buffer) {
					console.error(' -- BUFFER TAIL:', JSON.stringify(response.buffer.toString().slice(-10)))
				}
			} else {
				callback(null, response);
			}
		}

		// Make sure finish only gets called one time
		finish = Fn.regulate(finish);

		// Create a timebomb: explode when we haven't called back in 15 seconds
		bomb = Fn.timebomb(15000, finish);

		if (compressed) {
			pipe = pipe.pipe(new CompressedStream());
			pipe.on('error', finish);
		}

		if (multiline) {
			pipe = pipe.pipe(new MultilineStream());
			pipe.on('error', finish);
		}

		pipe = pipe.pipe(new ResponseStream(multiline));

		// Receive response object (same one on each push)
		pipe.on('data', function gotData(data) {
			response = data;
		});

		// When the end event has fired, the response is complete
		pipe.on('end', finish);
		pipe.on('error', finish);

		// Reset the activity counter
		that.poke();

		// Write the command to the socket
		socket.write(command + '\r\n');
	});
});

/**
 * Parse an article
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.1
 *
 * @param    {String}    article       Raw article
 * @param    {Boolean}   hasHead
 * @param    {Boolean}   hadBody
 *
 * @return   {Object}
 */
NitpinWorker.setMethod(function parseArticle(article, hasHead, hasBody) {

	var headers,
	    lastkey,
	    lines,
	    head,
	    temp,
	    body,
	    id;

	if (typeof article != 'string') {
		if (Array.isArray(article)) {
			article = article.join('\r\n');
		} else {

			if (article.buffer) {
				article = article.buffer;
			}

			if (Buffer.isBuffer(article)) {
				article = article.toString('binary');
			}
		}
	}

	if (hasHead == null) {
		hasHead = true;
	}

	if (hasBody == null) {
		hasBody = true;
	}

	if (hasHead) {

		// Parsed headers go here
		headers = {};

		id = article.indexOf('\r\n\r\n');
		head = article.slice(0, id);
		body = article.slice(id + 4);

		lines = head.split('\n');

		for (i = 1; i < lines.length; i++) {
			temp = lines[i];

			if (temp.indexOf(':') == -1) {
				headers[lastkey] += '\n' + temp;
				continue;
			} else {
				temp = temp.split(':');
			}

			lastkey = temp[0].toLowerCase().trim();
			headers[lastkey] = temp[1].trim();
		}
	} else {
		body = article;
	}

	return {
		headers: headers,
		head: head,
		body: body
	};
});

/**
 * Normalize article id
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}    id
 *
 * @return   {Object}
 */
NitpinWorker.setMethod(function normalizeArticleId(id) {

	var error;

	if (typeof id == 'number') {

		// Make sure this article number is actually available
		if (id < this.groupInfo.low || id > this.groupInfo.high) {
			error = 'This article number is not available';
		}
	} else {
		if (id[0] !== '<') {
			id = '<' + id + '>';
		}
	}

	return {
		id: id,
		error: error
	};
});

/**
 * Submit a command after we've authenticated
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}    command       Command without newlines
 * @param    {Boolean}   multiline     Will the response be multiple messages?
 * @param    {Boolean}   compressed    Will the response be compressed?
 * @param    {Function}  callback      Where to deliver final response
 */
NitpinWorker.setMethod(function submit(command, multiline, compressed, callback) {
	this.after('authenticated', function authenticated() {
		this._submit(command, multiline, compressed, callback);
	});
});

/**
 * Authenticate
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Buffer}    data
 */
NitpinWorker.setMethod(function authenticate(callback) {

	var that = this;

	function finish(err, response) {
		that.announce();
		if (callback) callback(err, response);
	}

	if (!this.parent.user) {
		this.emit('authenticated');
		this.authenticated = true;

		return finish(null);
	}

	this.queue(callback, function(done) {
		that._submit('AUTHINFO USER ' + that.parent.user, false, false, function gotResponse(err, response) {

			if (err) {
				return done(err);
			}

			if (response.status === 381) {
				if (that.parent.pass == null) {
					return done(new Error('A password is required'));
				}

				return that._submit('AUTHINFO PASS ' + that.parent.pass, false, false, function gotResponse(err, response) {
					if (err) {
						return done(err);
					}

					that.authenticated = true;
					done(null);
					that.emit('authenticated');
				});
			}

			that.authenticated = true;
			done(null, response);
			that.emit('authenticated');
		});
	});
});

/**
 * Stat an article
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}    group
 * @param    {String}    id
 * @param    {Function}  callback
 */
NitpinWorker.setMethod(function _stat(group, id, callback) {

	var that = this;

	Fn.series(function changeGroup(next) {
		that._group(group, false, next);
	}, function doStat() {

		var cmd = 'STAT ',
		    art = that.normalizeArticleId(id);

		if (art.error) {
			return callback(new Error(art.error));
		}

		cmd += art.id;

		that.submit(cmd, false, false, function(err, response) {

			var temp;

			if (err) {
				return callback(err);
			}

			temp = response.message.split(' ');

			callback(null, Number(temp[0]), temp[1]);
		});
	});
});

/**
 * Stat an article
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
NitpinWorker.setMethod(function stat(group, id, callback) {
	this.queue(callback, function(done) {
		this._stat(group, id, done);
	});
});

/**
 * Get the head of an article
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Function}  callback      Where to deliver final response
 */
NitpinWorker.setMethod(function _getHead(group, id, callback) {

	var that = this;

	Fn.series(function changeGroup(next) {
		that._group(group, false, next);
	}, function getHead() {

		var cmd = 'HEAD ',
		    art = that.normalizeArticleId(id);

		if (art.error) {
			return callback(new Error(art.error));
		}

		cmd += art.id;

		that.submit(cmd, true, false, function(err, response) {

			var temp;

			if (err) {
				return callback(err);
			}

			temp = that.parseArticle(response, true, false);

			callback(null, temp.headers, temp.head);
		});
	});
});

/**
 * Get an article head, queued
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
NitpinWorker.setMethod(function getHead(group, id, callback) {
	this.queue(callback, function(done) {
		this._getHead(group, id, done);
	});
});

/**
 * Get the head of an article
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Function}  callback      Where to deliver final response
 */
NitpinWorker.setMethod(function _getBody(group, id, callback) {

	var that = this;

	Fn.series(function changeGroup(next) {
		that._group(group, false, next);
	}, function getHead() {

		var cmd = 'BODY ',
		    art = that.normalizeArticleId(id);

		if (art.error) {
			return callback(new Error(art.error));
		}

		cmd += art.id;

		that.submit(cmd, true, false, function(err, response) {

			var temp;

			if (err) {
				return callback(err);
			}

			temp = that.parseArticle(response, false, true);

			callback(null, temp.body);
		});
	});
});

/**
 * Get an article body, queued
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
NitpinWorker.setMethod(function getBody(group, id, callback) {
	this.queue(callback, function(done) {
		this._getBody(group, id, done);
	});
});

/**
 * Get an article, unqueued
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
NitpinWorker.setMethod(function _getArticle(group, id, callback) {

	var that = this;

	Fn.series(function changeGroup(next) {
		that._group(group, false, next);
	}, function getArticle() {

		var cmd = 'ARTICLE ',
		    art = that.normalizeArticleId(id);

		if (art.error) {
			return callback(new Error(art.error));
		}

		cmd += art.id;

		that.submit(cmd, true, false, function(err, response) {

			var temp;

			if (err) {
				return callback(err);
			}

			temp = that.parseArticle(response);

			callback(null, temp.headers, temp.body);
		});
	});
});

/**
 * Get an article, queued
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
NitpinWorker.setMethod(function getArticle(group, id, callback) {
	this.queue(callback, function(done) {
		this._getArticle(group, id, done);
	});
});

/**
 * Get a list of available newsgroups
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}    wildmat    Optional wildmat
 * @param    {Boolean}   force
 * @param    {Function}  callback
 */
NitpinWorker.setMethod(function _list(wildmat, force, callback) {

	var that = this,
	    cache,
	    cmd;

	if (typeof wildmat == 'function') {
		callback = wildmat;
		wildmat = false;
		force = false;
	} else if (typeof wildmat == 'boolean') {
		callback = force;
		force = wildmat;
		wildmat = false;
	} else if (typeof wildmat == 'string') {
		if (typeof force == 'function') {
			callback = force;
			force = false;
		}
	}

	cmd = 'LIST ACTIVE';

	if (wildmat) {
		cmd += ' ' + wildmat;
	} else if (!force) {
		cache = this.info('activelist');

		if (cache) {
			callback(null, cache);
		}
	}

	this.submit(cmd, true, false, function gotList(err, response) {

		var result,
		    temp,
		    type,
		    rec,
		    i;

		if (err) {
			return callback(err);
		}

		result = {};

		for (i = 0; i < response.lines.length; i++) {
			temp = response.lines[i].split(' ');

			rec = {
				name: temp[0],
				high: temp[1],
				low: temp[2]
			};

			if (temp[3] == 'n') {
				rec.post = false;
				rec.moderated = false;
			} else if (temp[3] == 'y') {
				rec.post = true;
				rec.moderated = false;
			} else if (temp[3] == 'm') {
				rec.post = true;
				rec.moderated = true;
			}

			result[temp[0]] = rec;
		}

		if (!wildmat) {
			that.info('activelist', result);
		}

		callback(null, result);
	});
});

/**
 * Get a list of available newsgroups
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
NitpinWorker.setMethod(function list(wildmat, force, callback) {

	if (typeof wildmat == 'function') {
		callback = wildmat;
		wildmat = '';
		force = false;
	} else if (typeof wildmat == 'boolean') {
		callback = force;
		force = wildmat;
		wildmat = '';
	} else if (typeof wildmat == 'string') {
		if (typeof force == 'function') {
			callback = force;
			force = false;
		}
	}

	this.queue(callback, function(done) {
		this._list(wildmat, force, done);
	});
});

/**
 * Change to the given group, unqueued
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}    groupname    Groupname to switch to
 * @param    {Boolean}   force        Force the command, even if already in here
 * @param    {Function}  callback
 */
NitpinWorker.setMethod(function _group(groupname, force, callback) {

	var that = this;

	if (typeof force == 'function') {
		callback = force;
		force = false;
	}

	// Send cached data when we're already in this group
	if (!force && that.currentGroup == groupname) {
		return callback(null, this.groupInfo);
	}

	this.submit('GROUP ' + groupname, function changedGroup(err, response) {

		var info,
		    temp;

		if (err) {
			return callback(err);
		}

		info = {};
		temp = response.message.split(' ');

		// Get available number of articles
		info.available = Number(temp[0]);

		// Get lowest number
		info.low = Number(temp[1]);

		// Get highest number
		info.high = Number(temp[2]);

		// Add groupname
		info.name = groupname;

		that.groupInfo = info;

		that.currentGroup = groupname;
		callback(null, info);
	});
});

/**
 * Change to the given group, queued
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}    groupname
 */
NitpinWorker.setMethod(function group(groupname, force, callback) {

	var that = this;

	if (typeof force == 'function') {
		callback = force;
		force = false;
	}

	this.queue(callback, function(done) {
		that._group(groupname, force, done);
	});
});

/**
 * Get the server capabilities
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Boolean}     force
 * @param    {Function}    callback
 */
NitpinWorker.setMethod(function _capabilities(force, callback) {

	var that = this,
	    cap;

	if (typeof force == 'function') {
		callback = force;
		force = false;
	}

	cap = this.info('capabilities');

	if (!force && cap) {
		return callback(null, cap);
	}

	this.submit('CAPABILITIES', true, false, function gotCapabilities(err, response) {

		var result,
		    temp,
		    i;

		if (err) {
			return callback(err);
		}

		result = {};

		for (i = 0; i < response.lines.length; i++) {
			temp = response.lines[i].toLowerCase();
			that.info('cap.' + temp, true);
			result[temp] = true;
		}

		that.info('capabilities', result);

		callback(null, result);
	});
});

/**
 * Get the server capabilities
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Boolean}     force
 * @param    {Function}    callback
 */
NitpinWorker.setMethod(function capabilities(force, callback) {

	if (typeof force == 'function') {
		callback = force;
		force = false;
	}

	this.queue(callback, function(done) {
		this._capabilities(force, done);
	});
});

/**
 * Get the List Overview Format
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Function}    callback
 */
NitpinWorker.setMethod(function _format(callback) {

	var that = this,
	    val = this.info('listformat');

	if (val) {
		return callback(null, val);
	}

	// Get the format
	this.submit('LIST OVERVIEW.FMT', true, false, function gotFormat(err, response) {

		var temp,
		    i;

		if (err) {
			return callback(err);
		}

		val = [{name: 'id', flag: ''}];

		for (i = 0; i < response.lines.length; i++) {
			temp = response.lines[i];

			if (!temp) {
				continue;
			}

			temp = temp.split(':');

			if (temp[0]) {
				val.push({
					name: temp[0].toLowerCase(),
					flag: temp[1].toLowerCase()
				});
			} else {
				val.push({
					name: temp[1].toLowerCase(),
					flag: 'meta'
				});
			}
		}

		that.info('listformat', val);

		callback(null, val);
	});
});

/**
 * Get overview
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}    groupname
 */
NitpinWorker.setMethod(function _over(group, first, last, callback) {

	var that = this,
	    hasXzver = this.info('cap.xzver'),
	    format,
	    lines,
	    r;

	Fn.series(function changeGroup(next) {
		that._group(group, false, next);
	}, function getFormat(next) {
		that._format(next);
	}, function Xzver(next) {

		// Get the set listformat
		format = that.info('listformat');

		// Try Xzver
		if (hasXzver == null || hasXzver) {
			that.submit('XZVER ' + first + '-' + last, true, true, function(err, response) {

				if (err) {
					// Xzver failed
					that.info('cap.xzver', false);
					return next();
				}

				r = response;
				lines = response.lines;
				next();
			});
		} else {
			next();
		}
	}, function Xover(next) {

		if (!lines) {
			that.submit('XOVER ' + first + '-' + last, true, false, function(err, response) {

				if (err) {
					return next(err);
				}

				r = response;
				lines = response.lines;
				next();
			});
		} else {
			next();
		}
	}, function done(err) {

		var results,
		    record,
		    field,
		    temp,
		    line,
		    conf,
		    i,
		    j;

		if (err) {
			return callback(err);
		}

		results = [];

		for (i = 0; i < lines.length; i++) {
			line = lines[i].split('\t');
			record = {};

			for (j = 0; j < line.length; j++) {
				temp = line[j];

				// Get the field format config
				conf = format[j];

				// See if the name is part of the field
				if (conf.flag == 'full') {
					temp = Blast.Bound.String.after(temp, ':').trim();
				}

				record[conf.name] = temp;
			}

			results.push(record);
		}

		callback(null, results);
	});
});

/**
 * Get overview
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}    group
 */
NitpinWorker.setMethod(function over(group, first, last, callback) {

	var that = this;

	if (typeof first == 'function') {
		callback = first;
		first = 1;
		last = 10;
	} else if (typeof last == 'function') {
		callback = last;
		last = Number(first) + 10;
	}

	this.queue(callback, function(done) {
		that._over(group, first, last, done);
	});
});

module.exports = NitpinWorker;