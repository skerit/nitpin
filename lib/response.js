'use strict';

var Response = function (status, message) {
	this.status = status;
	this.message = message;
	this.lines = [];
};

Response.GROUP_SELECTED = 211; // RFC 3977
Response.NO_SUCH_GROUP = 411;  // RFC 3977

Response.createFromString = function (string) {
	var matches = /^(\d{3}) ([\S\s]+)$/g.exec(string.trim());
	if (!matches) {
		throw new Error('Invalid response given: ' + string);
	}

	if (matches[1] < 100 || matches[1] >= 600) {
		throw new Error('Invalid status code given: ' + matches[1]);
	}

	return new Response(parseInt(matches[1], 10), matches[2]);
};

module.exports = Response;