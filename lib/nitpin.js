var Blast = __Protoblast,
    Fn = Blast.Bound.Function,
    NitpinWorker = require('./nitpin_worker'),
    Nitpin;

/**
 * The Nitpin class
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
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

		var groupName,
		    worker;

		if (hasGroup !== false) {
			groupName = arguments[hasGroup];
		}

		// Get a socket, preferably one connected to the given group
		worker = this.getSocket(groupName);

		// Call the method
		worker[methodName].apply(worker, arguments);
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
 * Get a socket that'll be free
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
		return results[0];
	} else if (!results.length && this.sockets.length < this.connections) {

		// See if there are any upstarting sockets
		if (upstarts.length) {
			return upstarts[0];
		}

		// Create a new connection if there are no available sockets
		// and we haven't used up all our allowed ones
		return new NitpinWorker(this);
	}

	// All sockets are busy and we can't create new ones, return the least busy
	results = this.sockets.slice(0);
	Blast.Bound.Array.sortByPath(results, 1, 'busy');

	// See if any of the least busy ones are on the same group
	for (i = 0; i < ~~(results.length/2); i++) {
		if (results[i].currentGroup == groupname) {
			return results[i];
		}
	}

	// Just return the least busy one, then
	return results[0];
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