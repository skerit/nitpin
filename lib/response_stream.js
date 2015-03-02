var Blast = __Protoblast,
    Transform = require('stream').Transform,
    Response = require('./response'),
    ResponseStream;

/**
 * The ResponseStream Class
 *
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.1
 *
 * @param    {Boolean}    multiline
 */
ResponseStream = Blast.Bound.Function.inherits(function ResponseStream(multiline) {

	var that = this;

	// Is this a multiline response?
	this.multiline = !!multiline;

	// What is the response so far?
	this.response = undefined;

	// Upstream pipe
	this.upstream = null;

	Transform.call(this, {objectMode: true});

	// Listen to pipes
	this.on('pipe', function(src) {
		that.upstream = src;
	});

}, Transform);

/**
 * The required _transform method
 *
 * @author   Robin van der Vleuten <robinvdvleuten@gmail.com>
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.1
 *
 * @param    {Buffer|String}   chunk
 * @param    {String}          encoding
 * @param    {Function}        callback
 */
ResponseStream.setMethod(function _transform(chunk, encoding, callback) {

	var response = this.response,
	    err;

	if (this.response === undefined) {

		// See if upstream has already made a Response object
		if (this.upstream && this.upstream.response) {
			response = this.upstream.response;
		} else {
			// Create a new Response object
			response = Response.createFromChunk(chunk);
		}

		this.response = response;

		// Certain status codes indicate errors
		if (response.status > 399) {
			err = new Error(response.message);
			err.code = response.status;
			return callback(err);
		}

		// Always submit the entire response object
		this.push(response);

		// End the stream if it's not a multiline response
		if (this.multiline === false) {
			this.end();
		}
	} else {
		if (!response.buffer) {
			response.buffer = chunk;
		} else {
			response.buffer = Buffer.concat([response.buffer, chunk]);
		}
	}

	callback();
});

/**
 * The _flush method
 *
 * @author   Robin van der Vleuten <robinvdvleuten@gmail.com>
 * @author   Jelle De Loecker   <jelle@kipdola.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {Function}    callback
 */
ResponseStream.setMethod(function _flush(callback) {
	this.push(this.response);
	callback();
});

module.exports = ResponseStream;