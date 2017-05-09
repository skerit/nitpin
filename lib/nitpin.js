var Blast = __Protoblast,
    Fn = Blast.Bound.Function,
    ChildProcess = require('child_process'),
    NitpinWorker = require('./nitpin_worker'),
    NzbDocument = require('./nzb_document'),
    Cancellable = require('./cancellable'),
    libpath = require('path'),
    Nitpin;

/**
 * The Nitpin class
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.4
 */
Nitpin = Blast.Bound.Function.inherits('Informer', function Nitpin(config) {

	var that = this;

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

	// Enable debugging
	this.debugMode = config.debug || false;

	// Server specific information (cache)
	this.serverinfo = {};

	// Available sockets
	this.sockets = [];

	// Convert all \r\n to \n?
	this.convertNewline = false;

	// Amount of commands waiting for a worker
	this.waiting = 0;

	// Temporary directory
	this.tempdir = config.tempdir || '/tmp/nitpin';

	// The worker request array
	this.requestQueue = [];

	// Function queue to limit deyencing overloading the process
	this.yenqueue = new Blast.Classes.FunctionQueue();

	// Set the yenc throttle to 50ms (pause between yenc decodes)
	if (typeof config.yenc_throttle == 'number') {
		this.yenqueue.throttle = config.yenc_throttle;
	} else {
		this.yenqueue.throttle = 50;
	}

	// Set the limit to 1: only 1 function allowed to run at a time.
	// Which is logical, because deyencing is synchronous anyway
	this.yenqueue.limit = 1;

	// Sort the queue on every check
	this.yenqueue.sort = true;

	// Start the queue
	this.yenqueue.start();

	// Listen for free workers
	this.on('freeworker', function gotFreeWorker(worker) {

		var thisEvent = this,
		    temp,
		    task;

		// If there are no waiting requests, do nothing
		if (!that.requestQueue.length) {
			return;
		}

		// Else, sort them by their order
		that.sortRequestQueue();

		// Get the first entry
		temp = that.requestQueue.shift();

		// Get the task
		temp.fnc(worker);
	});
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
 * Repair files with par2
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.4
 */
Nitpin.setStatic(function repair(filepath, instance) {

	var that  = this,
	    file  = libpath.basename(filepath),
	    args  = [file],
	    dir   = libpath.dirname(filepath),
	    temp  = '',
	    outtemp = '',
	    informer = new Blast.Classes.Informer(),
	    curfile,
	    fixer,
	    first = true;

	if (!filepath) {
		throw new Error('Can not fix empty filepath par');
	}

	// Create the extractor process
	fixer = ChildProcess.spawn('par2repair', args, {cwd: dir});

	// Listen to the par2 log output
	fixer.stdout.on('data', function onOut(data) {

		var message = '' + data,
		    temp;

		if (message.indexOf('Repair complete') > -1) {

			if (instance) {
				instance.debug('Par repair is complete');
			}

			informer.emit('repaired');
			informer.emit('finished', true);
			return;
		}

		if (message.indexOf('Repairing:') > -1) {

			if (first && instance) {
				instance.debug('Par repair has begun');
				first = false;
			}

			temp = /Repairing:\W+(\d+\.\d)%/.exec(message);

			if (temp && temp[1]) {
				informer.emit('progress', Number(temp[1]));
			}
			return;
		}

		if (message.indexOf('Repair is not possible') > -1) {

			if (instance) {
				instance.debug('Par repair is not possible');
			}

			informer.emit('broken');
			informer.emit('finished', false);
			return;
		}

		if (message.indexOf('repair is not required') > -1) {

			if (instance) {
				instance.debug('Par repair is not required, according to the parchives');
			}

			informer.emit('notbroken');
			informer.emit('finished', true);
		}
	});

	return informer;
});

/**
 * Repair files with par2
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.4
 * @version  0.1.4
 */
Nitpin.setMethod(function repair(filepath) {
	return Blast.Classes.Nitpin.repair(filepath, this);
});

/**
 * Output debug message
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
Nitpin.setMethod(function debug(dtest, info, args) {

	if (this.debugMode) {

		if (dtest == '__debug__') {
			args = Array.prototype.slice.call(args);
			args.unshift('[' + info + '] ');
		} else {
			args = Array.prototype.slice.call(arguments);
		}

		console.log.apply(console, args);
		return true;
	}

	return false;
});

/**
 * Sort the request queue
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
Nitpin.setMethod(function sortRequestQueue() {
	Blast.Bound.Array.sortByPath(this.requestQueue, -1, 'weight');
});

/**
 * Add to the request queue
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
Nitpin.setMethod(function addRequest(fnc, weight) {

	if (weight == null) {
		weight = 10;
	}

	this.requestQueue.push({fnc: fnc, weight: weight});
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
Nitpin.setMethod(function requestFreeSocket(groupname, callback, weight) {

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

		that.addRequest(function gotFreeWorker(worker) {

			// Execute this if not yet cancelled
			task.execute(function() {
				callback(null, worker);
			});
		}, weight);
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

/**
 * Get an article body, add weight to the request
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.3
 * @version  0.1.3
 */
Nitpin.setMethod(function getBodyWeight(groupName, id, weight, callback) {

	var that = this,
	    groupName,
	    task;

	this.waiting++;

	task = this.requestFreeSocket(groupName, function gotSocket(err, worker) {
		that.waiting--;
		worker.getBody(groupName, id, callback);
	}, weight);

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

/**
 * Close all open connections
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.2.1
 * @version  0.2.1
 */
Nitpin.setMethod(function close() {

	var socket,
	    i;

	for (i = 0; i < this.sockets.length; i++) {
		socket = this.sockets[i];
		socket.destroy();
	}
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