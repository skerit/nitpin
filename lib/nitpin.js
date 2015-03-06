var Blast = __Protoblast,
    Fn = Blast.Bound.Function,
    NitpinWorker = require('./nitpin_worker'),
    NzbDocument = require('./nzb_document'),
    Cancellable = require('./cancellable'),
    Nitpin;

/**
 * The Nitpin class
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.1
 */
Nitpin = Blast.Bound.Function.inherits('Informer', function Nitpin(config) {

	// Host(name) to connect to
	this.host = config.host;

	// Use secure connection?
	this.secure = config.secure || false;

	// Port to use
	this.port = config.port || 119;

	// Username
	this.user = config.user;

	// Password
	this.pass = config.pass;

	// Maximum amount of connections to use
	this.connections = config.connections || config.conn || 1;

	// Server specific information (cache)
	this.serverinfo = {};

	// Available sockets
	this.sockets = [];

	// Convert all \r\n to \n?
	this.convertNewline = false;

	// Amount of commands waiting for a worker
	this.waiting = 0;

	// Temporary folder
	this.tempfolder = '/tmp/nitpin';
});

/**
 * Link a worker method
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
Nitpin.setStatic(function linkWorker(methodName, hasGroup) {

	if (typeof hasGroup == 'boolean' && hasGroup) {
		hasGroup = 0;
	} else if (typeof hasGroup != 'number') {
		hasGroup = false;
	}

	this.setMethod(methodName, function workerMethod() {

		var that = this,
		    groupName,
		    args,
		    task;

		if (hasGroup !== false) {
			groupName = arguments[hasGroup];
		}

		args = arguments;

		this.waiting++;

		task = this.requestFreeSocket(groupName, function gotSocket(err, worker) {
			that.waiting--;
			worker[methodName].apply(worker, args);
		});

		task.on('cancelled', function onCancelled() {
			that.waiting--;
		});

		task.on('paused', function onPaused() {
			that.waiting--;
		});

		task.on('resumed', function onResumed() {
			that.waiting++;
		});

		return task;
	});
});

/**
 * Get server specific info
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}   hostname   The hostname of the server
 * @param    {String}   key        The key name of the value to get
 * @param    {Mixed}    value      Optional value when setting
 */
Nitpin.setMethod(function info(hostname, key, value) {

	if (!this.serverinfo[hostname]) {
		this.serverinfo[hostname] = {};
	}

	if (arguments.length == 2) {

		if (this.serverinfo[hostname][key] == null) {
			return null;
		}

		return this.serverinfo[hostname][key];
	} else {
		this.serverinfo[hostname][key] = value;
	}
});

/**
 * Create a connection to the server
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 */
Nitpin.setMethod(function connect() {
	return this.getSocket();
});

/**
 * Get the least busy worker socket (or create a new one)
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}   groupname   Optional group preference
 */
Nitpin.setMethod(function getSocket(groupname) {

	var upstarts = [],
	    results = [],
	    that = this,
	    result,
	    sock,
	    b,
	    i;

	for (i = 0; i < this.sockets.length; i++) {
		sock = this.sockets[i];
		b = sock.busy;

		if (!b) {

			// If this is not busy, and the group matched, return it immediatly
			if (sock.currentGroup == groupname) {
				return sock;
			}

			results.push(sock);
		}

		// Keep the starting sockets separate
		if (b == 1 && !sock.authenticated) {
			upstarts.push(sock);
		}
	}

	// If there are non-busy sockets, return that
	if (results.length) {
		result = results[0];
	} else if (!results.length && this.sockets.length < this.connections) {

		// See if there are any upstarting sockets
		if (upstarts.length && that.waiting == 0) {
			result = upstarts[0];
		} else {
			// Create a new connection if there are no available sockets
			// and we haven't used up all our allowed ones
			result = new NitpinWorker(this);
		}
	} else {

		// All sockets are busy and we can't create new ones, return the least busy
		results = this.sockets.slice(0);
		Blast.Bound.Array.sortByPath(results, 1, 'busy');

		// See if any of the least busy ones are on the same group
		for (i = 0; i < ~~(results.length/2); i++) {
			if (results[i].currentGroup == groupname) {
				result = results[i];
			}
		}

		// Just use the least busy one, then
		result = results[0];
	}

	return result;
});

/**
 * Get a free socket
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}   groupname   Optional group preference
 *
 * @return   {Cancellable}
 */
Nitpin.setMethod(function requestFreeSocket(groupname, callback) {

	var that = this,
	    task = new Cancellable();

	Blast.setImmediate(function() {

		var result;

		// If the task has already been cancelled, exit already
		if (task.cancelled) {
			return;
		}

		result = that.getSocket(groupname);

		if (result && !result.busy) {
			return callback(null, result);
		}

		that.once('freeworker', function gotFreeWorker(worker) {

			var thisEvent = this;

			// Execute this if not yet cancelled
			task.execute(function() {

				if (!thisEvent.test) {
					thisEvent.test = Date.now();
				}

				// Stop propagation
				thisEvent.stop();

				callback(null, worker);
			});
		});
	});

	return task;
});

/**
 * Get and parse an NZB file
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.1
 * @version  0.1.1
 */
Nitpin.setMethod(function parseNZB(path, callback) {

	var nzb = new NzbDocument(path, this);

	nzb.on('error', function onError(err) {
		return callback(err);
	});

	nzb.on('parsed', function afterTriage() {
		if (callback) callback(null, nzb);
	});

	return nzb;
});

// Link worker methods
Nitpin.linkWorker('getHead', true);
Nitpin.linkWorker('getBody', true);
Nitpin.linkWorker('getArticle', true);
Nitpin.linkWorker('stat', true);
Nitpin.linkWorker('over', true);
Nitpin.linkWorker('group', true);
Nitpin.linkWorker('capabilities', true);
Nitpin.linkWorker('list', true);

module.exports = Nitpin;